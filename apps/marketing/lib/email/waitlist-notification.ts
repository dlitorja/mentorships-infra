export interface WaitlistNotificationData {
  instructorName: string;
  mentorshipType: "one-on-one" | "group";
  purchaseUrl: string;
}

function sanitizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "#";
    }
    return parsed.href;
  } catch {
    return "#";
  }
}

export function buildWaitlistNotificationEmail(data: WaitlistNotificationData): {
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
} {
  const { instructorName, mentorshipType, purchaseUrl } = data;
  const typeLabel = mentorshipType === "one-on-one" ? "1-on-1 Mentorship" : "Group Mentorship";
  const sanitizedInstructorName = sanitizeHeaderValue(instructorName);
  const subject = `Spot available: ${sanitizedInstructorName}'s ${typeLabel}`;

  const sanitizedPurchaseUrl = sanitizeUrl(purchaseUrl);
  const urlFallbackMessage = sanitizedPurchaseUrl === "#"
    ? "Visit your dashboard to book your mentorship."
    : `Book now: ${sanitizedPurchaseUrl}`;

  const text = [
    "Great news!",
    "",
    `A spot has opened up for ${instructorName}'s ${typeLabel}.`,
    "",
    urlFallbackMessage,
    "",
    "If you have any trouble, reply to this email and we'll help.",
  ].join("\n");

  const html = `
    <div style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;max-width:640px;margin:0 auto;padding:24px;color:#111827">
      <div style="font-size:18px;font-weight:700;margin-bottom:12px">Huckleberry Mentorships</div>
      <div style="padding:16px;border:1px solid #E5E7EB;border-radius:12px">
        <div style="font-weight:700;margin-bottom:12px;font-size:16px">Spot Available</div>
        <div style="color:#374151;line-height:1.6;margin-bottom:16px">
          Great news! A spot has opened up for <strong>${escapeHtml(sanitizedInstructorName)}</strong>'s <strong>${escapeHtml(typeLabel)}</strong>.
        </div>

        ${sanitizedPurchaseUrl === "#"
          ? `<p style="margin:16px 0 0 0;color:#6B7280;font-size:12px">Visit your dashboard to book your mentorship.</p>`
          : `
            <a href="${sanitizedPurchaseUrl}" style="display:inline-block;padding:14px 20px;background:#111827;color:#fff;border-radius:10px;text-decoration:none;font-weight:600">Book Now</a>

            <p style="margin:16px 0 0 0;color:#6B7280;font-size:12px">
              If button doesn't work, copy/paste this link:<br/>
              <span style="display:block;font-family:monospace;background:#f3f4f6;padding:4px 8px;margin-top:4px">${escapeHtml(sanitizedPurchaseUrl)}</span>
            </p>`
        }
      </div>
    </div>
  `.trim();

  return {
    subject,
    html,
    text,
    headers: {
      "X-Notification-Type": "waitlist-availability",
      "X-Instructor-Name": sanitizedInstructorName,
      "X-Mentorship-Type": sanitizeHeaderValue(mentorshipType),
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

function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n]/g, "").replace(/[\x00-\x1F\x7F]/g, "");
}
