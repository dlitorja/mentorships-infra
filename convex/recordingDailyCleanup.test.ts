/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function seedReadySession(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const instructorId = await ctx.db.insert("instructors", {
      userId: "user_instructor_cleanup",
      email: "instructor-cleanup@example.com",
      name: "Test Instructor",
      slug: "test-instructor-cleanup",
      isActive: true,
      oneOnOneInventory: 0,
      groupInventory: 0,
      maxActiveStudents: 10,
    });
    const sessionId = await ctx.db.insert("sessions", {
      instructorId,
      studentId: "user_student_cleanup",
      scheduledAt: Date.now(),
      status: "completed",
      recordingConsent: true,
      recordingUrl: "recordings/session-1/rec-1.mp4",
      recordingId: "rec-1",
      recordingTransferStatus: "ready",
      recordingDailyCleanupStatus: "pending",
    });
    return { instructorId, sessionId };
  });
}

test("markRecordingDailyCleanupDone flips only the cleanup status", async () => {
  const t = convexTest(schema, modules);
  const { sessionId } = await seedReadySession(t);

  const result = await t.mutation(
    internal.sessions.markRecordingDailyCleanupDone,
    { sessionId }
  );
  expect(result.alreadyDone).toBe(false);

  const session = await t.run(async (ctx) => await ctx.db.get(sessionId));
  expect(session?.recordingDailyCleanupStatus).toBe("done");
  // The B2 recording must stay playable: a Daily delete outcome
  // must never be mistaken for a transfer outcome.
  expect(session?.recordingTransferStatus).toBe("ready");
  expect(session?.recordingUrl).toBe("recordings/session-1/rec-1.mp4");

  const again = await t.mutation(
    internal.sessions.markRecordingDailyCleanupDone,
    { sessionId }
  );
  expect(again.alreadyDone).toBe(true);
});

test("markRecordingDailyCleanupFailed records the error without touching the transfer", async () => {
  const t = convexTest(schema, modules);
  const { sessionId } = await seedReadySession(t);

  const result = await t.mutation(
    internal.sessions.markRecordingDailyCleanupFailed,
    {
      sessionId,
      errorMessage: "Daily API 500",
    }
  );
  expect(result.ignored).toBe(false);

  const session = await t.run(async (ctx) => await ctx.db.get(sessionId));
  expect(session?.recordingDailyCleanupStatus).toBe("failed");
  expect(session?.recordingDailyCleanupError).toBe("Daily API 500");
  expect(session?.recordingTransferStatus).toBe("ready");
  expect(session?.recordingUrl).toBe("recordings/session-1/rec-1.mp4");
});

test("markRecordingDailyCleanupFailed ignores a stale failure after done", async () => {
  const t = convexTest(schema, modules);
  const { sessionId } = await seedReadySession(t);

  await t.mutation(internal.sessions.markRecordingDailyCleanupDone, {
    sessionId,
  });
  // A concurrent run that started before the delete landed must not
  // regress the row: the Daily copy is already gone.
  const result = await t.mutation(
    internal.sessions.markRecordingDailyCleanupFailed,
    {
      sessionId,
      errorMessage: "Late 500 from a concurrent run",
    }
  );
  expect(result.ignored).toBe(true);

  const session = await t.run(async (ctx) => await ctx.db.get(sessionId));
  expect(session?.recordingDailyCleanupStatus).toBe("done");
  expect(session?.recordingDailyCleanupError).toBeUndefined();
  expect(session?.recordingTransferStatus).toBe("ready");
});

