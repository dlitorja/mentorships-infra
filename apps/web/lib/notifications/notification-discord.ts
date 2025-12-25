import type { NotificationSendEvent } from "@/inngest/types";

export function buildNotificationDiscordMessage(data: NotificationSendEvent["data"]): string {
  // Keep this short and safe for DMs; avoid dumping raw context/PII.
  // We prefer the precomposed message from the event, but add a small prefix for clarity.
  const prefix =
    data.type === "renewal_reminder"
      ? "Renewal reminder"
      : data.type === "final_renewal_reminder"
        ? "Final renewal reminder"
        : data.type === "grace_period_final_warning"
          ? "Grace period ending soon"
          : "Notification";

  // Discord DMs are plain text; keep it readable.
  return `${prefix}:\n\n${data.message}`.trim();
}


