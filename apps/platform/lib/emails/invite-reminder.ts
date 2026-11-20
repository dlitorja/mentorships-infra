type InviteReminderArgs = {
  studentName?: string | null;
  instructorName: string;
  signUpUrl: string;
  appUrl: string;
  final?: boolean;
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function buildInviteReminderEmail(args: InviteReminderArgs): {
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
} {
  const name = args.studentName?.trim() || "there";
  const subject = args.final
    ? "Last reminder — finish setting up your Huckleberry mentorship"
    : "Reminder — finish setting up your Huckleberry mentorship";

  const text = [
    `Hi ${name},`,
    "",
    args.final
      ? `This is a final reminder to finish setting up your Huckleberry mentorship with ${args.instructorName}.`
      : `A quick reminder to finish setting up your Huckleberry mentorship with ${args.instructorName}.`,
    "",
    `Create your account using the email address this message was sent to: ${args.signUpUrl}`,
    "Then complete your onboarding questionnaire so your instructor knows where to start.",
    "",
    `If you already created your account, sign in at ${args.appUrl}.`,
    "",
    "If you need help, email support@huckleberry.art.",
    "",
    "— Huckleberry Mentorships",
  ].join("\n");

  const html = `
    <div style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;max-width:640px;margin:0 auto;padding:24px;color:#111827">
      <div style="font-size:18px;font-weight:700;margin-bottom:12px">Huckleberry Mentorships</div>
      <div style="padding:16px;border:1px solid #E5E7EB;border-radius:12px">
        <div style="font-weight:700;margin-bottom:6px">Hi ${escapeHtml(name)},</div>
        <div style="color:#374151;line-height:1.6;margin-bottom:12px">
          ${args.final
            ? `This is a final reminder to finish setting up your Huckleberry mentorship with <strong>${escapeHtml(args.instructorName)}</strong>.`
            : `A quick reminder to finish setting up your Huckleberry mentorship with <strong>${escapeHtml(args.instructorName)}</strong>.`}
        </div>
        <div style="color:#374151;line-height:1.6;margin-bottom:12px">
          Create your account using the email address this message was sent to, then complete your onboarding questionnaire.
        </div>
        <a href="${escapeHtml(args.signUpUrl)}" style="display:inline-block;padding:12px 16px;background:#111827;color:#fff;border-radius:10px;text-decoration:none;font-weight:600">Create your account</a>
        <p style="margin:16px 0 0 0;color:#6B7280;font-size:12px">
          Already created your account? <a href="${escapeHtml(args.appUrl)}">Sign in here</a>.<br/>
          Need help? Email <a href="mailto:support@huckleberry.art">support@huckleberry.art</a>.
        </p>
      </div>
    </div>
  `.trim();

  return {
    subject,
    html,
    text,
    headers: { "X-Email-Type": args.final ? "onboarding_invite_final_reminder" : "onboarding_invite_reminder" },
  };
}
