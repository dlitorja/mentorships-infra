import { formatSessionDateTime, getBaseUrl } from "./send";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export type SessionEmailPayload = {
  subject: string;
  text: string;
  html: string;
  headers: Record<string, string>;
};

/**
 * Builds a session cancellation notification email for the student.
 * Sent when an instructor cancels a scheduled session.
 *
 * @param args.studentEmail - The student's email address
 * @param args.studentName - The student's name
 * @param args.instructorName - The instructor's name
 * @param args.scheduledAt - The session's original scheduled date/time
 * @param args.reason - Optional cancellation reason provided by the instructor
 * @param args.studentTimeZone - Optional timezone for display formatting
 * @returns Email payload with subject, text, HTML, and headers
 */
export function buildSessionCanceledEmail(args: {
  studentEmail: string;
  studentName: string;
  instructorName: string;
  scheduledAt: Date;
  reason?: string | null;
  studentTimeZone?: string | null;
}): SessionEmailPayload {
  const sessionDateTime = formatSessionDateTime(args.scheduledAt, args.studentTimeZone || undefined);
  const calendarUrl = `${getBaseUrl()}/calendar`;

  const subject = `Session canceled: ${sessionDateTime}`;
  const text = [
    `Hi ${args.studentName},`,
    "",
    "Your mentorship session has been canceled by your instructor.",
    "",
    `Date & Time: ${sessionDateTime}`,
    `Instructor: ${args.instructorName}`,
    args.reason ? `\nReason: ${args.reason}` : "",
    "",
    "Please contact your instructor to reschedule or if you have any questions.",
    "",
    `View your calendar: ${calendarUrl}`,
    "",
    "Best,",
    "Huckleberry Mentorships",
  ].join("\n");

  const html = `
    <div style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;max-width:640px;margin:0 auto;padding:24px;color:#111827">
      <div style="font-size:18px;font-weight:700;margin-bottom:12px">Huckleberry Mentorships</div>
      <div style="padding:16px;border:1px solid #E5E7EB;border-radius:12px">
        <div style="font-weight:700;margin-bottom:6px;color:#DC2626">Session Canceled</div>
        <div style="color:#374151;line-height:1.6;margin-bottom:12px">
          Hi ${escapeHtml(args.studentName)}, your mentorship session has been canceled by your instructor.
        </div>
        <div style="background:#F3F4F6;padding:12px;border-radius:8px;margin-bottom:12px">
          <div style="font-size:14px;font-weight:600;margin-bottom:4px">Session Details</div>
          <div style="font-size:14px;color:#374151">📅 ${escapeHtml(sessionDateTime)}</div>
          <div style="font-size:14px;color:#374151">👤 Instructor: ${escapeHtml(args.instructorName)}</div>
          ${args.reason ? `<div style="font-size:14px;color:#374151;margin-top:8px">📝 Reason: ${escapeHtml(args.reason)}</div>` : ""}
        </div>
        <p style="margin:16px 0 0 0;color:#6B7280;font-size:12px">
          Please contact your instructor to reschedule or if you have any questions.
        </p>
        <a href="${calendarUrl}" style="display:inline-block;padding:12px 16px;background:#111827;color:#fff;border-radius:10px;text-decoration:none;font-weight:600;margin-top:16px">View Calendar</a>
      </div>
    </div>
  `.trim();

  return { subject, text, html, headers: { "X-Email-Type": "session_canceled_student" } };
}

/**
 * Builds a session reschedule notification email for the student.
 * Sent when an instructor reschedules a session to a new time.
 * Shows both the old and new session times.
 *
 * @param args.studentEmail - The student's email address
 * @param args.studentName - The student's name
 * @param args.instructorName - The instructor's name
 * @param args.oldScheduledAt - The session's previous scheduled date/time
 * @param args.newScheduledAt - The session's new scheduled date/time
 * @param args.studentTimeZone - Optional timezone for display formatting
 * @returns Email payload with subject, text, HTML, and headers
 */
