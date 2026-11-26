type PackCheckInEmailArgs = {
  studentName: string;
  instructorName: string;
  remainingSessions: number;
  totalSessions: number;
  expiresAt: number | null;
  bookingUrl: string;
};

export type PackCheckInEmail = {
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/**
 * Check-in email for a student with sessions left (D6).
 *
 * Purpose is a conversation, not a sales pitch: confirm whether they intend to
 * continue, and make it easy to book or reply. No expiry threat, because
 * sessions are not forfeited.
 */
export function buildPackCheckInEmail(args: PackCheckInEmailArgs): PackCheckInEmail {
  const greetingName = args.studentName?.trim() || "there";
  const expiresLine = args.expiresAt
    ? `Your access date is ${new Date(args.expiresAt).toLocaleDateString("en-US", {
        timeZone: "UTC",
        year: "numeric",
        month: "long",
        day: "numeric",
      })}.`
    : "";

  const subject = `You still have ${args.remainingSessions} session${
    args.remainingSessions === 1 ? "" : "s"
  } with ${args.instructorName}`;

  const text = [
    `Hi ${greetingName},`,
    "",
    `You have ${args.remainingSessions} of ${args.totalSessions} sessions left with ${args.instructorName}.`,
    expiresLine,
    "",
    "Nothing has been cancelled and your sessions are safe.",
    "",
    "Are you planning to continue? You can book your next session here:",
    args.bookingUrl,
    "",
    "If you are taking a break, just reply to this email and we'll extend your access.",
    "",
    "Huckleberry Mentorships",
  ]
    .filter((line) => line !== "")
    .join("\n");

  const html = `
    <div style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;max-width:640px;margin:0 auto;padding:24px;color:#111827">
      <div style="font-size:18px;font-weight:700;margin-bottom:12px">Huckleberry Mentorships</div>
      <div style="padding:16px;border:1px solid #E5E7EB;border-radius:12px">
        <div style="font-weight:700;margin-bottom:6px">You have sessions left</div>
        <div style="color:#374151;line-height:1.6;margin-bottom:12px">
          Hi ${escapeHtml(greetingName)}, you have
          <strong>${args.remainingSessions} of ${args.totalSessions}</strong> sessions left with
          <strong>${escapeHtml(args.instructorName)}</strong>.
          ${expiresLine ? escapeHtml(expiresLine) : ""}
        </div>
        <div style="color:#374151;line-height:1.6;margin-bottom:16px">
          Nothing has been cancelled and your sessions are safe. Are you planning to continue?
        </div>
        <a href="${args.bookingUrl}" style="display:inline-block;padding:12px 16px;background:#111827;color:#fff;border-radius:10px;text-decoration:none;font-weight:600">Book your next session</a>
        <p style="margin:16px 0 0 0;color:#6B7280;font-size:13px">
          Taking a break? Reply to this email and we&apos;ll extend your access.
        </p>
      </div>
    </div>
  `.trim();

  return {
    subject,
    html,
    text,
    headers: { "X-Email-Type": "pack_checkin", "X-Session-Pack-Id": "" },
  };
}
