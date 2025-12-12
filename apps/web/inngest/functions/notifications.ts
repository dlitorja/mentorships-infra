import { inngest } from "../client";
import { notificationSendEventSchema } from "../types";
import { reportError } from "../../lib/observability";
import { getUserById } from "@mentorships/db";
import { sendEmail } from "@/lib/email";
import { buildNotificationEmail } from "@/lib/notifications/notification-email";

/**
 * Handle notification delivery.
 *
 * Today this is intentionally minimal: we validate payload shape and forward to
 * observability. Discord/email providers can be integrated behind this handler.
 */
export const handleNotificationSend = inngest.createFunction(
  {
    id: "handle-notification-send",
    name: "Handle Notification Send",
    retries: 2,
  },
  { event: "notification/send" },
  async ({ event, step }) => {
    const parsed = notificationSendEventSchema.parse({
      name: event.name,
      data: event.data,
    });

    const { type, userId, sessionPackId, message, sessionNumber, gracePeriodEndsAt } =
      parsed.data;

    await step.run("report-notification", async () => {
      await reportError({
        source: "inngest:notification/send",
        error: null,
        level: "info",
        message: `notification/send: ${type}`,
        context: {
          type,
          userId,
          sessionPackId,
          sessionNumber: sessionNumber ?? null,
          gracePeriodEndsAt: gracePeriodEndsAt ? gracePeriodEndsAt.toISOString() : null,
          // Keep message, but cap to avoid huge payloads / PII leaks.
          message: message.slice(0, 500),
        },
      });
    });

    const emailAddress = await step.run("get-user-email", async () => {
      const user = await getUserById(userId);
      return user?.email ?? null;
    });

    if (!emailAddress) {
      await step.run("report-missing-email", async () => {
        await reportError({
          source: "inngest:notification/send",
          error: null,
          level: "warn",
          message: "Notification email skipped: user has no email in DB",
          context: { type, userId, sessionPackId },
        });
      });

      return {
        success: false,
        skipped: true,
        reason: "missing_email" as const,
        type,
        userId,
        sessionPackId,
      };
    }

    const emailContent = buildNotificationEmail(parsed.data);

    const sendResult = await step.run("send-email", async () => {
      return await sendEmail({
        to: emailAddress,
        subject: emailContent.subject,
        html: emailContent.html,
        text: emailContent.text,
        headers: emailContent.headers,
      });
    });

    await step.run("report-email-result", async () => {
      const wasSkipped = !sendResult.ok && "skipped" in sendResult && sendResult.skipped === true;

      await reportError({
        source: "inngest:notification/send",
        error: sendResult.ok ? null : sendResult,
        level: sendResult.ok ? "info" : wasSkipped ? "warn" : "error",
        message: sendResult.ok
          ? "Notification email sent"
          : wasSkipped
            ? "Notification email skipped (email not configured)"
            : "Notification email failed",
        context: {
          type,
          userId,
          sessionPackId,
          resendId: sendResult.ok ? sendResult.id : null,
          skipped: wasSkipped,
        },
      });
    });

    return {
      success: sendResult.ok,
      type,
      userId,
      sessionPackId,
    };
  }
);