export function buildSessionRescheduledEmail(args: {
  studentEmail: string;
  studentName: string;
  instructorName: string;
  oldScheduledAt: Date;
  newScheduledAt: Date;
  studentTimeZone?: string | null;
}): SessionEmailPayload {
  const oldSessionDateTime = formatSessionDateTime(args.oldScheduledAt, args.studentTimeZone || undefined);
  const newSessionDateTime = formatSessionDateTime(args.newScheduledAt, args.studentTimeZone || undefined);
  const calendarUrl = `${getBaseUrl()}/calendar`;

  const subject = `Session rescheduled: ${newSessionDateTime}`;
  const text = [
    `Hi ${args.studentName},`,
    "",
    "Your mentorship session has been rescheduled by your instructor.",
    "",
    `Previous Time: ${oldSessionDateTime}`,
    `New Time: ${newSessionDateTime}`,
    `Instructor: ${args.instructorName}`,
    "",
    `View your calendar: ${calendarUrl}`,
    "",
    "If you have any questions or need to discuss further, please contact your instructor.",
    "",
    "Best,",
    "Huckleberry Mentorships",
  ].join("\n");

  const html = `
    <div style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;max-width:640px;margin:0 auto;padding:24px;color:#111827">
      <div style="font-size:18px;font-weight:700;margin-bottom:12px">Huckleberry Mentorships</div>
      <div style="padding:16px;border:1px solid #E5E7EB;border-radius:12px">
        <div style="font-weight:700;margin-bottom:6px;color:#059669">Session Rescheduled</div>
        <div style="color:#374151;line-height:1.6;margin-bottom:12px">
          Hi ${escapeHtml(args.studentName)}, your mentorship session has been rescheduled by your instructor.
        </div>
        <div style="background:#F3F4F6;padding:12px;border-radius:8px;margin-bottom:12px">
          <div style="font-size:14px;font-weight:600;margin-bottom:4px">Updated Session Details</div>
          <div style="font-size:14px;color:#374151;text-decoration:line-through;opacity:0.6">❌ Old: ${escapeHtml(oldSessionDateTime)}</div>
          <div style="font-size:14px;color:#374151;margin-top:4px">✅ New: ${escapeHtml(newSessionDateTime)}</div>
          <div style="font-size:14px;color:#374151;margin-top:8px">👤 Instructor: ${escapeHtml(args.instructorName)}</div>
        </div>
        <a href="${calendarUrl}" style="display:inline-block;padding:12px 16px;background:#111827;color:#fff;border-radius:10px;text-decoration:none;font-weight:600">View Calendar</a>
        <p style="margin:16px 0 0 0;color:#6B7280;font-size:12px">
          If you have any questions or need to discuss further, please contact your instructor.
        </p>
      </div>
    </div>
  `.trim();

  return { subject, text, html, headers: { "X-Email-Type": "session_rescheduled_student" } };
}

/**
 * Builds a session reminder email for students.
 * Sent 30 minutes before a scheduled session to remind the student.
 *
 * @param args.studentEmail - The student's email address
 * @param args.studentName - The student's name
 * @param args.instructorName - The instructor's name
 * @param args.scheduledAt - The session's scheduled date/time
 * @param args.minutesUntil - Number of minutes until the session (typically 30)
 * @param args.studentTimeZone - Optional timezone for display formatting
 * @returns Email payload with subject, text, HTML, and headers
 */
