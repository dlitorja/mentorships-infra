import { inngest } from "../client";
import { notificationSendEventSchema } from "../types";
import { reportError, reportInfo } from "../../lib/observability";
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
      await reportInfo({
        source: "inngest:notification/send",
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
        await reportInfo({
          source: "inngest:notification/send",
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

      if (sendResult.ok) {
        await reportInfo({
          source: "inngest:notification/send",
          level: "info",
          message: "Notification email sent",
          context: {
            type,
            userId,
            sessionPackId,
            resendId: sendResult.id,
          },
        });
      } else if (wasSkipped) {
        await reportInfo({
          source: "inngest:notification/send",
          level: "warn",
          message: "Notification email skipped (email not configured)",
          context: {
            type,
            userId,
            sessionPackId,
            skipped: true,
          },
        });
      } else {
        await reportError({
          source: "inngest:notification/send",
          error: sendResult,
          level: "error",
          message: "Notification email failed",
          context: {
            type,
            userId,
            sessionPackId,
          },
        });
      }
    });

    return {
      success: sendResult.ok,
      type,
      userId,
      sessionPackId,
    };
  }
);
