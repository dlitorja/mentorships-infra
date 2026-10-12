import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

const capturedProjection: Array<Record<string, unknown>> = [];
const capturedJoinCount = { value: 0 };
let capturedSchedule: { id: string; cron: string; run: (payload: { timestamp: Date }) => Promise<unknown> } | null = null;

const EXPECTED_PROJECTION_KEYS = [
  "sessionId",
  "scheduledAt",
  "studentId",
  "instructorId",
  "studentEmail",
  "studentTimeZone",
  "instructorName",
  "instructorUserId",
];

const sendEmailMock = vi.fn().mockResolvedValue({ ok: true });
const findFirstByInstructorUserIdMock = vi.fn();

vi.mock("@trigger.dev/sdk", () => ({
  schedules: {
    task: vi.fn((config) => {
      if (config.id === "send-session-reminders") {
        capturedSchedule = {
          id: config.id,
          cron: config.cron,
          run: config.run as (payload: { timestamp: Date }) => Promise<unknown>,
        };
      }
      return { id: config.id };
    }),
  },
  task: vi.fn((config) => ({ id: config.id, run: config.run })),
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock("../../../packages/emails/src/send", () => ({
  sendEmail: (...args: unknown[]) => sendEmailMock(...args),
}));

const buildSessionReminderEmailMock = vi.fn((args: unknown) => ({
  subject: "reminder-subject",
  text: "reminder-text",
  html: "<p>reminder-html</p>",
  headers: { "X-Email-Type": "session_reminder_student" },
  __args: args,
}));
const buildInstructorReminderEmailMock = vi.fn((args: unknown) => ({
  subject: "instructor-reminder-subject",
  text: "instructor-reminder-text",
  html: "<p>instructor-reminder-html</p>",
  headers: { "X-Email-Type": "session_reminder_instructor" },
  __args: args,
}));

vi.mock("../../../packages/emails/src/session-changes", () => ({
  buildSessionCanceledEmail: vi.fn(),
  buildSessionRescheduledEmail: vi.fn(),
  buildStudentCanceledEmail: vi.fn(),
  buildSessionReminderEmail: (...args: unknown[]) => buildSessionReminderEmailMock(...args),
  buildInstructorReminderEmail: (...args: unknown[]) => buildInstructorReminderEmailMock(...args),
}));

let nextPage: unknown[] = [];

const queryChain = {
  from: vi.fn(),
  innerJoin: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  offset: vi.fn(),
};

function resetQueryChain() {
  queryChain.from.mockReturnValue(queryChain);
  queryChain.innerJoin.mockImplementation(() => {
    capturedJoinCount.value += 1;
    return queryChain;
  });
  queryChain.where.mockReturnValue(queryChain);
  queryChain.orderBy.mockReturnValue(queryChain);
  queryChain.limit.mockReturnValue(queryChain);
  queryChain.offset.mockImplementation(() => {
    const page = nextPage;
    nextPage = [];
    return Promise.resolve(page);
  });
}

vi.mock("../../../packages/db/src/lib/drizzle", () => ({
  db: {
    select: (projection: Record<string, unknown>) => {
      capturedProjection.push(projection);
      resetQueryChain();
      return queryChain;
    },
    query: {
      users: {
        findFirst: (args: { where: unknown }) => {
          const eq = args?.where as { _val?: unknown } | undefined;
          const target = eq?._val;
          return findFirstByInstructorUserIdMock(target);
        },
      },
      instructors: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      sessionPacks: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    },
  },
}));

vi.mock("../../../packages/db/src/schema", () => ({
  sessions: {
    id: "sessions.id",
    scheduledAt: "sessions.scheduledAt",
    studentId: "sessions.studentId",
    instructorId: "sessions.instructorId",
    sessionPackId: "sessions.sessionPackId",
    status: "sessions.status",
  },
  users: {
    id: "users.id",
    email: "users.email",
    timeZone: "users.timeZone",
  },
  instructors: {
    id: "instructors.id",
    name: "instructors.name",
    userId: "instructors.userId",
  },
  sessionPacks: {
    id: "session_packs.id",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ _col: col, _val: val }),
  and: vi.fn(() => "and"),
  gte: vi.fn(() => "gte"),
  lt: vi.fn(() => "lt"),
}));

describe("send-session-reminders query projection", () => {
  beforeAll(async () => {
    await import("../../../src/trigger/session-change-notifications");
  });

  beforeEach(() => {
    capturedProjection.length = 0;
    capturedJoinCount.value = 0;
    nextPage = [];
    sendEmailMock.mockClear();
    findFirstByInstructorUserIdMock.mockReset();
    resetQueryChain();
  });

  it("registers the schedule with id send-session-reminders and */15 cron", () => {
    expect(capturedSchedule).not.toBeNull();
    expect(capturedSchedule!.id).toBe("send-session-reminders");
    expect(capturedSchedule!.cron).toBe("*/15 * * * *");
  });

  it("selects exactly the eight fields the email builders consume", async () => {
    expect(capturedSchedule).not.toBeNull();
    await capturedSchedule!.run({ timestamp: new Date("2026-10-12T02:30:00.000Z") });

    expect(capturedProjection).toHaveLength(1);
    const actualKeys = Object.keys(capturedProjection[0]).sort();
    const expectedKeys = [...EXPECTED_PROJECTION_KEYS].sort();
    expect(actualKeys).toEqual(expectedKeys);
  });

  it("does not join sessionPacks in the reminder query", async () => {
    expect(capturedSchedule).not.toBeNull();
    await capturedSchedule!.run({ timestamp: new Date("2026-10-12T02:30:00.000Z") });

    expect(capturedJoinCount.value).toBe(2);
  });

  it("sends both student and instructor reminder emails when the per-row shape is right", async () => {
    expect(capturedSchedule).not.toBeNull();

    const scheduledAt = new Date("2026-10-12T03:00:00.000Z");
    nextPage = [
      {
        sessionId: "sess_1",
        scheduledAt,
        studentId: "user_student_1",
        instructorId: "instr_1",
        studentEmail: "student@example.com",
        studentTimeZone: "America/New_York",
        instructorName: "Painter Pat",
        instructorUserId: "user_instructor_1",
      },
    ];

    findFirstByInstructorUserIdMock.mockResolvedValue({
      id: "user_instructor_1",
      email: "pat@example.com",
      timeZone: "America/Los_Angeles",
    });

    const result = (await capturedSchedule!.run({
      timestamp: new Date("2026-10-12T02:30:00.000Z"),
    })) as { sessionsFound: number; sent: number; skipped: number; failed: number };

    expect(result.sessionsFound).toBe(1);
    expect(result.sent).toBe(1);
    expect(result.failed).toBe(0);

    expect(buildSessionReminderEmailMock).toHaveBeenCalledTimes(1);
    expect(buildInstructorReminderEmailMock).toHaveBeenCalledTimes(1);

    const studentBuildArgs = buildSessionReminderEmailMock.mock.calls[0][0] as {
      studentEmail: string;
      studentName: string;
      instructorName: string;
      scheduledAt: Date;
      minutesUntil: number;
      studentTimeZone: string | null;
    };
    expect(studentBuildArgs.studentEmail).toBe("student@example.com");
    expect(studentBuildArgs.studentName).toBe("student");
    expect(studentBuildArgs.instructorName).toBe("Painter Pat");
    expect(studentBuildArgs.scheduledAt).toBe(scheduledAt);
    expect(studentBuildArgs.studentTimeZone).toBe("America/New_York");

    const instructorBuildArgs = buildInstructorReminderEmailMock.mock.calls[0][0] as {
      instructorEmail: string;
      instructorName: string;
      studentEmail: string;
      scheduledAt: Date;
    };
    expect(instructorBuildArgs.instructorEmail).toBe("pat@example.com");
    expect(instructorBuildArgs.instructorName).toBe("Painter Pat");
    expect(instructorBuildArgs.studentEmail).toBe("student@example.com");
    expect(instructorBuildArgs.scheduledAt).toBe(scheduledAt);

    expect(sendEmailMock).toHaveBeenCalledTimes(2);
    const studentCall = sendEmailMock.mock.calls.find(
      (c) => (c[0] as { to: string }).to === "student@example.com",
    );
    const instructorCall = sendEmailMock.mock.calls.find(
      (c) => (c[0] as { to: string }).to === "pat@example.com",
    );
    expect(studentCall).toBeDefined();
    expect(instructorCall).toBeDefined();
    expect((studentCall![0] as { kind: string }).kind).toBe("transactional");
    expect((instructorCall![0] as { kind: string }).kind).toBe("transactional");

    const studentIdempotency = (studentCall![0] as { idempotencyKey: string })
      .idempotencyKey;
    const instructorIdempotency = (instructorCall![0] as { idempotencyKey: string })
      .idempotencyKey;
    expect(studentIdempotency).toBe(
      `session-reminder:student:sess_1:${scheduledAt.toISOString()}`,
    );
    expect(instructorIdempotency).toBe(
      `session-reminder:instructor:sess_1:${scheduledAt.toISOString()}`,
    );
  });
});