export function buildSessionReminderEmail(args: {
  studentEmail: string;
  studentName: string;
  instructorName: string;
  scheduledAt: Date;
  minutesUntil: number;
  studentTimeZone?: string | null;
}): SessionEmailPayload {
  const sessionDateTime = formatSessionDateTime(args.scheduledAt, args.studentTimeZone || undefined);
  const calendarUrl = `${getBaseUrl()}/calendar`;

  const subject = `Reminder: Session in ${args.minutesUntil} minutes - ${sessionDateTime}`;
  const text = [
    `Hi ${args.studentName},`,
    "",
    `Your mentorship session is in ${args.minutesUntil} minutes!`,
    "",
    `Date & Time: ${sessionDateTime}`,
    `Instructor: ${args.instructorName}`,
    "",
    `Join your session: ${calendarUrl}`,
    "",
    "Best,",
    "Huckleberry Mentorships",
  ].join("\n");

  const html = `
    <div style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;max-width:640px;margin:0 auto;padding:24px;color:#111827">
      <div style="font-size:18px;font-weight:700;margin-bottom:12px">Huckleberry Mentorships</div>
      <div style="padding:16px;border:1px solid #E5E7EB;border-radius:12px">
        <div style="font-weight:700;margin-bottom:6px;color:#7C3AED">⏰ Session in ${args.minutesUntil} minutes!</div>
        <div style="color:#374151;line-height:1.6;margin-bottom:12px">
          Hi ${escapeHtml(args.studentName)}, this is a reminder that your mentorship session starts soon.
        </div>
        <div style="background:#F3F4F6;padding:12px;border-radius:8px;margin-bottom:12px">
          <div style="font-size:14px;font-weight:600;margin-bottom:4px">Upcoming Session</div>
          <div style="font-size:14px;color:#374151">📅 ${escapeHtml(sessionDateTime)}</div>
          <div style="font-size:14px;color:#374151">👤 Instructor: ${escapeHtml(args.instructorName)}</div>
        </div>
        <a href="${calendarUrl}" style="display:inline-block;padding:12px 16px;background:#7C3AED;color:#fff;border-radius:10px;text-decoration:none;font-weight:600">Join Session</a>
      </div>
    </div>
  `.trim();

  return { subject, text, html, headers: { "X-Email-Type": "session_reminder_student" } };
}

/**
 * Builds a session reminder email for instructors.
 * Sent 30 minutes before a scheduled session to remind the instructor.
 *
 * @param args.instructorEmail - The instructor's email address
 * @param args.instructorName - The instructor's name
 * @param args.studentName - The student's name
 * @param args.studentEmail - The student's email address
 * @param args.scheduledAt - The session's scheduled date/time
 * @param args.minutesUntil - Number of minutes until the session (typically 30)
 * @param args.instructorTimeZone - Optional timezone for display formatting
 * @returns Email payload with subject, text, HTML, and headers
 */
export function buildInstructorReminderEmail(args: {
  instructorEmail: string;
  instructorName: string;
  studentName: string;
  studentEmail: string;
  scheduledAt: Date;
  minutesUntil: number;
  instructorTimeZone?: string | null;
}): SessionEmailPayload {
  const sessionDateTime = formatSessionDateTime(args.scheduledAt, args.instructorTimeZone || undefined);
  const dashboardUrl = `${getBaseUrl()}/instructor/dashboard`;

  const subject = `Reminder: Session with ${args.studentName} in ${args.minutesUntil} minutes`;
  const text = [
    `Hi ${args.instructorName},`,
    "",
    `Your mentorship session with ${args.studentName} is in ${args.minutesUntil} minutes!`,
    "",
    `Date & Time: ${sessionDateTime}`,
    `Student: ${args.studentName}`,
    `Student Email: ${args.studentEmail}`,
    "",
    `View your dashboard: ${dashboardUrl}`,
    "",
    "Best,",
    "Huckleberry Mentorships",
  ].join("\n");

  const html = `
    <div style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;max-width:640px;margin:0 auto;padding:24px;color:#111827">
      <div style="font-size:18px;font-weight:700;margin-bottom:12px">Huckleberry Mentorships</div>
      <div style="padding:16px;border:1px solid #E5E7EB;border-radius:12px">
        <div style="font-weight:700;margin-bottom:6px;color:#7C3AED">⏰ Session in ${args.minutesUntil} minutes!</div>
        <div style="color:#374151;line-height:1.6;margin-bottom:12px">
          Hi ${escapeHtml(args.instructorName)}, this is a reminder that your session with ${escapeHtml(args.studentName)} starts soon.
        </div>
        <div style="background:#F3F4F6;padding:12px;border-radius:8px;margin-bottom:12px">
          <div style="font-size:14px;font-weight:600;margin-bottom:4px">Upcoming Session</div>
          <div style="font-size:14px;color:#374151">📅 ${escapeHtml(sessionDateTime)}</div>
          <div style="font-size:14px;color:#374151">👤 Student: ${escapeHtml(args.studentName)}</div>
          <div style="font-size:14px;color:#374151">📧 Email: ${escapeHtml(args.studentEmail)}</div>
        </div>
        <a href="${dashboardUrl}" style="display:inline-block;padding:12px 16px;background:#7C3AED;color:#fff;border-radius:10px;text-decoration:none;font-weight:600">View Dashboard</a>
      </div>
    </div>
  `.trim();

  return { subject, text, html, headers: { "X-Email-Type": "session_reminder_instructor" } };
}

