import { logger, schedules, task } from "@trigger.dev/sdk";
import { sendEmail } from "../../packages/emails/src/send";
import { buildSessionCanceledEmail, buildSessionRescheduledEmail, buildStudentCanceledEmail, buildSessionReminderEmail, buildInstructorReminderEmail } from "../../packages/emails/src/session-changes";
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
      kind: "transactional",
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
      kind: "transactional",
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

    const built = buildStudentCanceledEmail({
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
      kind: "transactional",
    });

    return { ok: true };
  },
});

const REMINDER_MINUTES = 30;
// Polling cadence is 15 minutes (`cron: "*/15 * * * *"` below), so the
// match window must extend half the cadence on each side of the target
// lead time to keep coverage continuous across ticks. The window is
// anchored to `payload.timestamp` (the cron-scheduled tick, e.g.
// exactly 10:15:00.000) rather than the actual task start time, so
// adjacent ticks produce half-open intervals that share their boundary
// without overlap. Using `new Date()` instead would let queue-latency
// jitter widen adjacent windows into each other and double-match the
// same session.
const REMINDER_WINDOW_MINUTES = 15 / 2;

const REMINDER_PAGE_SIZE = 100;

export const sendSessionReminders = schedules.task({
  id: "send-session-reminders",
  cron: "*/15 * * * *",
  maxDuration: 300,
  run: async (payload) => {
    const now = payload.timestamp;
    const targetTime = new Date(now.getTime() + REMINDER_MINUTES * 60 * 1000);
    const windowStart = new Date(targetTime.getTime() - REMINDER_WINDOW_MINUTES * 60 * 1000);
    const windowEnd = new Date(targetTime.getTime() + REMINDER_WINDOW_MINUTES * 60 * 1000);

    logger.info("Checking for sessions needing reminders", {
      scheduledTick: now.toISOString(),
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
    });

    // Page through matches instead of capping at a fixed limit:
    // widening the window from ±2m to ±7.5m roughly triples the
    // expected match count per tick, and dropping the tail means
    // some sessions never get the reminder. Order by scheduledAt
    // so pagination is deterministic.
    //
    // Narrow projection: only the columns the email builders consume.
    // The old `select({ session, student, instructor, pack })` joined all
    // four tables and pulled every column, including `instructors.socials`
    // (jsonb), `instructors.specialties/background/portfolio_images`
    // (text[]), `instructors.bio` (text), `sessions.notes/recording_url`,
    // and `users.email` (Clerk-mirrored). On Supabase's transaction-mode
    // pgBouncer pooler, that payload reliably exceeds the 60s idle/query
    // limit on cold-path cron ticks (observed 1m25s before the connection
    // is killed, with Drizzle wrapping the empty-message error as
    // `Failed query: <sql>`). The drop-in: fetch only what each row needs.
    const query = db
      .select({
        sessionId: sessions.id,
        scheduledAt: sessions.scheduledAt,
        studentId: sessions.studentId,
        instructorId: sessions.instructorId,
        studentEmail: users.email,
        studentTimeZone: users.timeZone,
        instructorName: instructors.name,
        instructorUserId: instructors.userId,
      })
      .from(sessions)
      .innerJoin(users, eq(sessions.studentId, users.id))
      .innerJoin(instructors, eq(sessions.instructorId, instructors.id))
      .where(
        and(
          eq(sessions.status, "scheduled"),
          gte(sessions.scheduledAt, windowStart),
          lt(sessions.scheduledAt, windowEnd)
        )
      )
      .orderBy(sessions.scheduledAt, sessions.id);

    async function fetchReminderPage(offset: number) {
      return await query.limit(REMINDER_PAGE_SIZE).offset(offset);
    }
    type ReminderRow = Awaited<ReturnType<typeof fetchReminderPage>>[number];

    const sessionsToRemind: ReminderRow[] = [];
    let offset = 0;
    while (true) {
      const page = await query.limit(REMINDER_PAGE_SIZE).offset(offset);
      if (page.length === 0) break;
      sessionsToRemind.push(...page);
      if (page.length < REMINDER_PAGE_SIZE) break;
      offset += REMINDER_PAGE_SIZE;
    }

    logger.info(`Found ${sessionsToRemind.length} sessions needing reminders`);

    const results = { sent: 0, skipped: 0, failed: 0 };

    for (const row of sessionsToRemind) {
      try {
        const instructorUser = row.instructorUserId
          ? await db.query.users.findFirst({
              where: eq(users.id, row.instructorUserId),
            })
          : null;

        const studentTimeZone = row.studentTimeZone;
        const instructorTimeZone = instructorUser?.timeZone;

        // Greptile R5 P1 defense-in-depth: Resend idempotency key
        // scopes per (role, session, scheduledAt) so a Trigger.dev
        // retry of this same tick reuses the same key and Resend
        // deduplicates the send. A genuine reschedule to a new
        // `scheduledAt` produces a fresh key (new email), and the
        // primary `payload.timestamp` window anchor already prevents
        // adjacent ticks from selecting the same session.
        const reminderIdempotencyKey = (role: "student" | "instructor") =>
          `session-reminder:${role}:${row.sessionId}:${row.scheduledAt.toISOString()}`;

        if (row.studentEmail) {
          const studentEmail = buildSessionReminderEmail({
            studentEmail: row.studentEmail,
            studentName: row.studentEmail.split("@")[0],
            instructorName: row.instructorName,
            scheduledAt: row.scheduledAt,
            minutesUntil: REMINDER_MINUTES,
            studentTimeZone,
          });

          await sendEmail({
            to: row.studentEmail,
            subject: studentEmail.subject,
            text: studentEmail.text,
            html: studentEmail.html,
            headers: studentEmail.headers,
            kind: "transactional",
            idempotencyKey: reminderIdempotencyKey("student"),
          });
        }

        if (instructorUser?.email) {
          const instructorEmail = buildInstructorReminderEmail({
            instructorEmail: instructorUser.email,
            instructorName: row.instructorName,
            studentName: row.studentEmail.split("@")[0],
            studentEmail: row.studentEmail,
            scheduledAt: row.scheduledAt,
            minutesUntil: REMINDER_MINUTES,
            instructorTimeZone,
          });

          await sendEmail({
            to: instructorUser.email,
            subject: instructorEmail.subject,
            text: instructorEmail.text,
            html: instructorEmail.html,
            headers: instructorEmail.headers,
            kind: "transactional",
            idempotencyKey: reminderIdempotencyKey("instructor"),
          });
        }

        results.sent++;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(`Failed to send reminder for session ${row.sessionId}: ${errorMessage}`);
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