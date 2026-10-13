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

      // Greptile round-2 P1 #7: the prior loop awaited
      // each step.run sequentially, so a throw on any one
      // recipient short-circuited the rest — recipients
      // #3, #4, ... never even started their step.run.
      // Wrap per-recipient step.runs in `Promise.all` so
      // every recipient's send starts concurrently. Two
      // properties are preserved:
      //   * Inngest still CHECKPOINTS each step.run
      //     independently (a successful step.run's return
      //     value is cached by step name), so on the
      //     function-level retry triggered by the throw
      //     below, prior successful sends return from
      //     cache and do not re-send.
      //   * Resend's per-recipient `idempotencyKey`
      //     ensures the re-send is deduped at the provider.
      //
      // Trade-off: recipients now receive their emails
      // concurrently rather than sequentially. This is a
      // minor ordering change — instructors do not
      // coordinate among themselves about a single
      // student's submission.
      const sendOutcomes = await Promise.all(
        resolved.instructors
          .filter((recipient) => !!recipient.email)
          .map((recipient) => {
            const idempotencyKey = `questionnaire-submitted-notification:${resolved.submission._id}:${recipient.instructorId}`;
            return step
              .run(
                `send:${resolved.submission._id}:${recipient.instructorId}`,
                async () => {
                  // Greptile round-1 P1 #5: greet by the
                  // STUDENT's `users` row name (resolved
                  // server-side by the HTTP endpoint),
                  // not `recipient.name` which is the
                  // instructor's. Fall through to the
                  // builder's own "a new student" chain
                  // when the user row is missing.
                  const email =
                    buildQuestionnaireSubmittedToInstructorEmail({
                      studentName: resolved.student.name,
                      studentEmail: resolved.student.email ?? "",
                      onboardingId: resolved.submission.onboardingId,
                      submittedAt:
                        resolved.submission.submittedAt ?? submittedAt,
                      submissionUrl,
                    });
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
                      "error" in result &&
                      typeof result.error === "string"
                        ? result.error
                        : "skipped" in result
                        ? `provider-skipped:${result.reason}`
                        : "sendEmail-not-ok";
                    throw new Error(
                      `instructor-notification send failed for ${recipient.instructorId}: ${reason}`
                    );
                  }
                  return {
                    ok: true as const,
                    recipientId: recipient.instructorId,
                    email: recipient.email!,
                  };
                }
              )
              .catch((err: unknown) => {
                // Per-recipient catch: a thrown step.run
                // rejection would otherwise reject Promise.all
                // and mask prior successes (Promise.all fails
                // fast — only the first rejection bubbles).
                // Returning a structured failure keeps every
                // outcome visible; we re-throw the AGGREGATE
                // at the end of this block to drive the
                // Inngest retry.
                return {
                  ok: false as const,
                  recipientId: recipient.instructorId,
                  error: err instanceof Error ? err.message : String(err),
                };
              });
          })
      );

      const sendErrors: Array<{ recipientId: string; error: string }> = [];
      for (const outcome of sendOutcomes) {
        if (outcome.ok) {
          sentTo.push(outcome.email);
        } else {
          sendErrors.push({
            recipientId: outcome.recipientId,
            error: outcome.error,
          });
        }
      }

      if (sendErrors.length > 0) {
        // Greptile round-1 P1 #6: throw so Inngest retries
        // the function. On retry, prior successful step.runs
        // return from Inngest's step cache (so they do not
        // re-send); the failing recipients' steps re-run.
        // Each per-recipient .catch above already turned
        // the throw into a structured failure so we still
        // have visibility into ALL failures (not just the
        // first — which is what Promise.all alone would
        // give us).
        const summary = sendErrors
          .map((e) => `${e.recipientId}:${e.error}`)
          .join("; ");
        throw new Error(
          `instructor-notification batch had ${sendErrors.length} failure(s): ${summary}`
        );
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
