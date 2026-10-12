/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

/**
 * Tests for `convex/adminMigration.ts:reassignInstructorFromDuplicate`.
 *
 * Covers the Greptile findings on PR #922:
 *   - P1 #3: existing sessions must be reassigned to the new instructor
 *     so `resolveSessionWorkspace` keeps resolving the same workspace.
 *   - P2 #6: rerun after the Clerk deletion cron has cleared `userId`
 *     should return `alreadyCompleted: true` instead of throwing.
 */

const OLD_INSTRUCTOR = "jd748t2bzr76fh8wazzxwsv6tn8f8hhj";
const OLD_USER = "j575hh3gp04w8asagws33gb0ks8f8apv";
const OLD_CLERK = "user_3Jw6nFD2FxAA4631ZFRP7wkODsG";
const NEW_INSTRUCTOR = "jd79ys4j7ga0xn4x5292v383g9857ra1";
const EMAIL = "nrcgray@gmail.com";

async function seedFixFixture(ctx: any) {
  const oldInstructorId = await ctx.db.insert("instructors", {
    userId: OLD_CLERK,
    name: EMAIL,
    slug: "niel-gray-dup",
    email: EMAIL,
    isActive: true,
    isNew: false,
    maxActiveStudents: 10,
    oneOnOneInventory: 0,
    groupInventory: 0,
  });
  const newInstructorId = await ctx.db.insert("instructors", {
    userId: "user_3JLY363VPXgJK8p4GhCWjuM4b10",
    name: "Neil Gray",
    slug: "neil-gray",
    email: EMAIL,
    isActive: true,
    isNew: false,
    maxActiveStudents: 10,
    oneOnOneInventory: 0,
    groupInventory: 0,
  });
  const oldUserId = await ctx.db.insert("users", {
    userId: OLD_CLERK,
    clerkId: OLD_CLERK,
    email: EMAIL,
    role: "instructor",
  });
  return { oldInstructorId, newInstructorId, oldUserId };
}

test("reassignInstructorFromDuplicate: reassigns sessions.instructorId (Greptile P1 #3)", async () => {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const ids = await seedFixFixture(ctx);
    const workspaceId = await ctx.db.insert("workspaces", {
      name: "tracyhouston000@gmail.com × nrcgray@gmail.com",
      ownerId: "user_3KTVlzqxT60jhQZHHyDyBCUjPx9",
      instructorId: ids.oldInstructorId,
      isPublic: false,
      studentImageCount: 0,
      instructorImageCount: 0,
    });
    await ctx.db.insert("sessionPacks", {
      instructorId: ids.oldInstructorId,
      userId: "user_3KTVlzqxT60jhQZHHyDyBCUjPx9",
      totalSessions: 4,
      remainingSessions: 3,
      status: "active",
      purchasedAt: Date.now(),
    });
    const sessionId = await ctx.db.insert("sessions", {
      instructorId: ids.oldInstructorId,
      studentId: "user_3KTVlzqxT60jhQZHHyDyBCUjPx9",
      workspaceId,
      scheduledAt: Date.now() + 24 * 60 * 60 * 1000,
      status: "scheduled",
      recordingConsent: true,
    });
    return { ...ids, sessionId };
  });

  const result = await t.mutation(internal.adminMigration.reassignInstructorFromDuplicate, {
    oldInstructorId: ids.oldInstructorId as any,
    oldUserId: ids.oldUserId as any,
    oldClerkUserId: OLD_CLERK,
    newInstructorId: ids.newInstructorId as any,
  });

  expect(Array.isArray((result as any).applied)).toBe(true);
  expect((result as any).applied.map((a: any) => a.action)).toEqual(
    expect.arrayContaining(["reassign_session_instructor_from_duplicate"]),
  );

  const sessionAfter = await t.run(async (ctx) => {
    return await ctx.db.get(ids.sessionId as string);
  });
  expect(sessionAfter?.instructorId).toBe(ids.newInstructorId);
});

