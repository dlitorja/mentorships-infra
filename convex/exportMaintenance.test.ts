/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import { EXPORT_ARTIFACT_TTL_MS } from "./workspaceConstants";

const modules = import.meta.glob("./**/*.ts");

/** Minimal parent rows so the export foreign keys validate. */
async function seedParents(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const instructorId = await ctx.db.insert("instructors", {
      email: "instructor@example.com",
      name: "Instructor",
      isActive: true,
      isNew: false,
      oneOnOneInventory: 0,
      groupInventory: 0,
      maxActiveStudents: 10,
    });
    const workspaceId = await ctx.db.insert("workspaces", {
      name: "Export housekeeping",
      ownerId: "user_student",
      instructorId,
      isPublic: false,
      studentImageCount: 0,
      instructorImageCount: 0,
    });
    const onboardingId = await ctx.db.insert("adminOnboardings", {
      email: "student@example.com",
      flowVersion: 1,
      source: "manual",
      submittedByUserId: "user_submitter",
      status: "completed",
      attemptCount: 1,
      perInstructor: [],
      timeline: [],
      isSeparateStudentRecord: false,
      existingWorkspaceIds: [],
      createdAt: Date.now(),
    });
    return { workspaceId, onboardingId };
  });
}

test("pruneExpiredExportRecords keeps rows newer than the threshold", async () => {
  const t = convexTest(schema, modules);
  const { workspaceId, onboardingId } = await seedParents(t);

  await t.run(async (ctx) => {
    await ctx.db.insert("workspaceExports", {
      workspaceId,
      userId: "user_student",
      format: "zip",
      scope: "images",
      status: "completed",
    });
    await ctx.db.insert("onboardingArtworkExports", {
      onboardingId,
      requestedBy: "user_instructor",
      status: "completed",
    });
  });

  // Nothing was created before the epoch — the sweep must not touch
  // live rows when its threshold is in the past.
  const result = await t.mutation(
    internal.exportMaintenance.pruneExpiredExportRecords,
    { now: 0 }
  );
  expect(result).toEqual({
    workspaceExportsDeleted: 0,
    workspaceExportsTimedOut: 0,
    artworkExportsDeleted: 0,
    artworkExportsTimedOut: 0,
  });
});

test("pruneExpiredExportRecords deletes terminal rows and fails abandoned in-flight rows", async () => {
  const t = convexTest(schema, modules);
  const { workspaceId, onboardingId } = await seedParents(t);

  const ids = await t.run(async (ctx) => {
    const completed = await ctx.db.insert("workspaceExports", {
      workspaceId,
      userId: "user_student",
      format: "zip",
      scope: "images",
      status: "completed",
      downloadUrl: "https://b2.example.com/old.zip",
      expiresAt: Date.now() + 1_000,
    });
    const failed = await ctx.db.insert("workspaceExports", {
      workspaceId,
      userId: "user_student",
      format: "csv",
      scope: "links",
      status: "failed",
      errorMessage: "boom",
    });
    const stuck = await ctx.db.insert("workspaceExports", {
      workspaceId,
      userId: "user_student",
      format: "zip",
      scope: "images",
      status: "processing",
    });
    const artworkCompleted = await ctx.db.insert("onboardingArtworkExports", {
      onboardingId,
      requestedBy: "user_instructor",
      status: "completed",
      downloadUrl: "https://b2.example.com/art.zip",
      expiresAt: Date.now() + 1_000,
    });
    const artworkStuck = await ctx.db.insert("onboardingArtworkExports", {
      onboardingId,
      requestedBy: "user_instructor",
      status: "pending",
    });
    return { completed, failed, stuck, artworkCompleted, artworkStuck };
  });

  // Treat everything as expired.
  const result = await t.mutation(
    internal.exportMaintenance.pruneExpiredExportRecords,
    { now: Date.now() + EXPORT_ARTIFACT_TTL_MS + 60_000 }
  );

  expect(result).toEqual({
    workspaceExportsDeleted: 2,
    workspaceExportsTimedOut: 1,
    artworkExportsDeleted: 1,
    artworkExportsTimedOut: 1,
  });

  const rows = await t.run(async (ctx) => ({
    completed: await ctx.db.get(ids.completed),
    failed: await ctx.db.get(ids.failed),
    stuck: await ctx.db.get(ids.stuck),
    artworkCompleted: await ctx.db.get(ids.artworkCompleted),
    artworkStuck: await ctx.db.get(ids.artworkStuck),
  }));

  expect(rows.completed).toBeNull();
  expect(rows.failed).toBeNull();
  expect(rows.artworkCompleted).toBeNull();

  // Abandoned in-flight rows survive one tick as actionable failures.
  expect(rows.stuck?.status).toBe("failed");
  expect(rows.stuck?.errorMessage).toMatch(/timed out/i);
  expect(rows.artworkStuck?.status).toBe("failed");
  expect(rows.artworkStuck?.errorMessage).toMatch(/timed out/i);
});

test("a second pass removes the rows failed by the first pass", async () => {
  const t = convexTest(schema, modules);
  const { workspaceId } = await seedParents(t);

  const exportId = await t.run(async (ctx) =>
    ctx.db.insert("workspaceExports", {
      workspaceId,
      userId: "user_student",
      format: "zip",
      scope: "images",
      status: "pending",
    })
  );

  await t.mutation(internal.exportMaintenance.pruneExpiredExportRecords, {
    now: Date.now() + EXPORT_ARTIFACT_TTL_MS + 60_000,
  });
  const afterFirst = await t.run(async (ctx) => ctx.db.get(exportId));
  expect(afterFirst?.status).toBe("failed");

  const second = await t.mutation(
    internal.exportMaintenance.pruneExpiredExportRecords,
    { now: Date.now() + EXPORT_ARTIFACT_TTL_MS + 60_000 }
  );
  expect(second.workspaceExportsDeleted).toBe(1);

  const afterSecond = await t.run(async (ctx) => ctx.db.get(exportId));
  expect(afterSecond).toBeNull();
});
