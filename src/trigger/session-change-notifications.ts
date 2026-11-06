import { logger, schedules, task } from "@trigger.dev/sdk";
import { sendEmail } from "../../packages/emails/src/send";
import {
  buildSessionCanceledEmail,
  buildSessionRescheduledEmail,
  buildSessionReminderEmail,
  buildInstructorReminderEmail,
} from "../../packages/emails/src/session-changes";
import {
  runSessionReminders,
  type ReminderPage,
} from "./lib/session-reminders";

// HTTP actions are served on `.convex.site`; `.convex.cloud` is the
// query/mutation host, so swap it for the reminder-window route.
const CONVEX_DEPLOYMENT_URL = (
  process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_DEPLOYMENT_URL
)
  ?.replace(/\/+$/, "")
  .replace(/\.convex\.cloud$/, ".convex.site");
const CONVEX_HTTP_KEY = process.env.CONVEX_HTTP_KEY;

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

    // Data comes from Convex, not Supabase: sessions, users and instructors
    // all live there, and the Postgres project was paused (which is what
    // broke this task). The endpoint inner-joins student + instructor the
    // same way the old SQL did, so sessions with a dangling user row are
    // still skipped.
    const fetchPage = async (cursor: string | null): Promise<ReminderPage> => {
      if (!CONVEX_DEPLOYMENT_URL || !CONVEX_HTTP_KEY) {
        throw new Error("Convex deployment URL or HTTP key not configured");
      }
      const url = new URL(`${CONVEX_DEPLOYMENT_URL}/session-notifications/reminder-window`);
      url.searchParams.set("start", String(windowStart.getTime()));
      url.searchParams.set("end", String(windowEnd.getTime()));
      if (cursor) url.searchParams.set("cursor", cursor);

      const response = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${CONVEX_HTTP_KEY}` },
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(
          `Convex /session-notifications/reminder-window failed: ${response.status} ${text.slice(0, 200)}`
        );
      }
      return (await response.json()) as ReminderPage;
    };

    return await runSessionReminders({
      minutesUntil: REMINDER_MINUTES,
      log: logger,
      fetchPage,
      sendEmail,
      buildStudentEmail: buildSessionReminderEmail,
      buildInstructorEmail: buildInstructorReminderEmail,
    });
  },
});
