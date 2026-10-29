/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function seedSession(
  t: ReturnType<typeof convexTest>,
  patch: Record<string, unknown>
) {
  return await t.run(async (ctx) => {
    const instructorId = await ctx.db.insert("instructors", {
      userId: "user_guard_instructor",
      email: "guard@example.com",
      name: "Guard Instructor",
      slug: "guard-instructor",
      isActive: true,
      oneOnOneInventory: 0,
      groupInventory: 0,
      maxActiveStudents: 10,
    });
    return await ctx.db.insert("sessions", {
      instructorId,
      studentId: "user_guard_student",
      scheduledAt: Date.now(),
      status: "completed",
      recordingConsent: true,
      ...patch,
    });
  });
}

test("marks a pending transfer failed", async () => {
  const t = convexTest(schema, modules);
  const sessionId = await seedSession(t, { recordingTransferStatus: "pending" });

  const result = await t.mutation(
    internal.sessions.markRecordingTransferFailedIfPending,
    { sessionId, errorMessage: "trigger failed", attempts: 0 }
  );
  expect(result.ignored).toBe(false);

  const session = await t.run(async (ctx) => await ctx.db.get(sessionId));
  expect(session?.recordingTransferStatus).toBe("failed");
  expect(session?.recordingTransferError).toBe("trigger failed");
});

test("does not regress a completed transfer (lost trigger response race)", async () => {
  const t = convexTest(schema, modules);
  const sessionId = await seedSession(t, {
    recordingTransferStatus: "ready",
    recordingUrl: "recordings/session/rec.mp4",
    hasRecordingArtifact: true,
  });

  const result = await t.mutation(
    internal.sessions.markRecordingTransferFailedIfPending,
    { sessionId, errorMessage: "late trigger error", attempts: 0 }
  );
  expect(result.ignored).toBe(true);

  const session = await t.run(async (ctx) => await ctx.db.get(sessionId));
  expect(session?.recordingTransferStatus).toBe("ready");
  expect(session?.recordingUrl).toBe("recordings/session/rec.mp4");
});

test("does not mark a running (uploading) transfer failed", async () => {
  const t = convexTest(schema, modules);
  const sessionId = await seedSession(t, {
    recordingTransferStatus: "uploading",
  });

  const result = await t.mutation(
    internal.sessions.markRecordingTransferFailedIfPending,
    { sessionId, errorMessage: "late trigger error", attempts: 0 }
  );
  expect(result.ignored).toBe(true);

  const session = await t.run(async (ctx) => await ctx.db.get(sessionId));
  expect(session?.recordingTransferStatus).toBe("uploading");
});
