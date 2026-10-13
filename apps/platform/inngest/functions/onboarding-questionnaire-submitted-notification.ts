"use node";

/**
 * HUC-95 — Inngest consumer that emails assigned
 * instructor(s) when a student submits their onboarding
 * questionnaire.
 *
 * Trigger contract:
 *
 *   * Event name: `questionnaire/submitted`.
 *   * Payload schema (from
 *     `convex/onboardingQuestionnaireActions.ts`):
 *     ```
 *     {
 *       submissionId: Id<"onboardingQuestionnaireSubmissions">;
 *       onboardingId: Id<"adminOnboardings">;
 *       studentClerkId: string;
 *       submittedAt: number;
 *     }
 *     ```
 *
 * Flow:
 *
 *   1. Step `resolve-recipients` POSTs to the Convex HTTP
 *      endpoint
 *      `/onboarding/submission-for-instructor-notification`
 *      (bearer `CONVEX_HTTP_KEY`) at the `.convex.site`
 *      host. The endpoint returns `{ submission,
 *      parentOnboardingId, student, instructors }` —
 *      `student` is `{ name, email } | null` resolved
 *      from `users` so the email can name the student
 *      correctly (Greptile round-1 P1 #5).
 *   2. For each resolved instructor, step
 *      `send:{submissionId}:{instructorId}` builds the
 *      email and sends via Resend with
 *      `idempotencyKey = "questionnaire-submitted-notification:{submissionId}:{instructorId}"`.
 *      A failing send THROWS inside the step so Inngest
 *      retries the function; Resend's per-recipient
 *      `idempotencyKey` dedupes any re-deliveries
 *      (Greptile round-1 P1 #6 — partial failures no
 *      longer silently lose notifications).
 *   3. Per-step state is checkpointed: on retry, prior
 *      successful sends return from Inngest's cache and
 *      only the failed recipient is re-sent. Convex's
 *      `notifiedInstructorAt` covers the cross-system
 *      dedupe (the bridge action skips on a re-fire
 *      because the timestamp is already set).
 *
 * Configuration:
 *   * `INNGEST_EVENT_KEY` — internal Convex action reads
 *     this from env to POST to `inn.gs`. The same key
 *     powers Next.js SDK calls.
 *   * `CONVEX_HTTP_KEY` — bearer for the recipient HTTP
 *     endpoint.
 *   * `NEXT_PUBLIC_URL` / `NEXT_PUBLIC_APP_URL` /
 *     `VERCEL_URL` — base URL for the deep link. Match the
 *     ONBOARDING-REMINDER cron's pattern (no prepended
 *     `https://`; `VERCEL_URL` adds it).
 */
import { inngest } from "../client";
import { sendEmail } from "@/lib/email";
import { reportInfo } from "@/lib/observability";
import { buildQuestionnaireSubmittedToInstructorEmail } from "@/lib/emails/questionnaire-submitted-to-instructor";

type InngestEventPayload = {
  data: {
    submissionId: string;
    onboardingId: string;
    studentClerkId: string;
    submittedAt: number;
  };
};

type ResolvedInstructor = {
  instructorId: string;
  name: string | null;
  email: string | null;
};

type ResolvedStudent = {
  name: string | null;
  email: string | null;
};

type ResolvedSubmission = {
  submission: {
    _id: string;
    onboardingId: string;
    studentClerkId: string;
    status: "draft" | "submitted";
    submittedAt: number | null;
    notifiedInstructorAt: number | null;
  };
  parentOnboardingId: string;
  student: ResolvedStudent;
  instructors: ResolvedInstructor[];
};

/**
 * Greptile round-1 P1 #3: POSTing to an HTTP endpoint
 * requires the `.convex.site` host; the regular database
 * URL (`.convex.cloud`) serves queries/mutations only.
 * Mirrors the ONBOARDING-REMINDER cron helper at
 * `onboarding-questionnaire-reminders.ts:269`.
 */
function getConvexBaseUrl(): string {
  const explicit =
    process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL ?? "";
  return explicit
    .replace(/\/+$/, "")
    .replace(/\.convex\.cloud$/, ".convex.site");
}

/**
 * Greptile round-1 P1 #4: `NEXT_PUBLIC_URL` is already a
 * full URL; `VERCEL_URL` is bare and needs `https://`.
 * Mirrors the ONBOARDING-REMINDER cron helper at
 * `onboarding-questionnaire-reminders.ts:275`.
 */
function getAppBaseUrl(): string {
  const candidate =
    process.env.NEXT_PUBLIC_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null);
  if (candidate) return candidate.replace(/\/+$/, "");
  throw new Error(
    "onboarding-questionnaire-submitted-notification: NEXT_PUBLIC_URL / NEXT_PUBLIC_APP_URL / VERCEL_URL must be set"
  );
}

