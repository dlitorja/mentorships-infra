import { inngest } from "../client";
import { notificationSendEventSchema } from "../types";
import { reportError } from "../../lib/observability";

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

    // TODO: Implement real delivery providers (Discord DM / email templates).

    return {
      success: true,
      type,
      userId,
      sessionPackId,
    };
  }
);

