import { inngest } from "../client";
import { convexServerCall } from "@/lib/convex-server-call";
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

    // Fetch the newest page, then keep paging older while the page is full.
    // Without this, a confirmation that falls off the first 20 after an
    // outage or a busy window would never be imported. Dedupe makes
    // reprocessing the overlap safe.
    const listed = await step.run("list-received-emails", async () => {
      const all: ReceivedEmailSummary[] = [];
      let after: string | undefined;
      for (let page = 0; page < 3; page++) {
        const params = new URLSearchParams({ limit: "100" });
        if (receivingAddress) params.set("to", receivingAddress);
        if (after) params.set("after", after);
        const pageResult = await resendGet<{ data?: ReceivedEmailSummary[] }>(
          `/emails/receiving?${params.toString()}`
        );
        const rows = pageResult.data ?? [];
        all.push(...rows);
        if (rows.length < 100) break;
        const lastId = rows[rows.length - 1]?.id;
        if (!lastId || lastId === after) break;
        after = lastId;
      }
      return { data: all };
    });

    const candidates = (listed.data ?? []).filter((email) =>
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

          const receivedAt = detail.created_at
            ? new Date(detail.created_at).getTime()
            : Date.now();

          const result = await convexServerCall<{
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
            rawText:
              detail.text && detail.text.trim().length > 0
                ? detail.text
                : (detail.html ?? ""),
          });

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
          listed: listed.data?.length ?? 0,
          candidates: candidates.length,
          inserted,
          skipped,
        },
      });
    }

    return {
      listed: listed.data?.length ?? 0,
      candidates: candidates.length,
      inserted,
      skipped,
    };
  }
);
