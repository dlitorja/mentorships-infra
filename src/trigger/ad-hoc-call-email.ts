import { task, logger } from "@trigger.dev/sdk";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
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

const CONVEX_URL = process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL ?? "";

/**
 * PR #4c-2: sends the ad-hoc call invite email to a student whose
 * instructor just started an ad-hoc mentorship call.
 *
 * Idempotency model:
 *   1. The HTTP route `POST /api/video/start-adhoc` calls
 *      `tasks.trigger(...)` to enqueue this task after a row has
 *      been inserted into `inCallNotifications`.
 *   2. On entry, this task calls the internal query
 *      `getBySessionIdInternal` via `ConvexHttpClient` to fetch the
 *      current notification row. If `emailSentAt` is already set,
 *      we short-circuit (a previous attempt succeeded).
 *   3. If not, we send via Resend, then call `markEmailSent` to
 *      record the timestamp. Trigger.dev retries on transient
 *      failures; without this guard the recipient would get a
 *      duplicate email on every retry.
 *
 * Failure handling:
 *   - Resend returns `{ ok: false }` on bad config / hard error:
 *     we log and throw so Trigger.dev retries (the next attempt
 *     will see `emailSentAt === undefined` and try again).
 *   - Resend returns `{ ok: false, skipped: true }` when the API
 *     key is missing in dev: we log at `warn` and exit cleanly —
 *     no retry needed.
 *   - Notification row missing between enqueue and run: log at
 *     `warn`, exit cleanly. Treats the rare race (delete between
 *     trigger and send) as a no-op.
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
    if (!CONVEX_URL) {
      logger.warn("CONVEX_URL not set; skipping ad-hoc call invite email", {
        sessionId: payload.sessionId,
      });
      return { skipped: true, reason: "convex_url_not_configured" } as const;
    }

    const client = new ConvexHttpClient(CONVEX_URL);

    const notification = await client.query(
      api.inCallNotifications.getBySessionId,
      {
        recipientUserId: payload.recipientUserId,
        sessionId: payload.sessionId as never,
      }
    );

    if (!notification) {
      logger.warn("Notification row missing for ad-hoc call invite; treating as no-op", {
        sessionId: payload.sessionId,
        recipientUserId: payload.recipientUserId,
      });
      return { skipped: true, reason: "notification_missing" } as const;
    }

    if (notification.emailSentAt !== undefined) {
      logger.info("Ad-hoc call invite email already sent; short-circuiting", {
        notificationId: notification._id,
        emailSentAt: notification.emailSentAt,
      });
      return { skipped: true, reason: "already_sent" } as const;
    }

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

    await client.mutation(api.inCallNotifications.markEmailSent, {
      notificationId: notification._id,
      recipientUserId: payload.recipientUserId,
      sessionId: payload.sessionId as never,
      sentAt: Date.now(),
    });

    logger.info("Ad-hoc call invite email sent", {
      sessionId: payload.sessionId,
      recipientUserId: payload.recipientUserId,
      resendId: result.id,
    });

    return { ok: true, resendId: result.id } as const;
  },
});
