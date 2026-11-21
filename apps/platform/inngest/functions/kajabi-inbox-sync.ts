import { inngest } from "../client";
import {
  ConvexServerCallError,
  convexServerCall,
} from "@/lib/convex-server-call";
import { parseKajabiPurchaseEmail } from "@/lib/kajabi/parse-purchase-email";
import { reportError } from "@/lib/observability";

/**
 * Polls Resend for Kajabi purchase confirmations addressed to the support
 * inbox and enqueues them in `kajabiPurchaseInbox` for admin review.
 *
 * Why polling: the current Kajabi plan does not expose webhooks, so `support@`
 * is a recipient on each offer and Resend receives the confirmation. The
 * queue is intentionally review-only — an admin approves the onboarding.
 *
 * Data source: `GET /emails/receiving?to=<receiving address>`.
 * Dedupe: `upsertFromEmail` is idempotent on the Resend email id and the
 * Kajabi purchase id.
 */
const RESEND_API_URL = "https://api.resend.com";

type ReceivedEmailSummary = {
  id: string;
  from?: string;
  to?: string[];
  created_at?: string;
  subject?: string;
};

type ReceivedEmailDetail = {
  id: string;
  from?: string;
  to?: string[];
  created_at?: string;
  subject?: string;
  text?: string | null;
  html?: string | null;
};

function resendKey(): string {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    throw new Error("kajabi-inbox-sync: RESEND_API_KEY is not configured");
  }
  return key;
}

async function resendGet<T>(path: string): Promise<T> {
  const res = await fetch(`${RESEND_API_URL}${path}`, {
    headers: { Authorization: `Bearer ${resendKey()}` },
  });
  if (!res.ok) {
    throw new Error(
      `kajabi-inbox-sync: Resend ${path} returned ${res.status}: ${(
        await res.text()
      ).slice(0, 200)}`
    );
  }
  return (await res.json()) as T;
}

export const kajabiInboxSync = inngest.createFunction(
  {
    id: "kajabi-inbox-sync",
    name: "Sync Kajabi purchase confirmations from Resend",
    retries: 2,
    triggers: [
      { cron: "*/5 * * * *" },
      { event: "kajabi/inbox.sync" },
    ],
  },
  async ({ step }) => {
    const receivingAddress = process.env.KAJABI_INBOX_RECEIVING_ADDRESS;

    // Page through the whole receiving list, not a fixed window. The inbox
    // is a shared support address: any sender can add mail, so a burst of
    // newer messages (or a flood of purchase-shaped ones) must not push a
    // real confirmation off the end of the scan. Dedupe on the Resend email
    // id makes re-reading old pages harmless.
    //
    // Each page is its own step so a long scan is resumable instead of
    // re-fetching from the top on retry. The cap is a runaway guard only;
    // hitting it is reported so an operator can drain the backlog by hand.
    const MAX_LIST_PAGES = 40;
    const PAGE_SIZE = 100;

    const pages: ReceivedEmailSummary[][] = [];
    let after: string | undefined;
    let exhausted = false;

    for (let page = 0; page < MAX_LIST_PAGES; page++) {
      const rows = await step.run(`list-received-emails-${page}`, async () => {
        const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
        if (receivingAddress) params.set("to", receivingAddress);
        if (after) params.set("after", after);
        const pageResult = await resendGet<{ data?: ReceivedEmailSummary[] }>(
          `/emails/receiving?${params.toString()}`
        );
        return pageResult.data ?? [];
      });

      pages.push(rows);
      if (rows.length < PAGE_SIZE) {
        exhausted = true;
        break;
      }
      const lastId = rows[rows.length - 1]?.id;
      if (!lastId || lastId === after) {
        exhausted = true;
        break;
      }
      after = lastId;
    }

    const listed = pages.flat();

    if (!exhausted) {
      await reportError({
        source: "inngest:kajabi-inbox-sync",
        error: null,
        level: "warn",
        message: "Kajabi inbox scan hit its page cap; older mail was not examined",
        context: { pages: pages.length, messages: listed.length, pageSize: PAGE_SIZE },
      });
    }

    const candidates = listed.filter((email) =>
      /new purchase for/i.test(email.subject ?? "")
    );

    let inserted = 0;
    let skipped = 0;

    for (const candidate of candidates) {
      const outcome = await step.run(
        `process:${candidate.id}`,
        async (): Promise<"inserted" | "skipped"> => {
          const detail = await resendGet<ReceivedEmailDetail>(
            `/emails/receiving/${candidate.id}`
          );
          const parsed = parseKajabiPurchaseEmail({
            subject: detail.subject ?? candidate.subject ?? "",
            text: detail.text,
            html: detail.html,
          });
          if (!parsed) return "skipped";

          // `rawText` is required by the upsert endpoint. A subject-only
          // message (purchase-shaped subject, empty body) used to be sent as
          // an empty string, which the endpoint rejected with a 400 and the
          // whole sequential batch died on — leaving every older genuine
          // confirmation unimported on every subsequent poll. Skip it here
          // instead; the admin queue only ever needs messages with content.
          const rawText =
            detail.text && detail.text.trim().length > 0
              ? detail.text
              : (detail.html ?? "");
          if (rawText.trim().length === 0) return "skipped";

          const receivedAt = detail.created_at
            ? new Date(detail.created_at).getTime()
            : Date.now();

          let result: { success: boolean; inserted?: boolean };
          try {
            result = await convexServerCall<{
              success: boolean;
              inserted?: boolean;
            }>("/kajabi-purchase-inbox/upsert", {
              resendEmailId: detail.id,
              fromAddress: detail.from ?? candidate.from ?? "unknown",
              subject: detail.subject ?? candidate.subject ?? "",
              receivedAt,
              offerTitle: parsed.offerTitle,
              purchaseType: parsed.purchaseType,
              instructorName: parsed.instructorName,
              studentName: parsed.studentName,
              studentEmail: parsed.studentEmail,
              kajabiPurchaseId: parsed.kajabiPurchaseId,
              kajabiContactId: parsed.kajabiContactId,
              rawText,
            });
          } catch (error) {
            // A 4xx from the upsert is deterministic: replaying the same
            // message cannot succeed, and letting it throw would abort the
            // rest of the batch. Skip this message and keep going. 5xx,
            // auth, and network failures stay fatal so Inngest retries.
            if (
              error instanceof ConvexServerCallError &&
              error.status >= 400 &&
              error.status < 500 &&
              error.status !== 401 &&
              error.status !== 429
            ) {
              return "skipped";
            }
            throw error;
          }

          return result.inserted === false ? "skipped" : "inserted";
        }
      );

      if (outcome === "inserted") inserted += 1;
      else skipped += 1;
    }

    if (inserted > 0 || skipped > 0) {
      await reportError({
        source: "inngest:kajabi-inbox-sync",
        error: null,
        level: "info",
        message: "Kajabi inbox sync completed",
        context: {
          listed: listed.length,
          candidates: candidates.length,
          inserted,
          skipped,
        },
      });
    }

    return {
      listed: listed.length,
      candidates: candidates.length,
      inserted,
      skipped,
    };
  }
);
