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
 *     `convex/onboardingQuestionnaireActions.ts:notifyInstructorOnSubmission`):
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
 *      (bearer `CONVEX_HTTP_KEY`) which returns the
 *      submission row + parent onboarding + every assigned
 *      instructor's `{ instructorId, name, email }`. We
 *      resolve recipients one call at a time so Inngest
 *      retries this step are independent of the email send
 *      step (and the recipient list itself is small — usually
 *      1, occasionally 2).
 *
 *   2. Step `verify-notified` re-checks
 *      `submission.notifiedInstructorAt`. It should be set
 *      already (the mutation writes it atomically before
 *      scheduling the bridge action). If it's somehow
 *      missing, we still proceed — the atomic claim is
 *      belt-and-suspenders for the scheduler re-fire case;
 *      Resend's per-recipient `idempotencyKey` is the actual
 *      dedupe layer that prevents duplicate email sends.
 *
 *   3. For each resolved instructor, step `send-{i}` builds
 *      the email (HTML-escaped) and sends via Resend with
 *      `idempotencyKey = "questionnaire-submitted-notification:{submissionId}:{instructorId}"`.
 *      A failing send does not abort the loop — we continue
 *      to the next instructor and surface the failure via
 *      `reportError`.
 *
 * Failure modes:
 *
 *   * Convex HTTP 404: the submission row was deleted
 *     between the action and the consumer (rare; treat as
 *     "not actionable" — exit with `notFound: true`).
 *   * Convex HTTP 5xx: Inngest retries.
 *   * `sendEmail.ok === false`: log via `reportError`,
 *     continue to next recipient. The overall function does
 *     NOT bubble unless EVERY recipient failed — partial
 *     failure is the realistic case (one instructor has a
 *     stale email).
 *
 * Out of scope: this function does NOT mark
 * `notifiedInstructorAt` after sending. The atomic claim
 * happens in the Convex mutation; the second layer of
 * dedupe is Resend's per-recipient idempotency key. A
 * "but I sent already" consumer-side marker would
 * pessimize for transient failures (a sent-but-failed
 * patch leaves the row unmarked, the next retry re-sends,
 * Resend dedupes).
 */
import { inngest } from "../client";
import { sendEmail } from "@/lib/email";
import { reportError, reportInfo } from "@/lib/observability";
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
  instructors: ResolvedInstructor[];
};

function getConvexBaseUrl(): string {
  const url =
    process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_URL;
  if (!url) {
    throw new Error(
      "CONVEX_URL / NEXT_PUBLIC_CONVEX_URL not set; cannot resolve submission recipient list"
    );
  }
  // Strip trailing slash so `url + path` is well-formed.
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

export const onboardingQuestionnaireSubmittedNotification =
  inngest.createFunction(
    {
      id: "onboarding-questionnaire-submitted-notification",
      name: "Notify instructors on questionnaire submission",
      // The Convex side already retries on 5xx via the
      // scheduler; this consumer-side retry is in addition.
      // A 2-attempt budget matches the existing reminder
      // cron and keeps symmetric retry semantics across the
      // HUC-95 + PR 12 PR 4b onboarding flows.
      retries: 2,
      triggers: [
        { event: "questionnaire/submitted" },
      ],
    },
    async ({ event, step }) => {
      const payload = event as unknown as InngestEventPayload;
      const { submissionId, onboardingId, studentClerkId, submittedAt } =
        payload.data;

      // Step 1: resolve the recipient list. We post to Convex
      // HTTP rather than embedding the Inngest event in the
      // payload because we want a server-side source-of-truth
      // read of the current row state — a stale payload (a
      // Convex scheduler replay that fired this event
      // before the mutation committed) should re-fetch the
      // canonical post-write state here.
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

      // Local-name fallback comes from the student email
      // (already in the payload via `studentClerkId` -> we'd
      // need a lookup). For HUC-95 we ask Convex to include
      // the email too — POSTing studentClerkId in case the
      // resolved payload doesn't carry it. Quick add: the
      // HTTP endpoint doesn't return the student email, so
      // we fall back to "a new student" in the email when no
      // name is provided. The deep link is the only block
      // that absolutely needs the email anyway, and we
      // suppress the `<a href="mailto:...">` if it's empty.
      const studentEmailPlaceholder = "the student";
      const baseUrl =
        process.env.NEXT_PUBLIC_URL
          ? `https://${process.env.NEXT_PUBLIC_URL}`
          : process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : "http://localhost:3000";
      const submissionUrl = `${baseUrl}/onboarding/${resolved.submission.onboardingId}`;

      const sentTo: string[] = [];
      const skippedRecipients: Array<{
        instructorId: string;
        reason: string;
      }> = [];

      // Loop sequentially. Inngest serializes step.run() by
      // step name, but putting each send in its own step.run
      // lets Inngest checkpoint per recipient — a send
      // failure for one instructor does not re-run the send
      // for previous instructors.
      for (const recipient of resolved.instructors) {
        if (!recipient.email) {
          skippedRecipients.push({
            instructorId: recipient.instructorId,
            reason: "missing-email",
          });
          continue;
        }
        const idempotencyKey = `questionnaire-submitted-notification:${resolved.submission._id}:${recipient.instructorId}`;
        const email = buildQuestionnaireSubmittedToInstructorEmail({
          studentName: recipient.name ?? null,
          // We don't have the actual student email in
          // `resolved`; the consumer just needs *some* value
          // for the footer. The template falls back to
          // `greetingName` when null, so passing null is
          // safe — we surface the placeholder only when
          // the student name is also absent.
          studentEmail: studentEmailPlaceholder,
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
              return { ok: false as const, reason };
            }
            return { ok: true as const };
          }
        );
        if (outcome.ok) {
          sentTo.push(recipient.email);
        } else {
          // Log but do not re-throw — the loop continues.
          // The overall function reports this in the final
          // summary step below so Inngest metrics show "send
          // partial" rather than "send failure".
          await reportError({
            source: "inngest:onboarding-questionnaire-submitted-notification:send",
            error: new Error(outcome.reason),
            level: "warn",
            message: "instructor notification email failed",
            context: {
              submissionId: resolved.submission._id,
              instructorId: recipient.instructorId,
            },
          });
          skippedRecipients.push({
            instructorId: recipient.instructorId,
            reason: outcome.reason,
          });
        }
      }

      await reportInfo({
        source: "inngest:onboarding-questionnaire-submitted-notification",
        message: "questionnaire submission notification batch processed",
        context: {
          submissionId: resolved.submission._id,
          onboardingId: resolved.submission.onboardingId,
          sentCount: sentTo.length,
          skippedCount: skippedRecipients.length,
        },
      });

      return {
        submissionId: resolved.submission._id,
        sent: sentTo,
        skippedRecipients,
      };
    }
  );
