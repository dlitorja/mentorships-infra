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
 */
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
      const url = `${getConvexBaseUrl()}/onboarding/stale-questionnaire`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.CONVEX_HTTP_KEY ?? ""}`,
        },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(
          `stale-questionnaire scan failed (HTTP ${res.status}): ${text}`
        );
      }
      const json = (await res.json()) as {
        drafts: Array<{
          onboardingId: string;
          submissionId: string;
          studentEmail: string;
          studentName: string | null;
          reminderCount: number;
        }>;
      };
      return json.drafts;
    });

    if (!drafts.length) {
      return { sent: 0 };
    }

    const baseUrl = getAppBaseUrl();
    const maxReminders = Number(
      process.env.ONBOARDING_REMINDER_MAX_COUNT ?? "3"
    );

    let sent = 0;
    for (const draft of drafts) {
      await step.run(`send:${draft.submissionId}`, async () => {
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
          const questionnaireUrl = `${baseUrl}/onboarding/${draft.onboardingId}/questionnaire`;
          const email = buildOnboardingReminderEmail({
            studentName: draft.studentName,
            studentEmail: draft.studentEmail,
            onboardingId: draft.onboardingId,
            questionnaireUrl,
            reminderNumber: next,
            maxReminders,
          });
          const result = await sendEmail({
            to: draft.studentEmail,
            subject: email.subject,
            html: email.html,
            text: email.text,
            headers: email.headers,
            idempotencyKey: `onboarding-reminder:${draft.submissionId}:${next}`,
          });
          if (!result.ok) {
            const errMsg =
              "error" in result && typeof result.error === "string"
                ? result.error
                : "skipped" in result
                ? `skipped: ${result.reason}`
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
          sent += 1;
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
    }

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
