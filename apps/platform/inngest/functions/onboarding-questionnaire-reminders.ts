"use node";

import { inngest } from "../client";
import { sendEmail } from "@/lib/email";
import { reportError } from "@/lib/observability";
import { getConvexClient } from "@/lib/convex";
import { buildOnboardingReminderEmail } from "@/lib/emails/onboarding-reminder-email";

/**
 * PR 12 PR 4b — hourly cron that nudges students with stale
 * onboarding questionnaire drafts.
 *
 * Flow:
 *   1. Cron fires at the top of every hour.
 *   2. Step `scan` calls the Convex HTTP endpoint
 *      `/onboarding/stale-questionnaire` (bearer-auth via
 *      `convexServerCall`) which returns up to N stale drafts
 *      filtered by `ONBOARDING_REMINDER_STALE_MS`,
 *      `ONBOARDING_REMINDER_MAX_COUNT`, and the assigned student's
 *      Clerk identity.
 *   3. For each stale draft, step `send` re-checks the row is still
 *      `draft` (race-safe against beacon-then-submit), then sends
 *      the reminder email and patches `lastReminderSentAt` +
 *      `reminderCount`.
 *
 * Why the re-check: the beacon stamps `lastSeenAt` but does NOT
 * advance `reminderCount`; the cron is the only writer. A student
 * who submits while the cron is running could otherwise receive a
 * reminder for a just-submitted questionnaire.
 *
 * Greptile P1 follow-up: the scan is paginated. Convex queries can
 * only `.paginate()` once per handler, so each scan call reads
 * one page (`STALE_SCAN_PAGE_SIZE` rows). The cron loops with
 * `nextCursor` until the candidate batch fills up, the cursor
 * returns `isDone`, or an entire page yields no eligible row
 * (which means we've walked past the candidate cluster — the
 * index is sorted by `updatedAt` ascending).
 */
const SCAN_MAX_PAGES = 5;

