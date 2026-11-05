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

// ---------------------------------------------------------------------------
// relinkDuplicateInstructorEmail
//
// The bug this repairs: the canonical profile is linked to a stale Clerk
// user (the invitation-created account), while the live Clerk user got a
// second, bare instructor row. The admin picker showed the email twice and
// an orphan `users` row blocked role sync for the live user.
// ---------------------------------------------------------------------------

const DUP_EMAIL = "katjbritt@gmail.com";
const CANONICAL_CLERK = "user_staleClerk123";
const LIVE_CLERK = "user_liveClerk456";

async function seedDuplicateEmailFixture(ctx: any) {
  const canonicalInstructorId = await ctx.db.insert("instructors", {
    userId: CANONICAL_CLERK,
    name: "Cedarcia",
    slug: "cedarcia",
    email: DUP_EMAIL,
    isActive: true,
    isListed: true,
    isNew: false,
    maxActiveStudents: 10,
    oneOnOneInventory: 3,
    groupInventory: 0,
  });
  const stubInstructorId = await ctx.db.insert("instructors", {
    userId: LIVE_CLERK,
    email: DUP_EMAIL,
    isActive: true,
    isNew: true,
    maxActiveStudents: 10,
    oneOnOneInventory: 0,
    groupInventory: 0,
  });
  const staleUserId = await ctx.db.insert("users", {
    userId: CANONICAL_CLERK,
    clerkId: CANONICAL_CLERK,
    email: DUP_EMAIL,
    role: "instructor",
  });
  // Uploads and video-editor assignments store the Clerk user id, not
  // `instructors._id`.
  const uploadId = await ctx.db.insert("instructorUploads", {
    instructorId: CANONICAL_CLERK,
    filename: "cedarcia-trailer.mp4",
    originalName: "Cedarcia Trailer.mp4",
    contentType: "video/mp4",
    size: 1024,
    status: "completed",
  });
  const editorAssignmentId = await ctx.db.insert("videoEditorAssignments", {
    videoEditorId: "user_editor123",
    instructorId: CANONICAL_CLERK,
    assignedAt: Date.now(),
  });
  return {
    canonicalInstructorId,
    stubInstructorId,
    staleUserId,
    uploadId,
    editorAssignmentId,
  };
}

test("relinkDuplicateInstructorEmail: dry run reports the plan without writing", async () => {
  const t = convexTest(schema, modules);
  const ids = await t.run((ctx) => seedDuplicateEmailFixture(ctx));

  const result = await t.mutation(
    internal.adminMigration.relinkDuplicateInstructorEmail,
    {
      canonicalInstructorId: ids.canonicalInstructorId,
      duplicateInstructorId: ids.stubInstructorId,
      liveClerkUserId: LIVE_CLERK,
      staleClerkUserId: CANONICAL_CLERK,
      staleUserId: ids.staleUserId,
      dryRun: true,
    } as any,
  );

  expect((result as any).applied).toBe(false);
  expect((result as any).plan.email).toBe(DUP_EMAIL);
  expect((result as any).plan.duplicate._id).toBe(ids.stubInstructorId);

  await t.run(async (ctx) => {
    const canonical = await ctx.db.get(ids.canonicalInstructorId);
    const stub = await ctx.db.get(ids.stubInstructorId);
    const user = await ctx.db.get(ids.staleUserId);
    expect(canonical?.userId).toBe(CANONICAL_CLERK);
    expect(stub?.deletedAt).toBeUndefined();
    expect(user?.clerkId).toBe(CANONICAL_CLERK);
  });
});

test("relinkDuplicateInstructorEmail: relinks the canonical profile, re-keys the users row, and soft-deletes the stub", async () => {
  const t = convexTest(schema, modules);
  const ids = await t.run((ctx) => seedDuplicateEmailFixture(ctx));

  const result = await t.mutation(
    internal.adminMigration.relinkDuplicateInstructorEmail,
    {
      canonicalInstructorId: ids.canonicalInstructorId,
      duplicateInstructorId: ids.stubInstructorId,
      liveClerkUserId: LIVE_CLERK,
      staleClerkUserId: CANONICAL_CLERK,
      staleUserId: ids.staleUserId,
    } as any,
  );

  expect((result as any).appliedCount).toBe(6);

  await t.run(async (ctx) => {
    const upload = await ctx.db.get(ids.uploadId);
    expect(upload?.instructorId).toBe(LIVE_CLERK);

    const assignment = await ctx.db.get(ids.editorAssignmentId);
    expect(assignment?.instructorId).toBe(LIVE_CLERK);

    const canonical = await ctx.db.get(ids.canonicalInstructorId);
    expect(canonical?.userId).toBe(LIVE_CLERK);

    const stub = await ctx.db.get(ids.stubInstructorId);
    expect(stub?.deletedAt).toBeDefined();
    expect(stub?.isActive).toBe(false);
    expect(stub?.isListed).toBe(false);
    // Cleared so `by_userId` resolves unambiguously to the canonical profile.
    expect(stub?.userId).toBeUndefined();

    const user = await ctx.db.get(ids.staleUserId);
    expect(user?.userId).toBe(LIVE_CLERK);
    expect(user?.clerkId).toBe(LIVE_CLERK);
    expect(user?.role).toBe("instructor");

    const liveRows = (await ctx.db.query("instructors").collect()).filter(
      (row) => row.email?.toLowerCase() === DUP_EMAIL && row.deletedAt === undefined,
    );
    expect(liveRows).toHaveLength(1);
    expect(liveRows[0]?._id).toBe(ids.canonicalInstructorId);
  });
});

