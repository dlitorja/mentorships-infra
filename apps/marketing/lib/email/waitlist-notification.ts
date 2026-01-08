export interface WaitlistNotificationData {
  instructorName: string;
  mentorshipType: "one-on-one" | "group";
  purchaseUrl: string;
}

export function buildWaitlistNotificationEmail(data: WaitlistNotificationData): {
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
} {
  const { instructorName, mentorshipType, purchaseUrl } = data;
  const typeLabel = mentorshipType === "one-on-one" ? "1-on-1 Mentorship" : "Group Mentorship";
  const subject = `Spot available: ${instructorName}'s ${typeLabel}`;

  const text = [
    "Great news!",
    "",
    `A spot has opened up for ${instructorName}'s ${typeLabel}.`,
    "",
    `Book now: ${purchaseUrl}`,
    "",
    "If you have any trouble, reply to this email and we'll help.",
  ].join("\n");

  const html = `
    <div style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;max-width:640px;margin:0 auto;padding:24px;color:#111827">
      <div style="font-size:18px;font-weight:700;margin-bottom:12px">Huckleberry Mentorships</div>
      <div style="padding:16px;border:1px solid #E5E7EB;border-radius:12px">
        <div style="font-weight:700;margin-bottom:12px;font-size:16px">Spot Available</div>
        <div style="color:#374151;line-height:1.6;margin-bottom:16px">
          Great news! A spot has opened up for <strong>${escapeHtml(instructorName)}</strong>'s <strong>${escapeHtml(typeLabel)}</strong>.
        </div>

        <a href="${escapeHtml(purchaseUrl)}" style="display:inline-block;padding:14px 20px;background:#111827;color:#fff;border-radius:10px;text-decoration:none;font-weight:600">Book Now</a>

        <p style="margin:16px 0 0 0;color:#6B7280;font-size:12px">
          If the button doesn't work, copy/paste this link:<br/>
          <div>${escapeHtml(purchaseUrl)}</div>
        </p>
      </div>
    </div>
  `.trim();

  return {
    subject,
    html,
    text,
    headers: {
      "X-Notification-Type": "waitlist-availability",
      "X-Instructor-Name": instructorName,
      "X-Mentorship-Type": mentorshipType,
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