test("reassignInstructorFromDuplicate: idem rerun after Clerk deletion cleared userId (Greptile P2 #6)", async () => {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const ids = await seedFixFixture(ctx);
    // Simulate state after Clerk's deletion webhook cleared `userId`
    // and the cleanup has already run.
    await ctx.db.patch(ids.oldInstructorId, {
      deletedAt: Date.now() - 60_000,
      isActive: false,
      updatedAt: Date.now() - 60_000,
    });
    await ctx.db.patch(ids.oldUserId, { deletedAt: Date.now() - 60_000 });
    await ctx.db.insert("pendingClerkDeletions", {
      clerkUserId: OLD_CLERK,
      instructorId: ids.newInstructorId,
      attempts: 0,
      createdAt: Date.now(),
    });
    return ids;
  });

  const result = await t.mutation(internal.adminMigration.reassignInstructorFromDuplicate, {
    oldInstructorId: ids.oldInstructorId as any,
    oldUserId: ids.oldUserId as any,
    oldClerkUserId: OLD_CLERK,
    newInstructorId: ids.newInstructorId as any,
  });

  expect(result.applied).toBe(false);
  expect((result as any).alreadyCompleted).toBe(true);
});

test("reassignInstructorFromDuplicate: refuses to skip if oldUser is NOT soft-deleted (Greptile P1 #8)", async () => {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const ids = await seedFixFixture(ctx);
    // Admin deleted the instructor via the regular path but did NOT
    // delete the user or queue Clerk deletion. The cleanup must NOT
    // report alreadyCompleted and must finish the missing user/Clerk
    // cleanup steps.
    await ctx.db.patch(ids.oldInstructorId, {
      deletedAt: Date.now() - 60_000,
      isActive: false,
      updatedAt: Date.now() - 60_000,
    });
    return ids;
  });

  const result = await t.mutation(internal.adminMigration.reassignInstructorFromDuplicate, {
    oldInstructorId: ids.oldInstructorId as any,
    oldUserId: ids.oldUserId as any,
    oldClerkUserId: OLD_CLERK,
    newInstructorId: ids.newInstructorId as any,
  });

  expect((result as any).alreadyCompleted).toBeUndefined();
  expect(Array.isArray((result as any).applied)).toBe(true);
  const appliedActions = (result as any).applied.map((a: any) => a.action);
  expect(appliedActions).toEqual(
    expect.arrayContaining([
      "soft_delete_duplicate_user",
      "queue_duplicate_clerk_user_for_deletion",
    ]),
  );
});

test("reassignInstructorFromDuplicate: still reports alreadyCompleted after pending deletion was consumed (audit-trail signal)", async () => {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const ids = await seedFixFixture(ctx);
    await ctx.db.patch(ids.oldInstructorId, {
      deletedAt: Date.now() - 60_000,
      isActive: false,
      updatedAt: Date.now() - 60_000,
    });
    await ctx.db.patch(ids.oldUserId, { deletedAt: Date.now() - 60_000 });
    // Simulate processPendingClerkDeletions having removed the queued row,
    // but write the audit log entry so the cleanup can still detect that
    // deletion was previously queued.
    await ctx.db.insert("auditLogs", {
      actorId: "system",
      actorRole: "system",
      action: "queue_duplicate_clerk_user_for_deletion",
      targetType: "pendingClerkDeletion",
      targetId: OLD_CLERK,
      details: `Fix duplicate-instructor account (note=test); oldInstructor=${ids.oldInstructorId} newInstructor=${ids.newInstructorId} oldClerkUserId=${OLD_CLERK}`,
      metadata: {
        note: "test",
        oldInstructorId: ids.oldInstructorId,
        newInstructorId: ids.newInstructorId,
        oldUserId: ids.oldUserId,
        oldClerkUserId: OLD_CLERK,
      },
      timestamp: Date.now() - 30_000,
    });
    return ids;
  });

  const result = await t.mutation(internal.adminMigration.reassignInstructorFromDuplicate, {
    oldInstructorId: ids.oldInstructorId as any,
    oldUserId: ids.oldUserId as any,
    oldClerkUserId: OLD_CLERK,
    newInstructorId: ids.newInstructorId as any,
  });

  expect((result as any).alreadyCompleted).toBe(true);
  expect((result as any).applied).toBe(false);
});
