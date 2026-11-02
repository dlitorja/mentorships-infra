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
      userId: "user_audit_cleanup",
      email: "audit-cleanup@example.com",
      name: "Audit Cleanup",
      slug: "audit-cleanup",
      isActive: true,
      oneOnOneInventory: 0,
      groupInventory: 0,
      maxActiveStudents: 10,
    });
    return await ctx.db.insert("sessions", {
      instructorId,
      studentId: "user_audit_student",
      scheduledAt: Date.now(),
      status: "completed",
      recordingConsent: true,
      ...patch,
    });
  });
}

test("surfaces stale pending and failed Daily cleanups", async () => {
  const t = convexTest(schema, modules);
  const now = Date.now();

  const stalePending = await seedSession(t, {
    recordingTransferStatus: "ready",
    recordingUrl: "recordings/a/a.mp4",
    recordingDailyCleanupStatus: "pending",
    recordingDailyCleanupUpdatedAt: now - 11 * 60 * 1000,
  });
  const freshPending = await seedSession(t, {
    recordingTransferStatus: "ready",
    recordingUrl: "recordings/b/b.mp4",
    recordingDailyCleanupStatus: "pending",
    recordingDailyCleanupUpdatedAt: now - 60 * 1000,
  });
  const failed = await seedSession(t, {
    recordingTransferStatus: "ready",
    recordingUrl: "recordings/c/c.mp4",
    recordingDailyCleanupStatus: "failed",
    recordingDailyCleanupAttempts: 3,
    recordingDailyCleanupError: "Daily API 500",
    recordingDailyCleanupUpdatedAt: now - 2 * 60 * 1000,
  });
  await seedSession(t, {
    recordingTransferStatus: "ready",
    recordingUrl: "recordings/d/d.mp4",
    recordingDailyCleanupStatus: "done",
    recordingDailyCleanupUpdatedAt: now,
  });

  const result = await t.query(
    internal.audit.recordingTransferAudit.auditRecordingTransferDrift,
    {}
  );

  expect(result.cleanupPendingStuck.map((r) => r.sessionId)).toEqual([
    stalePending,
  ]);
  // Fresh pending rows are still inside the transfer window.
  expect(result.cleanupPendingStuck.map((r) => r.sessionId)).not.toContain(
    freshPending
  );
  expect(result.cleanupFailed).toHaveLength(1);
  expect(result.cleanupFailed[0]).toMatchObject({
    sessionId: failed,
    cleanupStatus: "failed",
    attempts: 3,
    error: "Daily API 500",
  });
});

test("ignores soft-deleted sessions", async () => {
  const t = convexTest(schema, modules);
  const now = Date.now();

  await seedSession(t, {
    recordingTransferStatus: "ready",
    recordingDailyCleanupStatus: "failed",
    recordingDailyCleanupUpdatedAt: now,
    deletedAt: now,
  });

  const result = await t.query(
    internal.audit.recordingTransferAudit.auditRecordingTransferDrift,
    {}
  );
  expect(result.cleanupFailed).toHaveLength(0);
  expect(result.cleanupPendingStuck).toHaveLength(0);
});
