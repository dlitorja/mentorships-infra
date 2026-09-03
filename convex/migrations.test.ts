/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import migrationsTest from "@convex-dev/migrations/test";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function seedWorkspacePair(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const instructorId = await ctx.db.insert("instructors", {
      userId: "user_instructor_migrations",
      email: "instructor@example.com",
      name: "Test Instructor",
      slug: "test-instructor-migrations",
      isActive: true,
      oneOnOneInventory: 0,
      groupInventory: 0,
      maxActiveStudents: 10,
    });
    const sessionPackId = await ctx.db.insert("sessionPacks", {
      userId: "user_student_migrations",
      instructorId,
      totalSessions: 4,
      remainingSessions: 4,
      purchasedAt: Date.now(),
      status: "active",
    });
    const seatReservationId = await ctx.db.insert("seatReservations", {
      instructorId,
      userId: "user_student_migrations",
      sessionPackId,
      seatExpiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
      status: "active",
    });
    const workspaceId = await ctx.db.insert("workspaces", {
      name: "Current Workspace",
      ownerId: "user_student_migrations",
      instructorId,
      seatReservationId,
      isPublic: false,
      studentImageCount: 0,
      instructorImageCount: 0,
      type: "mentorship",
    });
    return { instructorId, sessionPackId, workspaceId };
  });
}

test("backfillSessionWorkspaceLinks flips hasRecordingArtifact on transfer-only rows and surfaces them in the recordings query", async () => {
  // Greptile R5 P5 contract: the recording query paginates on
  // `hasRecordingArtifact === true`, so the deploy-time pre-requisite is
  // that `backfillSessionWorkspaceLinks` runs before production traffic.
  // This test pins that contract — a future refactor of either the
  // backfill OR the query will fail CI rather than silently break the
  // Calls/Videos views.
  const t = convexTest(schema, modules);
  migrationsTest.register(t);
  const { instructorId, workspaceId } = await seedWorkspacePair(t);
  const transferOnlyId = await t.run(async (ctx) => {
    return await ctx.db.insert("sessions", {
      instructorId,
      studentId: "user_student_migrations",
      // Note: workspaceId is intentionally NOT set — the backfill is
      // supposed to set it via `resolveSessionWorkspace`.
      scheduledAt: Date.now() - 5_000,
      status: "completed",
      recordingConsent: true,
      callStartedAt: Date.now() - 5_000,
      recordingTransferStatus: "ready",
      // `hasRecordingArtifact` intentionally NOT set — this is the
      // late-stage transfer pipeline shape the backfill is meant to
      // upgrade.
    });
  });

  // Pre-condition: query misses the row.
  const before = await t
    .withIdentity({ subject: "user_student_migrations" })
    .query(api.sessions.getCallRecordingsForWorkspace, {
      workspaceId,
      paginationOpts: { numItems: 50, cursor: null },
    });
  expect(before.page.map((row) => row.sessionId)).not.toContain(transferOnlyId);

  // Run the bound migration runner. Args are optional — the runner
  // is bound to `backfillSessionWorkspaceLinks` at definition time.
  await t.mutation(internal.migrations.runBackfillSessionWorkspaceLinks, {});

  // Post-condition #1: row has `hasRecordingArtifact: true` AND
  // `workspaceId` set (proves both branches of the backfill ran).
  const updated = await t.run(async (ctx) => await ctx.db.get(transferOnlyId));
  expect(updated?.hasRecordingArtifact).toBe(true);
  expect(updated?.workspaceId).toBe(workspaceId);

  // Post-condition #2: query now surfaces the row — proves the
  // contract between the backfill and the recording query is intact.
  const after = await t
    .withIdentity({ subject: "user_student_migrations" })
    .query(api.sessions.getCallRecordingsForWorkspace, {
      workspaceId,
      paginationOpts: { numItems: 50, cursor: null },
    });
  expect(after.page.map((row) => row.sessionId)).toContain(transferOnlyId);
});

test("backfillSessionWorkspaceLinks is idempotent — second run is a no-op", async () => {
  const t = convexTest(schema, modules);
  migrationsTest.register(t);
  const { instructorId, workspaceId } = await seedWorkspacePair(t);
  const sessionId = await t.run(async (ctx) => {
    return await ctx.db.insert("sessions", {
      instructorId,
      studentId: "user_student_migrations",
      scheduledAt: Date.now() - 5_000,
      status: "completed",
      recordingConsent: true,
      callStartedAt: Date.now() - 5_000,
      recordingTransferStatus: "ready",
    });
  });

  await t.mutation(internal.migrations.runBackfillSessionWorkspaceLinks, {});
  const afterFirst = await t.run(async (ctx) => await ctx.db.get(sessionId));
  expect(afterFirst?.hasRecordingArtifact).toBe(true);
  expect(afterFirst?.workspaceId).toBe(workspaceId);

  // Re-run must not throw and must leave the row unchanged.
  await t.mutation(internal.migrations.runBackfillSessionWorkspaceLinks, {});
  const afterSecond = await t.run(async (ctx) => await ctx.db.get(sessionId));
  expect(afterSecond?.hasRecordingArtifact).toBe(true);
  expect(afterSecond?.workspaceId).toBe(workspaceId);
});
