import { task } from "@trigger.dev/sdk";
import { sendEmail } from "@mentorships/emails/send";
import { buildSessionCanceledEmail, buildSessionRescheduledEmail } from "@mentorships/emails/session-changes";

type CancelPayload = {
  sessionId: string;
  studentEmail: string;
  studentName: string;
  instructorName: string;
  scheduledAtUtc: number;
  reason?: string;
  studentTimeZone?: string | null;
};

type ReschedulePayload = {
  sessionId: string;
  studentEmail: string;
  studentName: string;
  instructorName: string;
  oldScheduledAtUtc: number;
  newScheduledAtUtc: number;
  studentTimeZone?: string | null;
};

export const sessionCanceledNotifications = task({
  id: "session-canceled-notifications",
  retry: {
    maxAttempts: 5,
    factor: 2,
    minTimeoutInMs: 1000,
    maxTimeoutInMs: 30000,
    randomize: true,
  },
  run: async (payload: CancelPayload) => {
    if (!payload.studentEmail) {
      return { ok: true, skipped: true, reason: "no student email" };
    }

    const built = buildSessionCanceledEmail({
      studentEmail: payload.studentEmail,
      studentName: payload.studentName,
      instructorName: payload.instructorName,
      scheduledAt: new Date(payload.scheduledAtUtc),
      reason: payload.reason,
      studentTimeZone: payload.studentTimeZone,
    });

    await sendEmail({
      to: payload.studentEmail,
      subject: built.subject,
      text: built.text,
      html: built.html,
      headers: built.headers,
    });

    return { ok: true };
  },
});

export const sessionRescheduledNotifications = task({
  id: "session-rescheduled-notifications",
  retry: {
    maxAttempts: 5,
    factor: 2,
    minTimeoutInMs: 1000,
    maxTimeoutInMs: 30000,
    randomize: true,
  },
  run: async (payload: ReschedulePayload) => {
    if (!payload.studentEmail) {
      return { ok: true, skipped: true, reason: "no student email" };
    }

    const built = buildSessionRescheduledEmail({
      studentEmail: payload.studentEmail,
      studentName: payload.studentName,
      instructorName: payload.instructorName,
      oldScheduledAt: new Date(payload.oldScheduledAtUtc),
      newScheduledAt: new Date(payload.newScheduledAtUtc),
      studentTimeZone: payload.studentTimeZone,
    });

    await sendEmail({
      to: payload.studentEmail,
      subject: built.subject,
      text: built.text,
      html: built.html,
      headers: built.headers,
    });

    return { ok: true };
  },
});