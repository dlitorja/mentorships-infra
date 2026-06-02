import { logger, schedules, task } from "@trigger.dev/sdk";
import { sendEmail } from "@mentorships/emails/send";
import { buildSessionCanceledEmail, buildSessionRescheduledEmail, buildStudentCancelledEmail, buildSessionReminderEmail, buildInstructorReminderEmail } from "@mentorships/emails/session-changes";
import { db } from "../../packages/db/src/lib/drizzle";
import { sessions, users, instructors, sessionPacks } from "../../packages/db/src/schema";
import { eq, and, gte, lt } from "drizzle-orm";

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

type StudentCancelPayload = {
  sessionId: string;
  sessionPackId: string;
  instructorId: string;
  studentId: string;
  scheduledAtUtc: number;
  reason?: string;
};

type ReminderPayload = {
  sessionId: string;
  sessionPackId: string;
  instructorId: string;
  studentId: string;
  scheduledAtUtc: number;
  minutesUntil: number;
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

export const studentCancelledBookingNotifications = task({
  id: "student-cancelled-booking-notifications",
  retry: {
    maxAttempts: 5,
    factor: 2,
    minTimeoutInMs: 1000,
    maxTimeoutInMs: 30000,
    randomize: true,
  },
  run: async (payload: StudentCancelPayload) => {
    const [instructor, student, pack] = await Promise.all([
      db.query.instructors.findFirst({
        where: eq(instructors.id, payload.instructorId),
      }),
      db.query.users.findFirst({
        where: eq(users.id, payload.studentId),
      }),
      db.query.sessionPacks.findFirst({
        where: eq(sessionPacks.id, payload.sessionPackId),
      }),
    ]);

    if (!instructor || !student || !pack) {
      logger.error("Missing data for student cancellation notification", {
        sessionId: payload.sessionId,
        instructorFound: !!instructor,
        studentFound: !!student,
        packFound: !!pack,
      });
      return { ok: false, reason: "missing_data" };
    }

    const instructorUser = instructor.userId
      ? await db.query.users.findFirst({
          where: eq(users.id, instructor.userId),
        })
      : null;

    if (!instructorUser?.email) {
      logger.warn("No instructor email found for student cancellation notification", {
        sessionId: payload.sessionId,
        instructorId: payload.instructorId,
      });
      return { ok: true, skipped: true, reason: "no_instructor_email" };
    }

    const built = buildStudentCancelledEmail({
      instructorEmail: instructorUser.email,
      instructorName: instructor.name,
      studentName: student.email.split("@")[0],
      studentEmail: student.email,
      scheduledAt: new Date(payload.scheduledAtUtc),
      reason: payload.reason,
      instructorTimeZone: instructorUser.timeZone,
    });

    await sendEmail({
      to: instructorUser.email,
      subject: built.subject,
      text: built.text,
      html: built.html,
      headers: built.headers,
    });

    return { ok: true };
  },
});

const REMINDER_MINUTES = 30;
const REMINDER_WINDOW_MINUTES = 5;

export const sendSessionReminders = schedules.task({
  id: "send-session-reminders",
  cron: "*/5 * * * *",
  maxDuration: 300,
  run: async (payload) => {
    const now = new Date();
    const targetTime = new Date(now.getTime() + REMINDER_MINUTES * 60 * 1000);
    const windowStart = new Date(targetTime.getTime() - REMINDER_WINDOW_MINUTES * 60 * 1000);
    const windowEnd = new Date(targetTime.getTime() + REMINDER_WINDOW_MINUTES * 60 * 1000);

    logger.info("Checking for sessions needing reminders", {
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
    });

    const sessionsToRemind = await db
      .select({
        session: sessions,
        student: users,
        instructor: instructors,
        pack: sessionPacks,
      })
      .from(sessions)
      .innerJoin(users, eq(sessions.studentId, users.id))
      .innerJoin(instructors, eq(sessions.instructorId, instructors.id))
      .innerJoin(sessionPacks, eq(sessions.sessionPackId, sessionPacks.id))
      .where(
        and(
          eq(sessions.status, "scheduled"),
          gte(sessions.scheduledAt, windowStart),
          lt(sessions.scheduledAt, windowEnd)
        )
      )
      .limit(50);

    logger.info(`Found ${sessionsToRemind.length} sessions needing reminders`);

    const results = { sent: 0, skipped: 0, failed: 0 };

    for (const row of sessionsToRemind) {
      try {
        const instructorUser = row.instructor.userId
          ? await db.query.users.findFirst({
              where: eq(users.id, row.instructor.userId),
            })
          : null;

        const studentTimeZone = row.student.timeZone;
        const instructorTimeZone = instructorUser?.timeZone;

        if (row.student.email) {
          const studentEmail = buildSessionReminderEmail({
            studentEmail: row.student.email,
            studentName: row.student.email.split("@")[0],
            instructorName: row.instructor.name,
            scheduledAt: row.session.scheduledAt,
            minutesUntil: REMINDER_MINUTES,
            studentTimeZone,
          });

          await sendEmail({
            to: row.student.email,
            subject: studentEmail.subject,
            text: studentEmail.text,
            html: studentEmail.html,
            headers: studentEmail.headers,
          });
        }

        if (instructorUser?.email) {
          const instructorEmail = buildInstructorReminderEmail({
            instructorEmail: instructorUser.email,
            instructorName: row.instructor.name,
            studentName: row.student.email.split("@")[0],
            studentEmail: row.student.email,
            scheduledAt: row.session.scheduledAt,
            minutesUntil: REMINDER_MINUTES,
            instructorTimeZone,
          });

          await sendEmail({
            to: instructorUser.email,
            subject: instructorEmail.subject,
            text: instructorEmail.text,
            html: instructorEmail.html,
            headers: instructorEmail.headers,
          });
        }

        results.sent++;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(`Failed to send reminder for session ${row.session.id}: ${errorMessage}`);
        results.failed++;
      }
    }

    logger.info("Session reminders job completed", { results });
    return {
      sessionsFound: sessionsToRemind.length,
      ...results,
    };
  },
});