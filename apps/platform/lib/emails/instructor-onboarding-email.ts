type InstructorOnboardingEmailArgs = {
  instructorName: string;
  studentName: string | null;
  studentEmail: string | null;
  sessionsPurchased: number;
  dashboardUrl: string;
};

export type InstructorOnboardingEmail = {
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
};

export function buildInstructorOnboardingEmail(
  args: InstructorOnboardingEmailArgs
): InstructorOnboardingEmail {
  const subject = `New student — ${args.studentName || "a new student"} has joined your mentorship`;

  const greetingName = args.instructorName?.trim()
    ? args.instructorName.trim()
    : "there";

  const studentDisplay = args.studentName?.trim()
    ? args.studentName.trim()
    : args.studentEmail || "A new student";

  const contactInfo = args.studentEmail
    ? `\nStudent email: ${args.studentEmail}`
    : "";

  const text = [
    `Hi ${greetingName},`,
    "",
    `A new student has purchased your mentorship sessions!`,
    "",
    `Student: ${studentDisplay}${contactInfo}`,
    `Sessions: ${args.sessionsPurchased}`,
    "",
    `Next steps:`,
    `- View your student in your Dashboard: ${args.dashboardUrl}`,
    `- Reach out to schedule sessions with your new mentee`,
    "",
    "Important: Please complete onboarding with your new student within 48 hours to ensure the best experience.",
    "",
    "If you need any assistance, reply to this email or contact support@huckleberry.art.",
  ].join("\n");

  const html = `
    <div style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;max-width:640px;margin:0 auto;padding:24px;color:#111827">
      <div style="font-size:18px;font-weight:700;margin-bottom:12px">Huckleberry Mentorships</div>
      <div style="padding:16px;border:1px solid #E5E7EB;border-radius:12px">
        <div style="font-weight:700;margin-bottom:6px">New Student</div>
        <div style="color:#374151;line-height:1.6;margin-bottom:12px">
          A new student has purchased your mentorship sessions!
        </div>

        <div style="margin:0 0 12px 0;color:#374151">
          <div style="font-weight:700;margin-bottom:6px">Student Details</div>
          <ul style="margin:0;padding-left:18px;line-height:1.7">
            <li><strong>Name:</strong> ${escapeHtml(studentDisplay)}</li>
            ${
              args.studentEmail
                ? `<li><strong>Email:</strong> ${escapeHtml(args.studentEmail)}</li>`
                : ""
            }
            <li><strong>Sessions:</strong> ${args.sessionsPurchased}</li>
          </ul>
        </div>

        <div style="padding:12px;border:1px solid #FEF3C7;border-radius:10px;background:#FFFBEB;margin-bottom:12px">
          <div style="font-weight:800;margin-bottom:6px">Next Steps</div>
          <div style="color:#374151;line-height:1.6">
            Please reach out to your new student within 48 hours to schedule your first session.
          </div>
        </div>

        <a href="${args.dashboardUrl}" style="display:inline-block;padding:12px 16px;background:#111827;color:#fff;border-radius:10px;text-decoration:none;font-weight:600">View Student in Dashboard</a>

        <p style="margin:16px 0 0 0;color:#6B7280;font-size:12px">
          If the button doesn't work, copy/paste this link:<br/>
          <div>${escapeHtml(args.dashboardUrl)}</div>
        </p>

        <p style="margin:12px 0 0 0;color:#6B7280;font-size:12px">
          If you need any assistance, reply to this email or contact <a href="mailto:support@huckleberry.art">support@huckleberry.art</a>.
        </p>
      </div>
    </div>
  `.trim();

  return {
    subject,
    html,
    text,
    headers: {
      "X-Email-Type": "instructor_onboarding",
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