import type {
  SessionBookingEmailEvent,
  SessionReminderEmailEvent,
  SessionCancelledEmailEvent,
} from "@/inngest/types";

type BookingEmailData = SessionBookingEmailEvent["data"];
type ReminderEmailData = SessionReminderEmailEvent["data"];
type CancelledEmailData = SessionCancelledEmailEvent["data"];

export type BookingEmail = {
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

function formatSessionDateTime(date: Date, timeZone?: string): string {
  const tz = timeZone || "UTC";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function buildBookingConfirmationEmail(
  data: BookingEmailData,
  studentName: string,
  mentorName: string,
  studentTimeZone?: string | null
): BookingEmail {
  const { scheduledAt } = data;
  const sessionDateTime = formatSessionDateTime(new Date(scheduledAt), studentTimeZone || undefined);
  const calendarUrl = `${getBaseUrl()}/calendar`;
  const dashboardUrl = `${getBaseUrl()}/dashboard`;

  const subject = `Session confirmed: ${sessionDateTime}`;

  const text = [
    `Hi ${studentName},`,
    "",
    "Your mentorship session has been confirmed!",
    "",
    `Date & Time: ${sessionDateTime}`,
    `Instructor: ${mentorName}`,
    "",
    `View your sessions: ${calendarUrl}`,
    "",
    `Your dashboard: ${dashboardUrl}`,
    "",
    "If you need to reschedule, please contact your instructor directly.",
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
          <div style="font-size:14px;color:#374151">👤 Instructor: ${escapeHtml(mentorName)}</div>
        </div>

        <a href="${calendarUrl}" style="display:inline-block;padding:12px 16px;background:#111827;color:#fff;border-radius:10px;text-decoration:none;font-weight:600">View Calendar</a>

        <p style="margin:16px 0 0 0;color:#6B7280;font-size:12px">
          If you need to reschedule, please contact your instructor directly.
        </p>
      </div>
    </div>
  `.trim();

  return {
    subject,
    html,
    text,
    headers: {
      "X-Email-Type": "booking_confirmation_student",
      "X-Session-Id": data.sessionId,
    },
  };
}

export function buildMentorNotificationEmail(
  data: BookingEmailData,
  mentorName: string,
  studentName: string,
  studentEmail: string,
  mentorTimeZone?: string | null
): BookingEmail {
  const { scheduledAt } = data;
  const sessionDateTime = formatSessionDateTime(new Date(scheduledAt), mentorTimeZone || undefined);
  const dashboardUrl = `${getBaseUrl()}/instructor/dashboard`;

  const subject = `New booking: ${sessionDateTime}`;

  const text = [
    `Hi ${mentorName},`,
    "",
    "You have a new session booking!",
    "",
    `Date & Time: ${sessionDateTime}`,
    `Student: ${studentName}`,
    `Email: ${studentEmail}`,
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
        <div style="font-weight:700;margin-bottom:6px">New Session Booking!</div>
        <div style="color:#374151;line-height:1.6;margin-bottom:12px">
          Hi ${escapeHtml(mentorName)}, you have a new session scheduled.
        </div>
        
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

  return {
    subject,
    html,
    text,
    headers: {
      "X-Email-Type": "booking_notification_mentor",
      "X-Session-Id": data.sessionId,
    },
  };
}

export function buildReminderEmail(
  data: ReminderEmailData,
  studentName: string,
  mentorName: string,
  studentTimeZone?: string | null
): BookingEmail {
  const { scheduledAt, type } = data;
  const sessionDateTime = formatSessionDateTime(new Date(scheduledAt), studentTimeZone || undefined);
  const hoursText = type === "24h_before" ? "24 hours" : "1 hour";
  const calendarUrl = `${getBaseUrl()}/calendar`;

  const subject = `Reminder: Your session is in ${hoursText}`;

  const text = [
    `Hi ${studentName},`,
    "",
    `This is a reminder that your mentorship session is in ${hoursText}.`,
    "",
    `Date & Time: ${sessionDateTime}`,
    `Instructor: ${mentorName}`,
    "",
    `View your sessions: ${calendarUrl}`,
    "",
    "See you soon!",
    "Huckleberry Mentorships",
  ].join("\n");

  const html = `
    <div style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;max-width:640px;margin:0 auto;padding:24px;color:#111827">
      <div style="font-size:18px;font-weight:700;margin-bottom:12px">Huckleberry Mentorships</div>
      <div style="padding:16px;border:1px solid #E5E7EB;border-radius:12px">
        <div style="font-weight:700;margin-bottom:6px">Session Reminder</div>
        <div style="color:#374151;line-height:1.6;margin-bottom:12px">
          Hi ${escapeHtml(studentName)}, this is a reminder that your session is in <strong>${hoursText}</strong>.
        </div>
        
        <div style="background:#F3F4F6;padding:12px;border-radius:8px;margin-bottom:12px">
          <div style="font-size:14px;font-weight:600;margin-bottom:4px">Session Details</div>
          <div style="font-size:14px;color:#374151">📅 ${escapeHtml(sessionDateTime)}</div>
          <div style="font-size:14px;color:#374151">👤 Instructor: ${escapeHtml(mentorName)}</div>
        </div>

        <a href="${calendarUrl}" style="display:inline-block;padding:12px 16px;background:#111827;color:#fff;border-radius:10px;text-decoration:none;font-weight:600">View Calendar</a>
      </div>
    </div>
  `.trim();

  return {
    subject,
    html,
    text,
    headers: {
      "X-Email-Type": `reminder_${type}`,
      "X-Session-Id": data.sessionId,
    },
  };
}

export function buildCancellationEmail(
  data: CancelledEmailData,
  userName: string,
  otherPartyName: string,
  userTimeZone?: string | null,
  isStudent: boolean = true
): BookingEmail {
  const { scheduledAt, cancelledBy } = data;
  const sessionDateTime = formatSessionDateTime(new Date(scheduledAt), userTimeZone || undefined);
  const cancelledByText = cancelledBy === "instructor" ? "Your instructor" : "The student";
  const dashboardUrl = isStudent ? `${getBaseUrl()}/dashboard` : `${getBaseUrl()}/instructor/dashboard`;

  const subject = `Session cancelled: ${sessionDateTime}`;

  const text = [
    `Hi ${userName},`,
    "",
    "Your session has been cancelled.",
    "",
    `Date & Time: ${sessionDateTime}`,
    `${cancelledBy} cancelled this session.`,
    isStudent ? `Instructor: ${otherPartyName}` : `Student: ${otherPartyName}`,
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
        <div style="font-weight:700;margin-bottom:6px">Session Cancelled</div>
        <div style="color:#374151;line-height:1.6;margin-bottom:12px">
          Hi ${escapeHtml(userName)}, your session has been cancelled.
        </div>
        
        <div style="background:#FEF2F2;padding:12px;border-radius:8px;margin-bottom:12px">
          <div style="font-size:14px;font-weight:600;margin-bottom:4px">Cancelled Session</div>
          <div style="font-size:14px;color:#374151">📅 ${escapeHtml(sessionDateTime)}</div>
          <div style="font-size:14px;color:#374151">${cancelledBy} cancelled this session.</div>
          <div style="font-size:14px;color:#374151">${isStudent ? `Instructor: ${escapeHtml(otherPartyName)}` : `Student: ${escapeHtml(otherPartyName)}`}</div>
        </div>

        <a href="${dashboardUrl}" style="display:inline-block;padding:12px 16px;background:#111827;color:#fff;border-radius:10px;text-decoration:none;font-weight:600">View Dashboard</a>
      </div>
    </div>
  `.trim();

  return {
    subject,
    html,
    text,
    headers: {
      "X-Email-Type": "session_cancelled",
      "X-Session-Id": data.sessionId,
    },
  };
}