test("markRecordingDailyCleanupRetrying advances the run counter monotonically", async () => {
  const t = convexTest(schema, modules);
  const { sessionId } = await seedReadySession(t);

  const first = await t.mutation(
    internal.sessions.markRecordingDailyCleanupRetrying,
    { sessionId }
  );
  expect(first.attempts).toBe(1);
  expect(first.alreadyDone).toBe(false);

  const second = await t.mutation(
    internal.sessions.markRecordingDailyCleanupRetrying,
    { sessionId }
  );
  expect(second.attempts).toBe(2);
  expect(second.alreadyDone).toBe(false);

  const session = await t.run(async (ctx) => await ctx.db.get(sessionId));
  // The counter is what the route derives its idempotency key from,
  // so it MUST advance on every claim — including claims that later
  // succeed and therefore never write a failure.
  expect(session?.recordingDailyCleanupAttempts).toBe(2);
  expect(session?.recordingDailyCleanupStatus).toBe("pending");
  expect(session?.recordingDailyCleanupError).toBeUndefined();
  expect(session?.recordingDailyCleanupUpdatedAt).toBeGreaterThan(0);
  // Claiming a run must never disturb the B2 side.
  expect(session?.recordingTransferStatus).toBe("ready");
  expect(session?.recordingUrl).toBe("recordings/session-1/rec-1.mp4");
});

test("markRecordingDailyCleanupRetrying does not reopen a completed cleanup", async () => {
  const t = convexTest(schema, modules);
  const { sessionId } = await seedReadySession(t);

  await t.mutation(internal.sessions.markRecordingDailyCleanupDone, {
    sessionId,
  });
  // Simulates a retry request that read the row before another run
  // finished: claiming must not erase `done` (a later failed
  // compensation would then record a false failure).
  const claimed = await t.mutation(
    internal.sessions.markRecordingDailyCleanupRetrying,
    { sessionId }
  );
  expect(claimed.alreadyDone).toBe(true);
  expect(claimed.attempts).toBe(0);

  const session = await t.run(async (ctx) => await ctx.db.get(sessionId));
  expect(session?.recordingDailyCleanupStatus).toBe("done");
  expect(session?.recordingDailyCleanupAttempts).toBeUndefined();
});

test("markRecordingDailyCleanupRetrying clears a prior failure", async () => {
  const t = convexTest(schema, modules);
  const { sessionId } = await seedReadySession(t);

  await t.mutation(internal.sessions.markRecordingDailyCleanupFailed, {
    sessionId,
    errorMessage: "Daily API 500",
  });
  const claimed = await t.mutation(
    internal.sessions.markRecordingDailyCleanupRetrying,
    { sessionId }
  );
  expect(claimed.attempts).toBe(1);

  const session = await t.run(async (ctx) => await ctx.db.get(sessionId));
  expect(session?.recordingDailyCleanupStatus).toBe("pending");
  expect(session?.recordingDailyCleanupError).toBeUndefined();
});

test("attachRecordingFromB2Upload marks Daily cleanup pending", async () => {
  const t = convexTest(schema, modules);
  const { sessionId } = await t.run(async (ctx) => {
    const instructorId = await ctx.db.insert("instructors", {
      userId: "user_instructor_attach",
      email: "instructor-attach@example.com",
      name: "Test Instructor",
      slug: "test-instructor-attach",
      isActive: true,
      oneOnOneInventory: 0,
      groupInventory: 0,
      maxActiveStudents: 10,
    });
    const id = await ctx.db.insert("sessions", {
      instructorId,
      studentId: "user_student_attach",
      scheduledAt: Date.now(),
      status: "completed",
      recordingConsent: true,
      recordingTransferStatus: "pending",
    });
    return { sessionId: id };
  });

  const result = await t.mutation(
    internal.sessions.attachRecordingFromB2Upload,
    {
      sessionId,
      b2Key: "recordings/session-2/rec-2.mp4",
      recordingId: "rec-2",
    }
  );
  expect(result.updated).toBe(true);

  const session = await t.run(async (ctx) => await ctx.db.get(sessionId));
  expect(session?.recordingTransferStatus).toBe("ready");
  expect(session?.recordingUrl).toBe("recordings/session-2/rec-2.mp4");
  expect(session?.recordingDailyCleanupStatus).toBe("pending");
  expect(session?.recordingDailyCleanupUpdatedAt).toBeGreaterThan(0);
});
