import type {
  SendEmailArgs,
  SendEmailResult,
} from "../../../packages/emails/src/send";

/** Structural subset of the Trigger logger, so tests can inject a spy. */
export type ReminderLogger = {
  info: (message: string, context?: Record<string, unknown>) => void;
  warn: (message: string, context?: Record<string, unknown>) => void;
  error: (message: string, context?: Record<string, unknown>) => void;
};

/**
 * Orchestration for the session-reminder fan-out.
 *
 * Dependency-injected so the send path is testable without Trigger, Convex
 * or Resend — same shape as `run-recording-reconciliation.ts`.
 */

export type ReminderRow = {
  sessionId: string;
  scheduledAt: number;
  studentEmail: string;
  studentTimeZone: string | null;
  instructorName: string;
  instructorEmail: string | null;
  instructorTimeZone: string | null;
};

export type ReminderPage = {
  rows: ReminderRow[];
  isDone: boolean;
  continueCursor: string | null;
};

export type ReminderDeps = {
  fetchPage: (cursor: string | null) => Promise<ReminderPage>;
  sendEmail: (args: SendEmailArgs) => Promise<SendEmailResult>;
  buildStudentEmail: (args: {
    studentEmail: string;
    studentName: string;
    instructorName: string;
    scheduledAt: Date;
    minutesUntil: number;
    studentTimeZone?: string | null;
  }) => { subject: string; text: string; html: string; headers: Record<string, string> };
  buildInstructorEmail: (args: {
    instructorEmail: string;
    instructorName: string;
    studentName: string;
    studentEmail: string;
    scheduledAt: Date;
    minutesUntil: number;
    instructorTimeZone?: string | null;
  }) => { subject: string; text: string; html: string; headers: Record<string, string> };
  minutesUntil: number;
  maxPages?: number;
  log: ReminderLogger;
};

export type ReminderSummary = {
  sessionsFound: number;
  sent: number;
  skipped: number;
  failed: number;
  truncated: boolean;
};

const DEFAULT_MAX_PAGES = 50;

export async function runSessionReminders(
  deps: ReminderDeps
): Promise<ReminderSummary> {
  const maxPages = deps.maxPages ?? DEFAULT_MAX_PAGES;
  const rows: ReminderRow[] = [];
  let cursor: string | null = null;
  let truncated = true;

  for (let page = 0; page < maxPages; page++) {
    const result = await deps.fetchPage(cursor);
    rows.push(...result.rows);
    if (result.isDone || !result.continueCursor) {
      truncated = false;
      break;
    }
    cursor = result.continueCursor;
  }

  if (truncated) {
    // Never report a partial fan-out as complete.
    deps.log.error("Session-reminder paging stopped at maxPages", {
      maxPages,
      rows: rows.length,
    });
  }

  deps.log.info(`Found ${rows.length} session(s) needing reminders`);

  const results = { sent: 0, skipped: 0, failed: 0 };

  for (const row of rows) {
    try {
      const scheduledAt = new Date(row.scheduledAt);
      // Idempotency key scoped per (role, session, scheduledAt) so a Trigger
      // retry of the same tick reuses it and Resend deduplicates. A genuine
      // reschedule produces a new `scheduledAt` and therefore a new email.
      const idempotencyKey = (role: "student" | "instructor") =>
        `session-reminder:${role}:${row.sessionId}:${scheduledAt.toISOString()}`;

      let sentAny = false;

      if (row.studentEmail) {
        const studentEmail = deps.buildStudentEmail({
          studentEmail: row.studentEmail,
          studentName: row.studentEmail.split("@")[0],
          instructorName: row.instructorName,
          scheduledAt,
          minutesUntil: deps.minutesUntil,
          studentTimeZone: row.studentTimeZone,
        });

        await deps.sendEmail({
          to: row.studentEmail,
          subject: studentEmail.subject,
          text: studentEmail.text,
          html: studentEmail.html,
          headers: studentEmail.headers,
          kind: "transactional",
          idempotencyKey: idempotencyKey("student"),
        });
        sentAny = true;
      }

      if (row.instructorEmail) {
        const instructorEmail = deps.buildInstructorEmail({
          instructorEmail: row.instructorEmail,
          instructorName: row.instructorName,
          studentName: row.studentEmail.split("@")[0],
          studentEmail: row.studentEmail,
          scheduledAt,
          minutesUntil: deps.minutesUntil,
          instructorTimeZone: row.instructorTimeZone,
        });

        await deps.sendEmail({
          to: row.instructorEmail,
          subject: instructorEmail.subject,
          text: instructorEmail.text,
          html: instructorEmail.html,
          headers: instructorEmail.headers,
          kind: "transactional",
          idempotencyKey: idempotencyKey("instructor"),
        });
        sentAny = true;
      }

      if (sentAny) results.sent++;
      else results.skipped++;
    } catch (error) {
      results.failed++;
      deps.log.error(
        `Failed to send reminder for session ${row.sessionId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  deps.log.info("Session reminders job completed", { results });
  return { sessionsFound: rows.length, ...results, truncated };
}
