import { describe, expect, it } from "vitest";
import {
  runSessionReminders,
  type ReminderRow,
} from "../../src/trigger/lib/session-reminders";

const NOW = 1_800_000_000_000;

function row(overrides: Partial<ReminderRow> = {}): ReminderRow {
  return {
    sessionId: "session-1",
    scheduledAt: NOW + 30 * 60 * 1000,
    studentEmail: "student@example.com",
    studentTimeZone: "America/New_York",
    instructorName: "Ada",
    instructorEmail: "instructor@example.com",
    instructorTimeZone: "Europe/London",
    ...overrides,
  };
}

function deps(rows: ReminderRow[], options: { pages?: number } = {}) {
  const sent: Array<{ to: string; idempotencyKey?: string }> = [];
  const errors: string[] = [];
  let calls = 0;
  const pages = options.pages ?? 1;

  return {
    sent,
    errors,
    base: {
      minutesUntil: 30,
      log: {
        info: () => {},
        warn: () => {},
        error: (msg: string) => {
          errors.push(msg);
        },
      },
      fetchPage: async () => {
        calls++;
        return {
          rows: calls === 1 ? rows : [],
          isDone: calls >= pages,
          continueCursor: calls >= pages ? null : `cursor-${calls}`,
        };
      },
      sendEmail: async (args: { to: string; idempotencyKey?: string }) => {
        sent.push({ to: args.to, idempotencyKey: args.idempotencyKey });
        return { ok: true as const, id: "id" };
      },
      buildStudentEmail: () => ({
        subject: "s",
        text: "t",
        html: "h",
        headers: {},
      }),
      buildInstructorEmail: () => ({
        subject: "s",
        text: "t",
        html: "h",
        headers: {},
      }),
    },
  };
}

describe("runSessionReminders", () => {
  it("emails both parties with per-role idempotency keys", async () => {
    const { base, sent } = deps([row()]);
    const summary = await runSessionReminders(base);

    expect(summary).toMatchObject({ sessionsFound: 1, sent: 1, failed: 0, truncated: false });
    expect(sent.map((s) => s.to)).toEqual([
      "student@example.com",
      "instructor@example.com",
    ]);
    expect(sent[0].idempotencyKey).toBe(
      `session-reminder:student:session-1:${new Date(NOW + 30 * 60 * 1000).toISOString()}`
    );
    expect(sent[1].idempotencyKey).toContain("session-reminder:instructor:session-1:");
  });

  it("skips the instructor email when there is no instructor user", async () => {
    const { base, sent } = deps([row({ instructorEmail: null })]);
    const summary = await runSessionReminders(base);

    expect(summary.sent).toBe(1);
    expect(sent.map((s) => s.to)).toEqual(["student@example.com"]);
  });

  it("counts a session with no sendable address as skipped", async () => {
    const { base, sent } = deps([row({ studentEmail: "", instructorEmail: null })]);
    const summary = await runSessionReminders(base);

    expect(summary).toMatchObject({ sent: 0, skipped: 1, failed: 0 });
    expect(sent).toHaveLength(0);
  });

  it("counts per-session failures without aborting the rest", async () => {
    const { base, sent } = deps([row(), row({ sessionId: "session-2" })]);
    let call = 0;
    base.sendEmail = async (args: { to: string; idempotencyKey?: string }) => {
      call++;
      if (call === 1) throw new Error("resend down");
      sent.push({ to: args.to, idempotencyKey: args.idempotencyKey });
      return { ok: true as const, id: "id" };
    };

    const summary = await runSessionReminders(base);

    expect(summary.failed).toBe(1);
    expect(summary.sent).toBe(1);
    // The first row aborts on its first send; the second row still sends both.
    expect(sent).toHaveLength(2);
  });

  it("pages until the endpoint says it is done", async () => {
    const { base } = deps([row()], { pages: 2 });
    const summary = await runSessionReminders(base);
    expect(summary.sessionsFound).toBe(1);
    expect(summary.truncated).toBe(false);
  });

  it("reports truncation instead of claiming a complete fan-out", async () => {
    const { base, errors } = deps([row()], { pages: 99 });
    const summary = await runSessionReminders({ ...base, maxPages: 3 });

    expect(summary.truncated).toBe(true);
    expect(errors.some((e) => e.includes("maxPages"))).toBe(true);
  });
});
