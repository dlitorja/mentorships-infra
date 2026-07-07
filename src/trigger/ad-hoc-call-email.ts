import { task, logger } from "@trigger.dev/sdk";
import { sendEmail } from "../packages/emails/src/send";
import { buildAdHocCallInviteEmail } from "../packages/emails/src/ad-hoc-call";

type Payload = {
  notificationId: string;
  recipientUserId: string;
  recipientEmail: string;
  recipientFirstName: string | null;
  sessionId: string;
  workspaceId: string;
  instructorName: string;
  workspaceName: string;
};

/**
 * PR #4c-2: sends the ad-hoc call invite email to a student whose
 * instructor just started an ad-hoc mentorship call.
 *
 * Idempotency model:
 *   The HTTP route `POST /api/video/start-adhoc` calls
 *   `tasks.trigger(...)` with an `idempotencyKey` of
 *   `ad-hoc-call-email:{sessionId}:{recipientUserId}:{callStartedAt}`.
 *   Trigger.dev deduplicates at the task level: a re-trigger with the
 *   same key within the idempotency window returns the original run
 *   id without re-running the task body. So a transient Resend
 *   failure + retry, OR a duplicate `startAdhocCall` click, will not
 *   double-email the student.
 *
 *   Note: a *new* call (different `callStartedAt`) intentionally
 *   bypasses dedupe so the student is notified of the second call.
 *
 * Failure handling:
 *   - Resend returns `{ ok: false }` on bad config / hard error:
 *     we log and throw so Trigger.dev retries (idempotency ensures
 *     the retry doesn't produce a duplicate email).
 *   - Resend returns `{ ok: false, skipped: true }` when the API
 *     key is missing in dev: we log at `warn` and exit cleanly —
 *     no retry needed.
 */
export const sendAdHocCallInviteEmail = task({
  id: "send-ad-hoc-call-invite-email",
  retry: {
    maxAttempts: 5,
    factor: 2,
    minTimeoutInMs: 1000,
    maxTimeoutInMs: 30000,
    randomize: true,
  },
  run: async (payload: Payload) => {
    const greetingName = payload.recipientFirstName?.trim() || "there";

    const built = buildAdHocCallInviteEmail({
      instructorName: payload.instructorName,
      workspaceName: payload.workspaceName,
      workspaceId: payload.workspaceId,
      sessionId: payload.sessionId,
    });

    const personalizedSubject = `[${greetingName}] ${built.subject}`;

    const result = await sendEmail({
      to: payload.recipientEmail,
      subject: personalizedSubject,
      text: built.text,
      html: built.html,
      headers: built.headers,
    });

    if (!result.ok && "skipped" in result && result.skipped) {
      logger.warn("Ad-hoc call invite email skipped (provider not configured)", {
        sessionId: payload.sessionId,
        reason: result.reason,
      });
      return { skipped: true, reason: result.reason } as const;
    }

    if (!result.ok) {
      const errorMessage = "error" in result ? result.error : "unknown error";
      logger.error("Ad-hoc call invite email send failed", {
        sessionId: payload.sessionId,
        error: errorMessage,
      });
      throw new Error(`Resend send failed: ${errorMessage}`);
    }

    logger.info("Ad-hoc call invite email sent", {
      sessionId: payload.sessionId,
      recipientUserId: payload.recipientUserId,
      resendId: result.id,
    });

    return { ok: true, resendId: result.id } as const;
  },
});