export const onboardingQuestionnaireReminders = inngest.createFunction(
  {
    id: "onboarding-questionnaire-reminders",
    name: "Onboarding questionnaire reminders",
    retries: 2,
    triggers: [
      { cron: "0 * * * *" }, // top of every hour
    ],
  },
  async ({ step }) => {
    const drafts = await step.run("scan", async () => {
      // Greptile P1 follow-up: return the result from step.run so
      // Inngest can restore it across a resume. Without a return
      // value, `drafts` would be empty on resume (the step
      // callback isn't re-run) and the function would exit
      // before sending any reminders.
      const url = `${getConvexBaseUrl()}/onboarding/stale-questionnaire`;
      const collected: Array<{
        onboardingId: string;
        submissionId: string;
        studentEmail: string;
        studentName: string | null;
        reminderCount: number;
      }> = [];
      let cursor: string | null = null;
      for (let page = 0; page < SCAN_MAX_PAGES; page += 1) {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.CONVEX_HTTP_KEY ?? ""}`,
          },
          body: JSON.stringify({ cursor }),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(
            `stale-questionnaire scan failed (HTTP ${res.status}): ${text}`
          );
        }
        const json = (await res.json()) as {
          candidates: Array<{
            onboardingId: string;
            submissionId: string;
            studentEmail: string;
            studentName: string | null;
            reminderCount: number;
            lastSeenAt: number | null;
          }>;
          nextCursor: string | null;
          isDone: boolean;
          pageHadEligible: boolean;
        };
        collected.push(...json.candidates);
        // If we've filled the batch or hit the end of the
        // partition, stop. Likewise if an entire page had no
        // eligible row, the remaining pages are unlikely to have
        // any either (newer drafts surface first in the index).
        if (json.isDone || !json.pageHadEligible) break;
        cursor = json.nextCursor;
      }
      return collected;
    });

    if (!drafts.length) {
      return { sent: 0 };
    }

    const baseUrl = getAppBaseUrl();
    const maxReminders = Number(
      process.env.ONBOARDING_REMINDER_MAX_COUNT ?? "3"
    );

    // Greptile P1 follow-up (round 7): aggregate `sent` from the
    // step's return values instead of mutating an outer-scope
    // counter inside the callback. Inngest restores step results
    // from their return values on resume — if `sent` lives
    // outside, it's lost across resumes and we under-report.
    const stepResults: Array<{ sent?: boolean }> = [];
    for (const draft of drafts) {
      const result = await step.run(`send:${draft.submissionId}`, async () => {
        try {
          // Re-check inside the step so a beacon-then-submit that
          // landed between scan and send doesn't send a stale
          // reminder. Convex read is cheap; the `submitQuestionnaire`
          // path takes a write lock on the row.
          const status = await fetchReadOnlyDraftStatus(draft.onboardingId);
          if (status !== "draft") {
            return { skipped: true, reason: status ?? "missing" };
          }
          const next = draft.reminderCount + 1;
          if (next > maxReminders) {
            return { skipped: true, reason: "max-reached" };
          }
          // Greptile P1 #11: link through Clerk's sign-in redirect so a
          // logged-out tab lands back on the questionnaire after auth. The
          // proxy's protected-page list does not include /onboarding so
          // direct links hit notFound() before reaching ProtectedLayout.
          const signInPath = `/sign-in?redirect_url=${encodeURIComponent(
            `/onboarding/${draft.onboardingId}/questionnaire`
          )}`;
          const questionnaireUrl = `${baseUrl}${signInPath}`;
          const email = buildOnboardingReminderEmail({
            studentName: draft.studentName,
            studentEmail: draft.studentEmail,
            onboardingId: draft.onboardingId,
            questionnaireUrl,
            reminderNumber: next,
            maxReminders,
          });
          const sendResult = await sendEmail({
            to: draft.studentEmail,
            subject: email.subject,
            html: email.html,
            text: email.text,
            headers: email.headers,
            idempotencyKey: `onboarding-reminder:${draft.submissionId}:${next}`,
          });
          if (!sendResult.ok) {
            const errMsg =
              "error" in sendResult && typeof sendResult.error === "string"
                ? sendResult.error
                : "skipped" in sendResult
                ? `skipped: ${sendResult.reason}`
                : "sendEmail returned not-ok";
            reportError({
              source: "inngest:onboarding-questionnaire-reminders:send",
              error: new Error(errMsg),
              level: "warn",
              message: "Reminder email failed",
              context: { submissionId: draft.submissionId },
            });
            return { skipped: true, reason: "send-failed" };
          }
          await markReminderSent(draft.submissionId, next);
          return { sent: true };
        } catch (err) {
          reportError({
            source: "inngest:onboarding-questionnaire-reminders:send",
            error: err instanceof Error ? err : new Error(String(err)),
            level: "warn",
            message: "Reminder step threw",
            context: { submissionId: draft.submissionId },
          });
          return { skipped: true, reason: "exception" };
        }
      });
      stepResults.push(result);
    }

    const sent = stepResults.filter((r) => r.sent).length;
    return { sent, considered: drafts.length };
  }
);

function getConvexBaseUrl(): string {
  const explicit =
    process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL ?? "";
  return explicit.replace(/\/+$/, "").replace(/\.convex\.cloud$/, ".convex.site");
}

function getAppBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "http://localhost:3000"
  ).replace(/\/+$/, "");
}

/**
 * Re-reads the submission row status from Convex. Uses a raw
 * ConvexHttpClient because the `getQuestionnaireForCurrentUser`
 * query is auth-gated (we want a server-side view, not the
 * student's own session). The HTTP endpoint we call returns the
 * status alone so we don't need to pass identity tokens.
 */
async function fetchReadOnlyDraftStatus(
  onboardingId: string
): Promise<"draft" | "submitted" | null> {
  const url = `${getConvexBaseUrl()}/onboarding/questionnaire-status`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.CONVEX_HTTP_KEY ?? ""}`,
    },
    body: JSON.stringify({ onboardingId }),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { status: "draft" | "submitted" | null };
  return json.status ?? null;
}

/**
 * Patches the submission row after a successful send. Mirrors the
 * shape of the public `recordQuestionnaireSeen` mutation but
 * advances `reminderCount` and `lastReminderSentAt` instead.
 */
async function markReminderSent(
  submissionId: string,
  next: number
): Promise<void> {
  const url = `${getConvexBaseUrl()}/onboarding/mark-reminder-sent`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.CONVEX_HTTP_KEY ?? ""}`,
    },
    body: JSON.stringify({ submissionId, next }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `mark-reminder-sent failed (HTTP ${res.status}): ${text}`
    );
  }
}

// Suppress unused-import warnings when these are only used in
// future iterations of the reminder flow.
void getConvexClient;