test("relinkDuplicateInstructorEmail: is idempotent on re-run", async () => {
  const t = convexTest(schema, modules);
  const ids = await t.run((ctx) => seedDuplicateEmailFixture(ctx));
  const args = {
    canonicalInstructorId: ids.canonicalInstructorId,
    duplicateInstructorId: ids.stubInstructorId,
    liveClerkUserId: LIVE_CLERK,
    staleClerkUserId: CANONICAL_CLERK,
    staleUserId: ids.staleUserId,
  } as any;

  await t.mutation(internal.adminMigration.relinkDuplicateInstructorEmail, args);
  const second = await t.mutation(
    internal.adminMigration.relinkDuplicateInstructorEmail,
    args,
  );

  expect((second as any).appliedCount).toBe(0);
  expect((second as any).alreadyCompleted).toBe(true);
});

test("relinkDuplicateInstructorEmail: derives the stale Clerk id from the canonical profile when omitted", async () => {
  // Greptile P1: omitting `staleClerkUserId` used to skip the upload move,
  // the video-editor assignment move, and the stale `users` lookup while
  // still relinking the profile and deleting the stub — leaving the account
  // data behind on the old Clerk id.
  const t = convexTest(schema, modules);
  const ids = await t.run((ctx) => seedDuplicateEmailFixture(ctx));

  const result = await t.mutation(
    internal.adminMigration.relinkDuplicateInstructorEmail,
    {
      canonicalInstructorId: ids.canonicalInstructorId,
      duplicateInstructorId: ids.stubInstructorId,
      liveClerkUserId: LIVE_CLERK,
      // no staleClerkUserId / staleUserId
    } as any,
  );

  expect((result as any).plan.staleClerkUserId).toBe(CANONICAL_CLERK);
  expect((result as any).appliedCount).toBe(6);

  await t.run(async (ctx) => {
    const upload = await ctx.db.get(ids.uploadId);
    expect(upload?.instructorId).toBe(LIVE_CLERK);
    const assignment = await ctx.db.get(ids.editorAssignmentId);
    expect(assignment?.instructorId).toBe(LIVE_CLERK);
    const user = await ctx.db.get(ids.staleUserId);
    expect(user?.clerkId).toBe(LIVE_CLERK);
  });
});

test("relinkDuplicateInstructorEmail: refuses when a video-editor assignment already exists for the live id", async () => {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const ids = await seedDuplicateEmailFixture(ctx);
    await ctx.db.insert("videoEditorAssignments", {
      videoEditorId: "user_editor123",
      instructorId: LIVE_CLERK,
      assignedAt: Date.now(),
    });
    return ids;
  });

  await expect(
    t.mutation(internal.adminMigration.relinkDuplicateInstructorEmail, {
      canonicalInstructorId: ids.canonicalInstructorId,
      duplicateInstructorId: ids.stubInstructorId,
      liveClerkUserId: LIVE_CLERK,
      staleClerkUserId: CANONICAL_CLERK,
      staleUserId: ids.staleUserId,
    } as any),
  ).rejects.toThrow(/video-editor assignment/);
});

test("relinkDuplicateInstructorEmail: clears the user link on an already-deleted stub", async () => {
  // Greptile P1: a stub soft-deleted by `deleteInstructor` keeps `userId`,
  // so `by_userId` can still resolve to the deleted row.
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const ids = await seedDuplicateEmailFixture(ctx);
    await ctx.db.patch(ids.stubInstructorId, {
      deletedAt: Date.now() - 60_000,
      isActive: false,
    });
    return ids;
  });

  const result = await t.mutation(
    internal.adminMigration.relinkDuplicateInstructorEmail,
    {
      canonicalInstructorId: ids.canonicalInstructorId,
      duplicateInstructorId: ids.stubInstructorId,
      liveClerkUserId: LIVE_CLERK,
      staleClerkUserId: CANONICAL_CLERK,
      staleUserId: ids.staleUserId,
    } as any,
  );

  // canonical + users + 2 uploads/assignment moves + clear link (no soft-delete)
  expect((result as any).appliedCount).toBe(5);
  await t.run(async (ctx) => {
    const stub = await ctx.db.get(ids.stubInstructorId);
    expect(stub?.deletedAt).toBeDefined();
    expect(stub?.userId).toBeUndefined();
  });
});

test("relinkDuplicateInstructorEmail: refuses when the duplicate owns records", async () => {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const ids = await seedDuplicateEmailFixture(ctx);
    await ctx.db.insert("workspaces", {
      name: "stub-owned workspace",
      ownerId: "user_student_1",
      instructorId: ids.stubInstructorId,
      isPublic: false,
      studentImageCount: 0,
      instructorImageCount: 0,
    });
    return ids;
  });

  await expect(
    t.mutation(internal.adminMigration.relinkDuplicateInstructorEmail, {
      canonicalInstructorId: ids.canonicalInstructorId,
      duplicateInstructorId: ids.stubInstructorId,
      liveClerkUserId: LIVE_CLERK,
      staleClerkUserId: CANONICAL_CLERK,
      staleUserId: ids.staleUserId,
    } as any),
  ).rejects.toThrow(/still owns records/);
});

test("relinkDuplicateInstructorEmail: refuses when the email addresses do not match", async () => {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const ids = await seedDuplicateEmailFixture(ctx);
    await ctx.db.patch(ids.stubInstructorId, { email: "someone-else@example.com" });
    return ids;
  });

  await expect(
    t.mutation(internal.adminMigration.relinkDuplicateInstructorEmail, {
      canonicalInstructorId: ids.canonicalInstructorId,
      duplicateInstructorId: ids.stubInstructorId,
      liveClerkUserId: LIVE_CLERK,
      staleClerkUserId: CANONICAL_CLERK,
      staleUserId: ids.staleUserId,
    } as any),
  ).rejects.toThrow(/emails must match/);
});
