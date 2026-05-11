import type { NotificationSendEvent } from "@/inngest/types";

type NotificationSendData = NotificationSendEvent["data"];

export type NotificationEmail = {
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
};

function getBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_URL) {
    return process.env.NEXT_PUBLIC_URL;
  }

  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("NEXT_PUBLIC_URL or VERCEL_URL must be set in production");
  }

  return "http://localhost:3000";
}

function getCtaUrl(): string {
  // Renewal/purchase flow is currently driven from instructor pages.
  // This is the safest stable CTA until we have a dedicated pricing/renewal page.
  return `${getBaseUrl()}/instructors`;
}

function subjectForType(data: NotificationSendData): string {
  switch (data.type) {
    case "renewal_reminder":
      return "1 session left — renew now to keep momentum";
    case "final_renewal_reminder":
      return "Your pack is complete — renew within 72 hours to keep your seat";
    case "grace_period_final_warning":
      return "Final warning: your seat will be released soon";
  }
}

function titleForType(data: NotificationSendData): string {
  switch (data.type) {
    case "renewal_reminder":
      return "Renewal reminder";
    case "final_renewal_reminder":
      return "Final renewal reminder";
    case "grace_period_final_warning":
      return "Grace period ending soon";
  }
}

export function buildNotificationEmail(data: NotificationSendData): NotificationEmail {
  const ctaUrl = getCtaUrl();
  const subject = subjectForType(data);
  const title = titleForType(data);

  const graceLine = data.gracePeriodEndsAt
    ? `Grace period ends: ${data.gracePeriodEndsAt.toLocaleString("en-US", { timeZone: "UTC" })} UTC`
    : null;

  const sessionLine =
    typeof data.sessionNumber === "number" ? `Session number: ${data.sessionNumber}` : null;

  const text = [
    title,
    "",
    data.message,
    "",
    sessionLine,
    graceLine,
    "",
    `Renew here: ${ctaUrl}`,
    "",
    "If you have any trouble, reply to this email and we’ll help.",
  ]
    .filter((v): v is string => typeof v === "string" && v.length > 0)
    .join("\n");

  const html = `
    <div style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;max-width:640px;margin:0 auto;padding:24px;color:#111827">
      <div style="font-size:18px;font-weight:700;margin-bottom:12px">Huckleberry Mentorships</div>
      <div style="padding:16px;border:1px solid #E5E7EB;border-radius:12px">
        <div style="font-weight:700;margin-bottom:6px">${title}</div>
        <div style="color:#374151;line-height:1.6;margin-bottom:12px">${escapeHtml(
          data.message
        )}</div>

        ${
          sessionLine
            ? `<div style="color:#6B7280;font-size:12px;margin-bottom:6px">${escapeHtml(
                sessionLine
              )}</div>`
            : ""
        }
        ${
          graceLine
            ? `<div style="color:#6B7280;font-size:12px;margin-bottom:12px">${escapeHtml(
                graceLine
              )}</div>`
            : ""
        }

        <a href="${ctaUrl}" style="display:inline-block;padding:12px 16px;background:#111827;color:#fff;border-radius:10px;text-decoration:none;font-weight:600">Renew now</a>

        <p style="margin:16px 0 0 0;color:#6B7280;font-size:12px">
          If the button doesn’t work, copy/paste this link:<br/>
          <div>${ctaUrl}</div>
        </p>
      </div>
    </div>
  `.trim();

  return {
    subject,
    html,
    text,
    headers: {
      "X-Notification-Type": data.type,
      "X-Session-Pack-Id": data.sessionPackId,
    },
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