export const onboardingQuestionnaireSubmittedNotification =
  inngest.createFunction(
    {
      id: "onboarding-questionnaire-submitted-notification",
      name: "Notify instructors on questionnaire submission",
      // Greptile round-1 P1 #6: each per-recipient send step
      // throws on failure so Inngest retries THIS run. The
      // successful prior steps are returned from the step
      // cache on retry, so a transient outage no longer
      // silently loses notifications. We deliberately keep
      // retries at 2 (matching the reminder cron) — Resend's
      // per-recipient `idempotencyKey` covers the
      // application-layer dedupe so a retry that succeeds
      // does not double-send.
      retries: 2,
      triggers: [{ event: "questionnaire/submitted" }],
    },
    async ({ event, step }) => {
      const payload = event as unknown as InngestEventPayload;
      const { submissionId, onboardingId, studentClerkId, submittedAt } =
        payload.data;

      const resolved = await step.run(
        `resolve-recipients:${submissionId}`,
        async (): Promise<ResolvedSubmission | null> => {
          const url = `${getConvexBaseUrl()}/onboarding/submission-for-instructor-notification`;
          const res = await fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${process.env.CONVEX_HTTP_KEY ?? ""}`,
            },
            body: JSON.stringify({ submissionId }),
          });
          if (res.status === 404) {
            return null;
          }
          if (!res.ok) {
            const text = await res.text().catch(() => "");
            throw new Error(
              `submission-for-instructor-notification HTTP ${res.status}: ${text}`
            );
          }
          return (await res.json()) as ResolvedSubmission;
        }
      );

      if (!resolved) {
        await reportInfo({
          source: "inngest:onboarding-questionnaire-submitted-notification",
          message:
            "submission row not found at consumer time — skipping without retry",
          context: { submissionId, onboardingId },
        });
        return { skipped: true, reason: "submission-not-found" } as const;
      }

      if (!resolved.instructors.length) {
        // No instructors assigned (parent onboarding has empty
        // `perInstructor`); bail without an email send.
        await reportInfo({
          source: "inngest:onboarding-questionnaire-submitted-notification",
          message: "submission has no assigned instructors — skipping",
          context: { submissionId, onboardingId },
        });
        return { skipped: true, reason: "no-instructors-assigned" } as const;
      }

      // Greptile round-1 P1 #4: pull the base URL from
      // envs via the helper that mirrors the reminder cron.
      // We deliberately do NOT prepend `https://` because
      // `NEXT_PUBLIC_URL` is a full URL.
      const baseUrl = getAppBaseUrl();
      const submissionUrl = `${baseUrl}/onboarding/${resolved.submission.onboardingId}`;

      const sentTo: string[] = [];

      // Loop sequentially. Each send is its own step.run
      // so Inngest checkpoints per recipient: a failed
      // send throws inside the step (P1 #6 fix) and Inngest
      // retries the function. On retry, prior successful
      // step.runs are restored from Inngest's cache; only
      // the failed recipient re-runs. The Resend
      // `idempotencyKey` ensures the re-send is deduped on
      // Resend's side.
      for (const recipient of resolved.instructors) {
        if (!recipient.email) {
          // The HTTP endpoint already drops recipients with
          // missing emails via `getInstructorRecipientsForSubmissionNotification`,
          // but the consumer-side guard is a defensive belt
          // in case a future refactor lets one through. We
          // SKIP (no throw) — a missing email is not a
          // transient failure.
          continue;
        }
        const idempotencyKey = `questionnaire-submitted-notification:${resolved.submission._id}:${recipient.instructorId}`;
        // Greptile round-1 P1 #5: greet by the STUDENT's
        // `users` row name (resolved server-side by the
        // HTTP endpoint), not the instructor's name which
        // is `recipient.name`. Fall through to the email
        // builder's own `studentEmail` local-part /
        // "a new student" chain when the user row is missing.
        const email = buildQuestionnaireSubmittedToInstructorEmail({
          studentName: resolved.student.name,
          studentEmail: resolved.student.email ?? "",
          onboardingId: resolved.submission.onboardingId,
          submittedAt: resolved.submission.submittedAt ?? submittedAt,
          submissionUrl,
        });
        const outcome = await step.run(
          `send:${resolved.submission._id}:${recipient.instructorId}`,
          async () => {
            const result = await sendEmail({
              to: recipient.email!,
              subject: email.subject,
              html: email.html,
              text: email.text,
              headers: email.headers,
              idempotencyKey,
            });
            if (!result.ok) {
              const reason =
                "error" in result && typeof result.error === "string"
                  ? result.error
                  : "skipped" in result
                  ? `provider-skipped:${result.reason}`
                  : "sendEmail-not-ok";
              throw new Error(
                `instructor-notification send failed for ${recipient.instructorId}: ${reason}`
              );
            }
            return { ok: true as const, recipientId: recipient.instructorId };
          }
        );
        if (outcome.ok) {
          sentTo.push(recipient.email);
        }
      }

      await reportInfo({
        source: "inngest:onboarding-questionnaire-submitted-notification",
        message: "questionnaire submission notification batch processed",
        context: {
          submissionId: resolved.submission._id,
          onboardingId: resolved.submission.onboardingId,
          sentCount: sentTo.length,
          recipientCount: resolved.instructors.length,
        },
      });

      return {
        submissionId: resolved.submission._id,
        sent: sentTo,
        recipientCount: resolved.instructors.length,
      };
    }
  );
