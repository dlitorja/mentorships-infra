import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `send-session-reminders` used to query Supabase/Postgres with Drizzle.
 * It now pages `GET /session-notifications/reminder-window` on Convex, so
 * this file mocks `fetch` instead of the ORM.
 *
 * The row-shaping assertions that lived here (projection keys, join count)
 * described the SQL that no longer exists; they were replaced by the
 * request-shape assertions below plus the Convex query tests in
 * `convex/sessionNotifications.test.ts`.
 */

type CapturedSchedule = {
  id: string;
  cron: string;
  run: (payload: { timestamp: Date }) => Promise<{
    sessionsFound: number;
    sent: number;
    skipped: number;
    failed: number;
    truncated: boolean;
  }>;
};

const state = vi.hoisted(() => ({
  schedule: null as unknown as CapturedSchedule | null,
}));

const sendEmailMock = vi.hoisted(() => vi.fn().mockResolvedValue({ ok: true, id: "id" }));

vi.mock("@trigger.dev/sdk", () => ({
  schedules: {
    task: vi.fn((config: { id: string; cron: string; run: CapturedSchedule["run"] }) => {
      if (config.id === "send-session-reminders") {
        state.schedule = { id: config.id, cron: config.cron, run: config.run };
      }
      return { id: config.id };
    }),
  },
  task: vi.fn((config: { id: string }) => ({ id: config.id })),
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

vi.mock("../../../packages/emails/src/send", () => ({
  sendEmail: (...args: unknown[]) => sendEmailMock(...args),
}));

vi.mock("../../../packages/emails/src/session-changes", () => ({
  buildSessionCanceledEmail: vi.fn(),
  buildSessionRescheduledEmail: vi.fn(),
  buildSessionReminderEmail: vi.fn(() => ({
    subject: "reminder",
    text: "text",
    html: "<p>html</p>",
    headers: { "X-Email-Type": "session_reminder_student" },
  })),
  buildInstructorReminderEmail: vi.fn(() => ({
    subject: "instructor reminder",
    text: "text",
    html: "<p>html</p>",
    headers: { "X-Email-Type": "session_reminder_instructor" },
  })),
}));

const TICK = new Date("2026-11-06T14:30:00.000Z");
const ROW = {
  sessionId: "session_1",
  scheduledAt: new Date("2026-11-06T15:00:00.000Z").getTime(),
  studentEmail: "student@example.com",
  studentTimeZone: "America/New_York",
  instructorName: "Painter Pat",
  instructorEmail: "pat@example.com",
  instructorTimeZone: "America/Los_Angeles",
};

function mockFetch(pages: Array<{ rows: unknown[]; isDone: boolean; continueCursor: string | null }>) {
  const calls: string[] = [];
  let index = 0;
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    calls.push(String(input));
    const page = pages[Math.min(index++, pages.length - 1)];
    return new Response(JSON.stringify(page), { status: 200 });
  }) as unknown as typeof fetch;
  return calls;
}

describe("send-session-reminders (Convex-backed)", () => {
  beforeEach(async () => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    process.env.CONVEX_HTTP_KEY = "test-key";
    sendEmailMock.mockClear();
    if (!state.schedule) {
      await import("../../../src/trigger/session-change-notifications");
    }
  });

  it("registers the */15 schedule", () => {
    expect(state.schedule).not.toBeNull();
    expect(state.schedule!.id).toBe("send-session-reminders");
    expect(state.schedule!.cron).toBe("*/15 * * * *");
  });

  it("requests the Convex reminder window over the .convex.site host", async () => {
    const calls = mockFetch([{ rows: [], isDone: true, continueCursor: null }]);
    await state.schedule!.run({ timestamp: TICK });

    expect(calls).toHaveLength(1);
    const url = new URL(calls[0]);
    expect(url.host).toBe("example.convex.site");
    expect(url.pathname).toBe("/session-notifications/reminder-window");
    // 30-minute lead time, ±7.5 minute half-window around the tick.
    expect(Number(url.searchParams.get("start"))).toBe(
      TICK.getTime() + (30 - 7.5) * 60 * 1000
    );
    expect(Number(url.searchParams.get("end"))).toBe(
      TICK.getTime() + (30 + 7.5) * 60 * 1000
    );
    expect(url.searchParams.get("cursor")).toBeNull();
  });

  it("follows the continuation cursor and sends both reminder emails", async () => {
    const calls = mockFetch([
      { rows: [ROW], isDone: false, continueCursor: "cursor-2" },
      { rows: [], isDone: true, continueCursor: null },
    ]);

    const result = await state.schedule!.run({ timestamp: TICK });

    expect(calls).toHaveLength(2);
    expect(new URL(calls[1]).searchParams.get("cursor")).toBe("cursor-2");
    expect(result).toMatchObject({ sessionsFound: 1, sent: 1, failed: 0, truncated: false });
    expect(sendEmailMock).toHaveBeenCalledTimes(2);
  });

  it("surfaces a non-2xx Convex response instead of silently sending nothing", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response("boom", { status: 500 })
    ) as unknown as typeof fetch;

    await expect(state.schedule!.run({ timestamp: TICK })).rejects.toThrow(
      /reminder-window failed: 500/
    );
    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});