/**
 * Builds an email notification for instructors when a student cancels a session.
 * Notifies the instructor about the cancellation with session details and optional reason.
 *
 * @param args.instructorEmail - The instructor's email address
 * @param args.instructorName - The instructor's name
 * @param args.studentName - The student's name
 * @param args.studentEmail - The student's email address
 * @param args.scheduledAt - The session's scheduled date/time
 * @param args.reason - Optional cancellation reason provided by the student
 * @param args.instructorTimeZone - Optional timezone for display formatting
 * @returns Email payload with subject, text, HTML, and headers
 */
export function buildStudentCanceledEmail(args: {
  instructorEmail: string;
  instructorName: string;
  studentName: string;
  studentEmail: string;
  scheduledAt: Date;
  reason?: string | null;
  instructorTimeZone?: string | null;
}): SessionEmailPayload {
  const sessionDateTime = formatSessionDateTime(args.scheduledAt, args.instructorTimeZone || undefined);
  const dashboardUrl = `${getBaseUrl()}/instructor/dashboard`;

  const subject = `Session canceled by student: ${sessionDateTime}`;
  const text = [
    `Hi ${args.instructorName},`,
    "",
    "Your student has canceled their session.",
    "",
    `Date & Time: ${sessionDateTime}`,
    `Student: ${args.studentName}`,
    `Email: ${args.studentEmail}`,
    args.reason ? `\nReason: ${args.reason}` : "",
    "",
    "You may want to reach out to reschedule.",
    "",
    `View your dashboard: ${dashboardUrl}`,
    "",
    "Best,",
    "Huckleberry Mentorships",
  ].join("\n");

  const html = `
    <div style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;max-width:640px;margin:0 auto;padding:24px;color:#111827">
      <div style="font-size:18px;font-weight:700;margin-bottom:12px">Huckleberry Mentorships</div>
      <div style="padding:16px;border:1px solid #E5E7EB;border-radius:12px">
        <div style="font-weight:700;margin-bottom:6px;color:#DC2626">Session Canceled by Student</div>
        <div style="color:#374151;line-height:1.6;margin-bottom:12px">
          Hi ${escapeHtml(args.instructorName)}, your student ${escapeHtml(args.studentName)} has canceled their session.
        </div>
        <div style="background:#F3F4F6;padding:12px;border-radius:8px;margin-bottom:12px">
          <div style="font-size:14px;font-weight:600;margin-bottom:4px">Session Details</div>
          <div style="font-size:14px;color:#374151">📅 ${escapeHtml(sessionDateTime)}</div>
          <div style="font-size:14px;color:#374151">👤 Student: ${escapeHtml(args.studentName)}</div>
          <div style="font-size:14px;color:#374151">📧 Email: ${escapeHtml(args.studentEmail)}</div>
          ${args.reason ? `<div style="font-size:14px;color:#374151;margin-top:8px">📝 Reason: ${escapeHtml(args.reason)}</div>` : ""}
        </div>
        <a href="${dashboardUrl}" style="display:inline-block;padding:12px 16px;background:#111827;color:#fff;border-radius:10px;text-decoration:none;font-weight:600;margin-top:16px">View Dashboard</a>
        <p style="margin:16px 0 0 0;color:#6B7280;font-size:12px">
          You may want to reach out to your student to reschedule.
        </p>
      </div>
    </div>
  `.trim();

  return { subject, text, html, headers: { "X-Email-Type": "session_canceled_instructor" } };
}