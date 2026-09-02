/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { internal } from "./_generated/api";
import { getRecordingWarningThreshold } from "./recordingRetention";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const DAY_MS = 24 * 60 * 60 * 1000;

test("recording warnings use canonical 30, 7, and 1 day thresholds", () => {
  const now = 1_800_000_000_000;

  expect(getRecordingWarningThreshold(now + 31 * DAY_MS, now)).toBeNull();
  expect(getRecordingWarningThreshold(now + 29.5 * DAY_MS, now)).toBe(30);
  expect(getRecordingWarningThreshold(now + 6.5 * DAY_MS, now)).toBe(7);
  expect(getRecordingWarningThreshold(now + 0.5 * DAY_MS, now)).toBe(1);
  expect(getRecordingWarningThreshold(now, now)).toBeNull();
});

test("failed recording warning delivery can be claimed again", async () => {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const instructorId = await ctx.db.insert("instructors", {
      userId: "user_instructor_retention",
      email: "instructor@example.com",
      name: "Test Instructor",
      slug: "test-instructor-retention",
      isActive: true,
      oneOnOneInventory: 0,
      groupInventory: 0,
      maxActiveStudents: 10,
    });
    const workspaceId = await ctx.db.insert("workspaces", {
      name: "Retention Workspace",
      ownerId: "user_student_retention",
      instructorId,
      isPublic: false,
      studentImageCount: 0,
      instructorImageCount: 0,
    });
    const sessionId = await ctx.db.insert("sessions", {
      instructorId,
      studentId: "user_student_retention",
      scheduledAt: Date.now(),
      status: "completed",
      recordingConsent: true,
    });
    return { sessionId, workspaceId };
  });

  const args = {
    ...ids,
    recipientUserId: "user_student_retention",
    recipientRole: "student" as const,
    notificationType: "expiry_warning" as const,
    recordingExpiresAt: Date.now() + 7 * DAY_MS,
    daysUntilDeletion: 7,
  };

  const first = await t.mutation(
    internal.recordingRetention.createRecordingRetentionNotification,
    args
  );
  expect(first.skipped).toBe(false);

  const duplicate = await t.mutation(
    internal.recordingRetention.createRecordingRetentionNotification,
    args
  );
  expect(duplicate.skipped).toBe(true);

  await t.mutation(
    internal.recordingRetention.finalizeRecordingRetentionNotification,
    { id: first.id, status: "failed", errorMessage: "provider unavailable" }
  );

  const retry = await t.mutation(
    internal.recordingRetention.createRecordingRetentionNotification,
    args
  );
  expect(retry).toEqual({ skipped: false, id: first.id });

  await t.mutation(
    internal.recordingRetention.finalizeRecordingRetentionNotification,
    { id: first.id, status: "sent", providerEmailId: "email_123" }
  );
  const delivered = await t.mutation(
    internal.recordingRetention.createRecordingRetentionNotification,
    args
  );
  expect(delivered.skipped).toBe(true);
});
