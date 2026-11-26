type InstructorReviewReminderArgs = {
  instructorName: string;
  studentName: string;
  reviewUrl: string;
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function buildInstructorReviewReminderEmail(
  args: InstructorReviewReminderArgs
): {
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
} {
  const name = args.instructorName?.trim() || "there";
  const subject = `Reminder — ${args.studentName} is waiting for your review`;

  const text = [
    `Hi ${name},`,
    "",
    `${args.studentName} submitted their onboarding questionnaire 3 days ago and it is still waiting for your review.`,
    "",
    `Review it here: ${args.reviewUrl}`,
    "",
    "The questionnaire covers their goals, inspirations, and current artwork, so it is the best starting point for your first session.",
    "",
    "If anything looks off, reply to this email and we will help.",
    "",
    "— Huckleberry Mentorships",
  ].join("\n");

  const html = `
    <div style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;max-width:640px;margin:0 auto;padding:24px;color:#111827">
      <div style="font-size:18px;font-weight:700;margin-bottom:12px">Huckleberry Mentorships</div>
      <div style="padding:16px;border:1px solid #E5E7EB;border-radius:12px">
        <div style="font-weight:700;margin-bottom:6px">Hi ${escapeHtml(name)},</div>
        <div style="color:#374151;line-height:1.6;margin-bottom:12px">
          <strong>${escapeHtml(args.studentName)}</strong> submitted their onboarding questionnaire 3 days ago and it is still waiting for your review.
        </div>
        <div style="color:#374151;line-height:1.6;margin-bottom:12px">
          The questionnaire covers their goals, inspirations, and current artwork, so it is the best starting point for your first session.
        </div>
        <a href="${escapeHtml(args.reviewUrl)}" style="display:inline-block;padding:12px 16px;background:#111827;color:#fff;border-radius:10px;text-decoration:none;font-weight:600">Review the questionnaire</a>
        <p style="margin:16px 0 0 0;color:#6B7280;font-size:12px">
          If the button doesn't work, copy/paste this link:<br/>
          <div>${escapeHtml(args.reviewUrl)}</div>
        </p>
      </div>
    </div>
  `.trim();

  return {
    subject,
    html,
    text,
    headers: { "X-Email-Type": "instructor_review_reminder" },
  };
}
