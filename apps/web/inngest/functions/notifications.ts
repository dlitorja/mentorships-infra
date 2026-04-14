import { inngest } from "../client";
import { notificationSendEventSchema } from "../types";
import { reportError } from "../../lib/observability";
import { and, db, eq, getUserById, userIdentities } from "@mentorships/db";
import { sendEmail } from "@/lib/email";
import { buildNotificationEmail } from "@/lib/notifications/notification-email";
import { buildNotificationDiscordMessage } from "@/lib/notifications/notification-discord";
import { DiscordApiError, sendDm } from "@/lib/discord";

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

    const discordUserId = await step.run("get-user-discord-id", async () => {
      const [identity] = await db
        .select()
        .from(userIdentities)
        .where(and(eq(userIdentities.userId, userId), eq(userIdentities.provider, "discord")))
        .limit(1);

      return identity?.providerUserId ?? null;
    });

    const emailResult = await step.run("send-email", async () => {
      if (!emailAddress) {
        return { ok: false as const, skipped: true as const, reason: "missing_email" };
      }

      const emailContent = buildNotificationEmail(parsed.data);

      return await sendEmail({
        to: emailAddress,
        subject: emailContent.subject,
        html: emailContent.html,
        text: emailContent.text,
        headers: emailContent.headers,
      });
    });

    await step.run("report-email-result", async () => {
      const wasSkipped = !emailResult.ok && "skipped" in emailResult && emailResult.skipped === true;
      const resendId = emailResult.ok ? emailResult.id : null;

      await reportError({
        source: "inngest:notification/send",
        error: emailResult.ok ? null : emailResult,
        level: emailResult.ok ? "info" : wasSkipped ? "warn" : "error",
        message: emailResult.ok
          ? "Notification email sent"
          : wasSkipped && "reason" in emailResult && emailResult.reason === "missing_email"
            ? "Notification email skipped: user has no email in DB"
            : wasSkipped
              ? "Notification email skipped"
              : "Notification email failed",
        context: {
          type,
          userId,
          sessionPackId,
          resendId,
          skipped: wasSkipped,
          reason: wasSkipped && "reason" in emailResult ? emailResult.reason : null,
        },
      });
    });

    const discordResult = await step.run("send-discord-dm", async () => {
      if (!discordUserId) {
        return { ok: false as const, skipped: true as const, reason: "missing_discord_identity" as const };
      }

      try {
        const msg = buildNotificationDiscordMessage(parsed.data);
        const res = await sendDm({ discordUserId, content: msg });
        return { ok: true as const, messageId: res.messageId };
      } catch (err) {
        if (err instanceof DiscordApiError && err.status === 0) {
          // Not configured.
          return { ok: false as const, skipped: true as const, reason: "discord_not_configured" as const };
        }
        throw err;
      }
    });

    await step.run("report-discord-result", async () => {
      const wasSkipped = !discordResult.ok && "skipped" in discordResult && discordResult.skipped === true;

      await reportError({
        source: "inngest:notification/send",
        error: discordResult.ok ? null : discordResult,
        level: discordResult.ok ? "info" : wasSkipped ? "warn" : "error",
        message: discordResult.ok
          ? "Notification Discord DM sent"
          : wasSkipped
            ? "Notification Discord DM skipped"
            : "Notification Discord DM failed",
        context: {
          type,
          userId,
          sessionPackId,
          discordUserId: discordUserId ?? null,
          discordMessageId: discordResult.ok ? discordResult.messageId : null,
          skipped: wasSkipped,
        },
      });
    });

    return {
      success: ("ok" in emailResult && emailResult.ok) || discordResult.ok,
      type,
      userId,
      sessionPackId,
      email: {
        ok: emailResult.ok,
        skipped: !emailResult.ok && "skipped" in emailResult ? emailResult.skipped === true : false,
        reason: !emailResult.ok && "reason" in emailResult ? emailResult.reason : null,
      },
      discord: {
        ok: discordResult.ok,
        skipped: !discordResult.ok && "skipped" in discordResult ? discordResult.skipped === true : false,
      },
    };
  }
);
