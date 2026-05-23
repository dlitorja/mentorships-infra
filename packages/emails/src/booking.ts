import { formatSessionDateTime, getBaseUrl } from "./send";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// Base URL is provided by send.ts

export function buildBookingConfirmationEmail(
  scheduledAt: Date,
  studentName: string,
  instructorName: string,
  studentTimeZone?: string | null,
) {
  const sessionDateTime = formatSessionDateTime(scheduledAt, studentTimeZone || undefined);
  const calendarUrl = `${getBaseUrl()}/calendar`;
  const dashboardUrl = `${getBaseUrl()}/dashboard`;

  const subject = `Session confirmed: ${sessionDateTime}`;
  const text = [
    `Hi ${studentName},`,
    "",
    "Your mentorship session has been confirmed!",
    "",
    `Date & Time: ${sessionDateTime}`,
    `Instructor: ${instructorName}`,
    "",
    `View your sessions: ${calendarUrl}`,
    "",
    "If a week isn’t available, we’ll skip it and you can coordinate with your instructor in your workspace.",
    "",
    "To cancel or reschedule, contact your instructor in your workspace.",
    "We encourage informing your instructor at least 24 hours beforehand; instructors will handle changes requested with less than 24 hours' notice at their discretion.",
    "",
    "Best,",
    "Huckleberry Mentorships",
  ].join("\n");

  const html = `
    <div style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;max-width:640px;margin:0 auto;padding:24px;color:#111827">
      <div style="font-size:18px;font-weight:700;margin-bottom:12px">Huckleberry Mentorships</div>
      <div style="padding:16px;border:1px solid #E5E7EB;border-radius:12px">
        <div style="font-weight:700;margin-bottom:6px">Session Confirmed!</div>
        <div style="color:#374151;line-height:1.6;margin-bottom:12px">
          Hi ${escapeHtml(studentName)}, your mentorship session has been scheduled.
        </div>
        <div style="background:#F3F4F6;padding:12px;border-radius:8px;margin-bottom:12px">
          <div style="font-size:14px;font-weight:600;margin-bottom:4px">Session Details</div>
          <div style="font-size:14px;color:#374151">📅 ${escapeHtml(sessionDateTime)}</div>
          <div style="font-size:14px;color:#374151">👤 Instructor: ${escapeHtml(instructorName)}</div>
        </div>
        <a href="${calendarUrl}" style="display:inline-block;padding:12px 16px;background:#111827;color:#fff;border-radius:10px;text-decoration:none;font-weight:600">View Calendar</a>
        <p style="margin:16px 0 0 0;color:#6B7280;font-size:12px">
          We’ll try to reserve this same day and time weekly to keep momentum. If a week isn’t available, we’ll skip it and you can coordinate with your instructor in your workspace to reschedule.
        </p>
        <p style="margin:8px 0 0 0;color:#6B7280;font-size:12px">
          To cancel or reschedule, contact your instructor in your workspace. Please try to inform them at least 24 hours in advance; instructors handle changes requested with less than 24 hours' notice at their discretion.
        </p>
      </div>
    </div>
  `.trim();

  return { subject, text, html, headers: { "X-Email-Type": "booking_confirmation_student" } };
}

export function buildInstructorNotificationEmail(
  scheduledAt: Date,
  instructorName: string,
  studentName: string,
  studentEmail: string,
  instructorTimeZone?: string | null,
) {
  const sessionDateTime = formatSessionDateTime(scheduledAt, instructorTimeZone || undefined);
  const dashboardUrl = `${getBaseUrl()}/instructor/dashboard`;
  const subject = `New booking: ${sessionDateTime}`;
  const text = [
    `Hi ${instructorName},`,
    "",
    "You have a new session booking!",
    "",
    `Date & Time: ${sessionDateTime}`,
    `Student: ${studentName}`,
    `Email: ${studentEmail}`,
    "",
    `View your dashboard: ${dashboardUrl}`,
  ].join("\n");

  const html = `
    <div style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;max-width:640px;margin:0 auto;padding:24px;color:#111827">
      <div style="font-size:18px;font-weight:700;margin-bottom:12px">Huckleberry Mentorships</div>
      <div style="padding:16px;border:1px solid #E5E7EB;border-radius:12px">
        <div style="font-weight:700;margin-bottom:6px">New Session Booking!</div>
        <div style="background:#F3F4F6;padding:12px;border-radius:8px;margin-bottom:12px">
          <div style="font-size:14px;font-weight:600;margin-bottom:4px">Session Details</div>
          <div style="font-size:14px;color:#374151">📅 ${escapeHtml(sessionDateTime)}</div>
          <div style="font-size:14px;color:#374151">👤 Student: ${escapeHtml(studentName)}</div>
          <div style="font-size:14px;color:#374151">📧 Email: ${escapeHtml(studentEmail)}</div>
        </div>
        <a href="${dashboardUrl}" style="display:inline-block;padding:12px 16px;background:#111827;color:#fff;border-radius:10px;text-decoration:none;font-weight:600">View Dashboard</a>
      </div>
    </div>
  `.trim();

  return { subject, text, html, headers: { "X-Email-Type": "booking_notification_instructor" } };
}

export function buildSeriesSummaryEmails(args: {
  studentName: string;
  studentEmail: string;
  instructorName: string | null;
  instructorEmail: string | null;
  timesUtc: Array<number>; // includes initial + future created
  studentTimeZone?: string | null;
  instructorTimeZone?: string | null;
  skippedCount: number;
}) {
  const calendarUrl = `${getBaseUrl()}/calendar`;
  const instructorDashboardUrl = `${getBaseUrl()}/instructor/dashboard`;

  const studentTimes = args.timesUtc
    .map((ms) => `• ${formatSessionDateTime(new Date(ms), args.studentTimeZone || undefined)}`)
    .join("\n");
  const instructorTimes = args.timesUtc
    .map((ms) => `• ${formatSessionDateTime(new Date(ms), args.instructorTimeZone || undefined)}`)
    .join("\n");

  const skippedLine = args.skippedCount > 0
    ? `\n\n${args.skippedCount} week${args.skippedCount === 1 ? " was" : "s were"} not available and were skipped.`
    : "";

  const studentSubject = `Your sessions are scheduled`;
  const studentText = [
    `Hi ${args.studentName},`,
    "",
    "We scheduled your mentorship sessions at the same day and time to keep consistency and momentum.",
    "",
    "Scheduled times:",
    studentTimes,
    skippedLine,
    "",
    `View your sessions: ${calendarUrl}`,
    "",
    "If you need to reschedule individual sessions, please contact your instructor in your workspace.",
    "We encourage informing your instructor at least 24 hours beforehand; instructors will handle changes requested with less than 24 hours' notice at their discretion.",
  ].join("\n");

  const instructorSubject = `New sessions scheduled`;
  const instructorGreeting = args.instructorName ? `Hi ${args.instructorName},` : "Hi,";
  const instructorText = [
    instructorGreeting,
    "",
    `We scheduled sessions with ${args.studentName} at the same day/time for the next weeks.`,
    "",
    "Scheduled times:",
    instructorTimes,
    skippedLine,
    "",
    `View your dashboard: ${instructorDashboardUrl}`,
  ].join("\n");

  return {
    student: { subject: studentSubject, text: studentText, headers: { "X-Email-Type": "booking_series_summary_student" as const } },
    instructor: { subject: instructorSubject, text: instructorText, headers: { "X-Email-Type": "booking_series_summary_instructor" as const } },
  };
}
