/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

/**
 * Test fixture helpers — keep each test focused on its assertion and
 * delegate the boilerplate (insert instructor / student / user rows,
 * seed a workspace) to these builders. Mirrors the pattern used by
 * `convex/studentInvitations.test.ts` and `convex/adminWorkspaces.test.ts`.
 */

async function seedStudentInstructor(
  t: ReturnType<typeof convexTest>,
  opts: {
    studentUserId: string;
    studentEmail: string;
    instructorUserId: string;
    instructorName: string;
  }
) {
  return await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: opts.studentUserId,
      clerkId: opts.studentUserId,
      email: opts.studentEmail,
      firstName: "Test",
      lastName: "Student",
      role: "student",
    });
    const instructorId = await ctx.db.insert("instructors", {
      userId: opts.instructorUserId,
      email: "instructor@example.com",
      name: opts.instructorName,
    });
    return { instructorId };
  });
}

/**
 * Helper for tests that mirror the dashboard's "Active Mentorships"
 * path — insert an active seat reservation + a session pack
 * (consistent with `convex/seatReservations.ts:123-136`).
 */
async function seedActiveSeatAndPack(
  t: ReturnType<typeof convexTest>,
  args: { studentUserId: string; instructorId: string }
) {
  return await t.run(async (ctx) => {
    const sessionPackId = await ctx.db.insert("sessionPacks", {
      userId: args.studentUserId,
      instructorId: args.instructorId as never,
      totalSessions: 4,
      remainingSessions: 4,
      purchasedAt: Date.now(),
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
      status: "active",
    });
    const seatReservationId = await ctx.db.insert("seatReservations", {
      userId: args.studentUserId,
      instructorId: args.instructorId as never,
      sessionPackId,
      status: "active",
      seatExpiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
    });
    return { sessionPackId, seatReservationId };
  });
}

async function seedWorkspace(
  t: ReturnType<typeof convexTest>,
  opts: {
    name: string;
    ownerId: string;
    instructorId?: string;
    type?: "mentorship" | "admin_student" | "admin_instructor";
    deletedAt?: number;
    endedAt?: number;
    archivedAt?: number;
    archivedBy?: string;
    seatReservationId?: string;
  }
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("workspaces", {
      name: opts.name,
      ownerId: opts.ownerId,
      instructorId: opts.instructorId as never,
      isPublic: false,
      studentImageCount: 0,
      instructorImageCount: 0,
      type: opts.type,
      deletedAt: opts.deletedAt,
      endedAt: opts.endedAt,
      archivedAt: opts.archivedAt,
      archivedBy: opts.archivedBy,
      seatReservationId: opts.seatReservationId as never,
    });
  });
}

async function makeAdmin(t: ReturnType<typeof convexTest>, userId: string) {
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId,
      clerkId: userId,
      email: `${userId}@example.com`,
      role: "admin",
    });
  });
}

// ---------------------------------------------------------------------------
// archiveWorkspace: positive paths
// ---------------------------------------------------------------------------

test("archive as the mentorship instructor sets archivedAt + archivedBy", async () => {
  const t = convexTest({ schema, modules });
  const studentUserId = "user_student_archive_1";
  const instructorUserId = "user_instructor_archive_1";
  await seedStudentInstructor(t, {
    studentUserId,
    studentEmail: "s1@example.com",
    instructorUserId,
    instructorName: "Archive Instructor",
  });
  const { instructorId } = (await t.run(async (ctx) => {
    return { instructorId: (
      await ctx.db.query("instructors").withIndex("by_userId", (q) => q.eq("userId", instructorUserId)).first()
    )!._id };
  }));
  const workspaceId = await seedWorkspace(t, {
    name: "Active WS",
    ownerId: studentUserId,
    instructorId,
    type: "mentorship",
  });

  const result = await t
    .withIdentity({ subject: instructorUserId })
    .mutation(api.workspaces.archiveWorkspace, { id: workspaceId });

  expect(result.alreadyArchived).toBe(false);
  expect(typeof result.archivedAt).toBe("number");

  const stored = await t.run(async (ctx) => ctx.db.get(workspaceId));
  expect(stored?.archivedAt).toBe(result.archivedAt);
  expect(stored?.archivedBy).toBe(instructorUserId);
});

test("archive as the mentorship student succeeds", async () => {
  const t = convexTest({ schema, modules });
  const studentUserId = "user_student_archive_2";
  const instructorUserId = "user_instructor_archive_2";
  await seedStudentInstructor(t, {
    studentUserId,
    studentEmail: "s2@example.com",
    instructorUserId,
    instructorName: "Archive Instructor 2",
  });
  const instructorId = (
    await t.run(async (ctx) =>
      (await ctx.db.query("instructors").withIndex("by_userId", (q) =>
        q.eq("userId", instructorUserId)
      ).first())!._id
    )
  );
  const workspaceId = await seedWorkspace(t, {
    name: "Student-Archive",
    ownerId: studentUserId,
    instructorId,
    type: "mentorship",
  });

  const result = await t
    .withIdentity({ subject: studentUserId })
    .mutation(api.workspaces.archiveWorkspace, { id: workspaceId });
  expect(result.alreadyArchived).toBe(false);
});

test("archive as admin succeeds on any workspace type", async () => {
  const t = convexTest({ schema, modules });
  const adminId = "user_admin_archive_1";
  await makeAdmin(t, adminId);
  const workspaceId = await seedWorkspace(t, {
    name: "Admin-owned",
    ownerId: adminId,
    type: "admin_student",
  });
  await t
    .withIdentity({ subject: adminId })
    .mutation(api.workspaces.archiveWorkspace, { id: workspaceId });
  const stored = await t.run(async (ctx) => ctx.db.get(workspaceId));
  expect(stored?.archivedAt).toBeDefined();
  expect(stored?.archivedBy).toBe(adminId);
});

test("archive is idempotent — second call returns alreadyArchived", async () => {
  const t = convexTest({ schema, modules });
  const studentUserId = "user_student_idem";
  const instructorUserId = "user_instructor_idem";
  await seedStudentInstructor(t, {
    studentUserId,
    studentEmail: "s3@example.com",
    instructorUserId,
    instructorName: "Idem Instructor",
  });
  const instructorId = (
    await t.run(async (ctx) =>
      (await ctx.db.query("instructors").withIndex("by_userId", (q) =>
        q.eq("userId", instructorUserId)
      ).first())!._id
    )
  );
  const workspaceId = await seedWorkspace(t, {
    name: "Idem WS",
    ownerId: studentUserId,
    instructorId,
    type: "mentorship",
  });
  const first = await t
    .withIdentity({ subject: instructorUserId })
    .mutation(api.workspaces.archiveWorkspace, { id: workspaceId });
  const second = await t
    .withIdentity({ subject: instructorUserId })
    .mutation(api.workspaces.archiveWorkspace, { id: workspaceId });
  expect(first.alreadyArchived).toBe(false);
  expect(second.alreadyArchived).toBe(true);
  // archivedAt must NOT change on the second call.
  expect(second.archivedAt).toBe(first.archivedAt);
});

test("archive writes an auditLogs row", async () => {
  const t = convexTest({ schema, modules });
  const studentUserId = "user_student_audit";
  const instructorUserId = "user_instructor_audit";
  await seedStudentInstructor(t, {
    studentUserId,
    studentEmail: "s4@example.com",
    instructorUserId,
    instructorName: "Audit Instructor",
  });
  const instructorId = (
    await t.run(async (ctx) =>
      (await ctx.db.query("instructors").withIndex("by_userId", (q) =>
        q.eq("userId", instructorUserId)
      ).first())!._id
    )
  );
  const workspaceId = await seedWorkspace(t, {
    name: "Audit WS",
    ownerId: studentUserId,
    instructorId,
    type: "mentorship",
  });
  await t
    .withIdentity({ subject: instructorUserId })
    .mutation(api.workspaces.archiveWorkspace, { id: workspaceId });

  const auditRows = await t.run(async (ctx) => {
    return await ctx.db.query("auditLogs").collect();
  });
  const archiveEntry = auditRows.find(
    (r) =>
      r.targetType === "workspace" &&
      r.targetId === workspaceId &&
      r.action === "archive_workspace"
  );
  expect(archiveEntry).toBeDefined();
  expect(archiveEntry?.actorId).toBe(instructorUserId);
  expect(archiveEntry?.actorRole).toBe("instructor");
});

// ---------------------------------------------------------------------------
// archiveWorkspace: negative paths
// ---------------------------------------------------------------------------

test("archive rejects soft-deleted workspace", async () => {
  const t = convexTest({ schema, modules });
  const studentUserId = "user_student_del";
  const instructorUserId = "user_instructor_del";
  await seedStudentInstructor(t, {
    studentUserId,
    studentEmail: "s5@example.com",
    instructorUserId,
    instructorName: "Del Instructor",
  });
  const instructorId = (
    await t.run(async (ctx) =>
      (await ctx.db.query("instructors").withIndex("by_userId", (q) =>
        q.eq("userId", instructorUserId)
      ).first())!._id
    )
  );
  const workspaceId = await seedWorkspace(t, {
    name: "Deleted WS",
    ownerId: studentUserId,
    instructorId,
    type: "mentorship",
    deletedAt: Date.now(),
  });

  await expect(
    t
      .withIdentity({ subject: instructorUserId })
      .mutation(api.workspaces.archiveWorkspace, { id: workspaceId })
  ).rejects.toThrow(/deleted/i);
});

test("archive rejects ended workspace", async () => {
  const t = convexTest({ schema, modules });
  const studentUserId = "user_student_ended";
  const instructorUserId = "user_instructor_ended";
  await seedStudentInstructor(t, {
    studentUserId,
    studentEmail: "s6@example.com",
    instructorUserId,
    instructorName: "Ended Instructor",
  });
  const instructorId = (
    await t.run(async (ctx) =>
      (await ctx.db.query("instructors").withIndex("by_userId", (q) =>
        q.eq("userId", instructorUserId)
      ).first())!._id
    )
  );
  const workspaceId = await seedWorkspace(t, {
    name: "Ended WS",
    ownerId: studentUserId,
    instructorId,
    type: "mentorship",
    endedAt: Date.now() - 1000,
  });
  await expect(
    t
      .withIdentity({ subject: instructorUserId })
      .mutation(api.workspaces.archiveWorkspace, { id: workspaceId })
  ).rejects.toThrow(/ended/i);
});

test("archive rejects non-participant", async () => {
  const t = convexTest({ schema, modules });
  const studentUserId = "user_student_nonpar";
  const instructorUserId = "user_instructor_nonpar";
  await seedStudentInstructor(t, {
    studentUserId,
    studentEmail: "s7@example.com",
    instructorUserId,
    instructorName: "NonPar Instructor",
  });
  const instructorId = (
    await t.run(async (ctx) =>
      (await ctx.db.query("instructors").withIndex("by_userId", (q) =>
        q.eq("userId", instructorUserId)
      ).first())!._id
    )
  );
  const workspaceId = await seedWorkspace(t, {
    name: "NonPar WS",
    ownerId: studentUserId,
    instructorId,
    type: "mentorship",
  });

  const strangerId = "user_stranger_nonpar";
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: strangerId,
      clerkId: strangerId,
      email: "stranger@example.com",
      role: "student",
    });
  });

  await expect(
    t
      .withIdentity({ subject: strangerId })
      .mutation(api.workspaces.archiveWorkspace, { id: workspaceId })
  ).rejects.toThrow(/Not authorized/i);
});

test("archive rejects student on admin_student workspace", async () => {
  const t = convexTest({ schema, modules });
  const adminId = "user_admin_astudent";
  const studentId = "user_student_astudent";
  await makeAdmin(t, adminId);
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: studentId,
      clerkId: studentId,
      email: "sa@example.com",
      role: "student",
    });
  });
  const workspaceId = await seedWorkspace(t, {
    name: "AdminStudent WS",
    ownerId: studentId,
    type: "admin_student",
  });
  // The student is the ownerId, so they pass the role-gate check
  // (`workspace.type === "admin_student"` && `workspace.ownerId === userId`
  // returns "student" role from getWorkspaceRole). But the archive gate
  // for `admin_student` types is admin-only.
  await expect(
    t
      .withIdentity({ subject: studentId })
      .mutation(api.workspaces.archiveWorkspace, { id: workspaceId })
  ).rejects.toThrow(/Not authorized to archive/i);
});

test("archive rejects instructor on admin_student workspace", async () => {
  const t = convexTest({ schema, modules });
  const adminId = "user_admin_astudent_2";
  const instructorUserId = "user_instructor_astudent_2";
  await makeAdmin(t, adminId);
  await t.run(async (ctx) => {
    await ctx.db.insert("instructors", {
      userId: instructorUserId,
      email: "i2@example.com",
      name: "I",
    });
  });
  const workspaceId = await seedWorkspace(t, {
    name: "AdminStudent WS2",
    ownerId: instructorUserId,
    type: "admin_student",
  });
  await expect(
    t
      .withIdentity({ subject: instructorUserId })
      .mutation(api.workspaces.archiveWorkspace, { id: workspaceId })
  ).rejects.toThrow(/Not authorized/i);
});

// ---------------------------------------------------------------------------
// unarchiveWorkspace
// ---------------------------------------------------------------------------

test("unarchive clears archivedAt + archivedBy", async () => {
  const t = convexTest({ schema, modules });
  const studentUserId = "user_student_un";
  const instructorUserId = "user_instructor_un";
  await seedStudentInstructor(t, {
    studentUserId,
    studentEmail: "s8@example.com",
    instructorUserId,
    instructorName: "Un Instructor",
  });
  const instructorId = (
    await t.run(async (ctx) =>
      (await ctx.db.query("instructors").withIndex("by_userId", (q) =>
        q.eq("userId", instructorUserId)
      ).first())!._id
    )
  );
  const workspaceId = await seedWorkspace(t, {
    name: "Un WS",
    ownerId: studentUserId,
    instructorId,
    type: "mentorship",
    archivedAt: Date.now(),
    archivedBy: instructorUserId,
  });

  const result = await t
    .withIdentity({ subject: instructorUserId })
    .mutation(api.workspaces.unarchiveWorkspace, { id: workspaceId });
  expect(result.alreadyActive).toBe(false);
  const stored = await t.run(async (ctx) => ctx.db.get(workspaceId));
  expect(stored?.archivedAt).toBeUndefined();
  expect(stored?.archivedBy).toBeUndefined();
});

test("unarchive is idempotent", async () => {
  const t = convexTest({ schema, modules });
  const studentUserId = "user_student_un_idem";
  const instructorUserId = "user_instructor_un_idem";
  await seedStudentInstructor(t, {
    studentUserId,
    studentEmail: "s9@example.com",
    instructorUserId,
    instructorName: "UnIdem Instructor",
  });
  const instructorId = (
    await t.run(async (ctx) =>
      (await ctx.db.query("instructors").withIndex("by_userId", (q) =>
        q.eq("userId", instructorUserId)
      ).first())!._id
    )
  );
  const workspaceId = await seedWorkspace(t, {
    name: "UnIdem WS",
    ownerId: studentUserId,
    instructorId,
    type: "mentorship",
  });
  const result = await t
    .withIdentity({ subject: instructorUserId })
    .mutation(api.workspaces.unarchiveWorkspace, { id: workspaceId });
  expect(result.alreadyActive).toBe(true);
});

// ---------------------------------------------------------------------------
// getUserWorkspaces + getInstructorArchivedMentorships
// ---------------------------------------------------------------------------

test("getUserWorkspaces excludes archived by default", async () => {
  const t = convexTest({ schema, modules });
  const studentUserId = "user_student_q_default";
  const instructorUserId = "user_instructor_q_default";
  await seedStudentInstructor(t, {
    studentUserId,
    studentEmail: "sq@example.com",
    instructorUserId,
    instructorName: "Q Instructor",
  });
  const instructorId = (
    await t.run(async (ctx) =>
      (await ctx.db.query("instructors").withIndex("by_userId", (q) =>
        q.eq("userId", instructorUserId)
      ).first())!._id
    )
  );
  await seedWorkspace(t, {
    name: "Active Q",
    ownerId: studentUserId,
    instructorId,
    type: "mentorship",
  });
  await seedWorkspace(t, {
    name: "Archived Q",
    ownerId: studentUserId,
    instructorId,
    type: "mentorship",
    archivedAt: Date.now(),
    archivedBy: instructorUserId,
  });

  const defaultList = await t
    .withIdentity({ subject: studentUserId })
    .query(api.workspaces.getUserWorkspaces, { ownerId: studentUserId });
  const optIn = await t
    .withIdentity({ subject: studentUserId })
    .query(api.workspaces.getUserWorkspaces, {
      ownerId: studentUserId,
      includeArchived: true,
    });

  expect(defaultList.map((w) => w.name)).toEqual(["Active Q"]);
  expect(optIn.map((w) => w.name).sort()).toEqual(["Active Q", "Archived Q"]);
});

test("getInstructorArchivedMentorships joins student profile and orders newest-first", async () => {
  const t = convexTest({ schema, modules });
  const studentUserId = "user_student_archived_card";
  const studentSecondId = "user_student_archived_card_b";
  const instructorUserId = "user_instructor_archived_card";
  await seedStudentInstructor(t, {
    studentUserId,
    studentEmail: "card-a@example.com",
    instructorUserId,
    instructorName: "Card Instructor",
  });
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: studentSecondId,
      clerkId: studentSecondId,
      email: "card-b@example.com",
      firstName: "Bea",
      lastName: "Second",
      role: "student",
    });
  });
  const instructorId = (
    await t.run(async (ctx) =>
      (await ctx.db.query("instructors").withIndex("by_userId", (q) =>
        q.eq("userId", instructorUserId)
      ).first())!._id
    )
  );
  const olderArchived = Date.now() - 60_000;
  await seedWorkspace(t, {
    name: "Older Archive",
    ownerId: studentUserId,
    instructorId,
    type: "mentorship",
    archivedAt: olderArchived,
    archivedBy: instructorUserId,
  });
  const newerArchived = Date.now();
  await seedWorkspace(t, {
    name: "Newer Archive",
    ownerId: studentSecondId,
    instructorId,
    type: "mentorship",
    archivedAt: newerArchived,
    archivedBy: instructorUserId,
  });
  // Active workspace should NOT appear.
  await seedWorkspace(t, {
    name: "Active WS",
    ownerId: studentUserId,
    instructorId,
    type: "mentorship",
  });
  // admin_student archived workspace should NOT appear (wrong type).
  const adminOwned = "user_admin_owned";
  await makeAdmin(t, adminOwned);
  await seedWorkspace(t, {
    name: "Admin archive",
    ownerId: adminOwned,
    type: "admin_student",
    archivedAt: Date.now(),
    archivedBy: adminOwned,
  });

  const list = await t
    .withIdentity({ subject: instructorUserId })
    .query(api.workspaces.getInstructorArchivedMentorships, { instructorId });

  expect(list.map((w) => w.workspaceName)).toEqual([
    "Newer Archive",
    "Older Archive",
  ]);
  // The "Newer Archive" row joins the second student's profile.
  const newer = list.find((w) => w.workspaceName === "Newer Archive")!;
  expect(newer.studentEmail).toBe("card-b@example.com");
  expect(newer.studentFirstName).toBe("Bea");
  expect(newer.studentLastName).toBe("Second");
  expect(newer.archivedBy).toBe(instructorUserId);

  // The active workspace must NOT be in the list, and the admin_student
  // archive must NOT be either.
  expect(list.find((w) => w.workspaceName === "Active WS")).toBeUndefined();
  expect(list.find((w) => w.workspaceName === "Admin archive")).toBeUndefined();
});

test("getInstructorArchivedMentorships returns [] to a different instructor", async () => {
  const t = convexTest({ schema, modules });
  const studentUserId = "user_student_cross";
  const instructorOne = "user_instructor_cross_one";
  const instructorTwo = "user_instructor_cross_two";
  for (const i of [instructorOne, instructorTwo]) {
    await t.run(async (ctx) => {
      await ctx.db.insert("instructors", {
        userId: i,
        email: `${i}@example.com`,
        name: i,
      });
    });
  }
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: studentUserId,
      clerkId: studentUserId,
      email: "cross@example.com",
      role: "student",
    });
  });
  const instructorId1 = (
    await t.run(async (ctx) =>
      (await ctx.db.query("instructors").withIndex("by_userId", (q) =>
        q.eq("userId", instructorOne)
      ).first())!._id
    )
  );
  await seedWorkspace(t, {
    name: "Cross WS",
    ownerId: studentUserId,
    instructorId: instructorId1,
    type: "mentorship",
    archivedAt: Date.now(),
    archivedBy: instructorOne,
  });

  const list = await t
    .withIdentity({ subject: instructorTwo })
    .query(api.workspaces.getInstructorArchivedMentorships, {
      instructorId: instructorId1,
    });
  expect(list).toEqual([]);
});

// ---------------------------------------------------------------------------
// resolveActiveWorkspaceForPair — excludes archived
// ---------------------------------------------------------------------------

test("resolveActiveWorkspaceForPair returns null for an archived workspace", async () => {
  const t = convexTest({ schema, modules });
  const studentUserId = "user_student_pair_archive";
  const instructorUserId = "user_instructor_pair_archive";
  await seedStudentInstructor(t, {
    studentUserId,
    studentEmail: "pair@example.com",
    instructorUserId,
    instructorName: "Pair Instructor",
  });
  const instructorId = (
    await t.run(async (ctx) =>
      (await ctx.db.query("instructors").withIndex("by_userId", (q) =>
        q.eq("userId", instructorUserId)
      ).first())!._id
    )
  );
  const archivedWorkspaceId = await seedWorkspace(t, {
    name: "Pair-Archived",
    ownerId: studentUserId,
    instructorId,
    type: "mentorship",
    archivedAt: Date.now(),
    archivedBy: instructorUserId,
  });
  const activeWorkspaceId = await seedWorkspace(t, {
    name: "Pair-Active",
    ownerId: studentUserId,
    instructorId,
    type: "mentorship",
  });

  const resolvedArchived = await t
    .withIdentity({ subject: instructorUserId })
    .query(api.seatReservations.getInstructorStudentsWithRemainingSessions, {
      instructorId: instructorId as never,
      limit: 10,
    });
  // The archived workspace must NOT contribute a `workspaceId` to
  // either row. Only the active workspace should produce one.
  expect(resolvedArchived).toHaveLength(1);
  expect(resolvedArchived[0].workspaceId).toBe(activeWorkspaceId);
  expect(resolvedArchived[0].workspaceId).not.toBe(archivedWorkspaceId);
});

// ---------------------------------------------------------------------------
// Internal variants — for trusted callers (cron, migrations).
// ---------------------------------------------------------------------------

test("archiveWorkspaceInternal stamps archivedBy = system", async () => {
  const t = convexTest({ schema, modules });
  const workspaceId = await seedWorkspace(t, {
    name: "Internal WS",
    ownerId: "user_owner_internal",
    type: "mentorship",
  });

  await t.mutation(internal.workspaces.archiveWorkspaceInternal, {
    id: workspaceId,
  });
  const stored = await t.run(async (ctx) => ctx.db.get(workspaceId));
  expect(stored?.archivedAt).toBeDefined();
  expect(stored?.archivedBy).toBe("system");
});

test("getInstructorArchivedMentorshipsInternal returns rows to admin context", async () => {
  const t = convexTest({ schema, modules });
  const studentUserId = "user_student_internal_card";
  const instructorUserId = "user_instructor_internal_card";
  await seedStudentInstructor(t, {
    studentUserId,
    studentEmail: "int@example.com",
    instructorUserId,
    instructorName: "Internal Instructor",
  });
  const instructorId = (
    await t.run(async (ctx) =>
      (await ctx.db.query("instructors").withIndex("by_userId", (q) =>
        q.eq("userId", instructorUserId)
      ).first())!._id
    )
  );
  await seedWorkspace(t, {
    name: "Internal Card",
    ownerId: studentUserId,
    instructorId,
    type: "mentorship",
    archivedAt: Date.now(),
    archivedBy: instructorUserId,
  });

  const list = await t.query(
    internal.workspaces.getInstructorArchivedMentorshipsInternal,
    { instructorId }
  );
  expect(list).toHaveLength(1);
  expect(list[0].workspaceName).toBe("Internal Card");
  expect(list[0].archivedBy).toBe(instructorUserId);
});

// Greptile P2 #6 — legacy rows with `type` unset must appear in the
// Archived Mentorships card too (strict `eq("mentorship")` would
// silently drop them).
test("getInstructorArchivedMentorships includes legacy rows with no type", async () => {
  const t = convexTest({ schema, modules });
  const studentUserId = "user_student_legacy_type";
  const instructorUserId = "user_instructor_legacy_type";
  await seedStudentInstructor(t, {
    studentUserId,
    studentEmail: "legacy@example.com",
    instructorUserId,
    instructorName: "Legacy Instructor",
  });
  const instructorId = (
    await t.run(async (ctx) =>
      (await ctx.db.query("instructors").withIndex("by_userId", (q) =>
        q.eq("userId", instructorUserId)
      ).first())!._id
    )
  );
  // Note: no `type` set — represents a pre-`type`-field workspace.
  await seedWorkspace(t, {
    name: "Legacy Archived",
    ownerId: studentUserId,
    instructorId,
    archivedAt: Date.now(),
    archivedBy: instructorUserId,
  });

  const list = await t
    .withIdentity({ subject: instructorUserId })
    .query(api.workspaces.getInstructorArchivedMentorships, { instructorId });
  expect(list).toHaveLength(1);
  expect(list[0].workspaceName).toBe("Legacy Archived");
});

// Greptile P2 #7 — soft-deleted rows must not appear in the Archived
// Mentorships card (their Open link would redirect away).
test("getInstructorArchivedMentorships excludes soft-deleted rows", async () => {
  const t = convexTest({ schema, modules });
  const studentUserId = "user_student_deleted_archive";
  const instructorUserId = "user_instructor_deleted_archive";
  await seedStudentInstructor(t, {
    studentUserId,
    studentEmail: "deleted@example.com",
    instructorUserId,
    instructorName: "Deleted Instructor",
  });
  const instructorId = (
    await t.run(async (ctx) =>
      (await ctx.db.query("instructors").withIndex("by_userId", (q) =>
        q.eq("userId", instructorUserId)
      ).first())!._id
    )
  );
  await seedWorkspace(t, {
    name: "Deleted Archived",
    ownerId: studentUserId,
    instructorId,
    type: "mentorship",
    archivedAt: Date.now(),
    archivedBy: instructorUserId,
    deletedAt: Date.now(),
  });

  const list = await t
    .withIdentity({ subject: instructorUserId })
    .query(api.workspaces.getInstructorArchivedMentorships, { instructorId });
  expect(list).toHaveLength(0);
});

// Greptile P1 #1 — when a student's ONLY seat-eligible workspace
// pair is archived, the student must NOT appear in
// getInstructorStudentsWithRemainingSessions (i.e., the active list).
test("getInstructorStudentsWithRemainingSessions drops archive-only students", async () => {
  const t = convexTest({ schema, modules });
  const studentUserId = "user_student_archive_only";
  const instructorUserId = "user_instructor_archive_only";
  await seedStudentInstructor(t, {
    studentUserId,
    studentEmail: "archive-only@example.com",
    instructorUserId,
    instructorName: "Archive-Only Instructor",
  });
  const instructorId = (
    await t.run(async (ctx) =>
      (await ctx.db.query("instructors").withIndex("by_userId", (q) =>
        q.eq("userId", instructorUserId)
      ).first())!._id
    )
  );
  // Insert a session pack + active seat reservation so the row WOULD
  // show up on the active list, BUT pair it with no workspace so the
  // student is genuinely active (no pair, no archive conflict).
  await seedActiveSeatAndPack(t, {
    studentUserId,
    instructorId,
  });
  // Sanity check: no pair, the row IS active.
  const activeRows = await t
    .withIdentity({ subject: instructorUserId })
    .query(api.seatReservations.getInstructorStudentsWithRemainingSessions, {
      instructorId: instructorId as never,
      limit: 10,
    });
  expect(activeRows).toHaveLength(1);
  expect(activeRows[0].workspaceId).toBeNull();

  // Now archive the workspace pair for this student and verify the
  // student drops out of the active list (since they have only
  // an archived pair with this instructor).
  await seedWorkspace(t, {
    name: "Archived Pair",
    ownerId: studentUserId,
    instructorId,
    type: "mentorship",
    archivedAt: Date.now(),
    archivedBy: instructorUserId,
  });
  const afterRows = await t
    .withIdentity({ subject: instructorUserId })
    .query(api.seatReservations.getInstructorStudentsWithRemainingSessions, {
      instructorId: instructorId as never,
      limit: 10,
    });
  expect(afterRows).toHaveLength(0);
});

// Greptile P1 #3 — pack-backed session creation rejects archived
// workspaces via `resolveWorkspaceForNewSession`'s
// `archivedAt === undefined` gate. Without the gate a fresh
// session would write `workspaceId: archivedWs._id` into
// `sessions`, which then resolves through the read path that
// excludes archive (so the live workspace still sees the active
// chat) but the booking system has a row pointing at a hidden
// archive — exactly the "silent double-list" failure mode.
test("createSession rejects when only workspace pair is archived", async () => {
  const t = convexTest({ schema, modules });
  const studentUserId = "user_student_archive_booking";
  const instructorUserId = "user_instructor_archive_booking";
  await seedStudentInstructor(t, {
    studentUserId,
    studentEmail: "booking@example.com",
    instructorUserId,
    instructorName: "Booking Instructor",
  });
  const instructorId = (
    await t.run(async (ctx) =>
      (await ctx.db.query("instructors").withIndex("by_userId", (q) =>
        q.eq("userId", instructorUserId)
      ).first())!._id
    )
  );
  const { sessionPackId, seatReservationId } = await seedActiveSeatAndPack(t, {
    studentUserId,
    instructorId,
  });
  // Pre-archive pairing: workspace exists, active, points at the seat.
  const activeWsId = await seedWorkspace(t, {
    name: "Booking Active",
    ownerId: studentUserId,
    instructorId,
    type: "mentorship",
    seatReservationId,
  });
  // Sanity: createSession succeeds while the workspace is active.
  const created = await t
    .withIdentity({ subject: instructorUserId })
    .mutation(api.sessions.createSession, {
      instructorId: instructorId as never,
      studentId: studentUserId,
      sessionPackId,
      scheduledAt: Date.now() + 60_000,
    });
  expect(created).toBeDefined();

  // Patch the workspace to archive. Subsequent createSession calls
  // (using a fresh sessionPack — we used the original above) must
  // throw because `resolveWorkspaceForNewSession` returns null.
  await t.run(async (ctx) => {
    await ctx.db.patch(activeWsId, {
      archivedAt: Date.now(),
      archivedBy: instructorUserId,
    });
  });
  const newPack = await seedActiveSeatAndPack(t, {
    studentUserId,
    instructorId,
  });
  await expect(
    t
      .withIdentity({ subject: instructorUserId })
      .mutation(api.sessions.createSession, {
        instructorId: instructorId as never,
        studentId: studentUserId,
        sessionPackId: newPack.sessionPackId as never,
        scheduledAt: Date.now() + 60_000,
      })
  ).rejects.toThrow(/No active workspace/i);
});

// Greptile Round-2 #2 — explicitly exercise the pack-lookup path in
// `resolveWorkspaceForNewSession`. The test above only proves
// the pair-lookup predicate works; if the pack-lookup regresses,
// this assertion would still pass. Link the pack to the
// archived workspace via `seatReservationId` so the pack path
// resolves the (now-archived) workspace and rejects.
test("createSession via pack-lookup rejects when workspace is archived", async () => {
  const t = convexTest({ schema, modules });
  const studentUserId = "user_student_pack_lookup";
  const instructorUserId = "user_instructor_pack_lookup";
  await seedStudentInstructor(t, {
    studentUserId,
    studentEmail: "pack-lookup@example.com",
    instructorUserId,
    instructorName: "Pack Lookup Instructor",
  });
  const instructorId = (
    await t.run(async (ctx) =>
      (await ctx.db.query("instructors").withIndex("by_userId", (q) =>
        q.eq("userId", instructorUserId)
      ).first())!._id
    )
  );
  const { sessionPackId, seatReservationId } = await seedActiveSeatAndPack(t, {
    studentUserId,
    instructorId,
  });
  // Workspace is paired with the seat so the pack-lookup path resolves
  // this exact workspace when `createSession` runs.
  await seedWorkspace(t, {
    name: "Pack-Lookup Archived",
    ownerId: studentUserId,
    instructorId,
    type: "mentorship",
    seatReservationId,
    archivedAt: Date.now(),
    archivedBy: instructorUserId,
  });

  await expect(
    t
      .withIdentity({ subject: instructorUserId })
      .mutation(api.sessions.createSession, {
        instructorId: instructorId as never,
        studentId: studentUserId,
        sessionPackId: sessionPackId as never,
        scheduledAt: Date.now() + 60_000,
      })
  ).rejects.toThrow(/No active workspace/i);
});

// Greptile Round-3 #3 — when a student has BOTH an active and an archived
// workspace for the same instructor, `resolveWorkspaceForNewSession`'s
// pair lookup must NOT include the archived pair in the count check.
// Before the round-3 fix the pair lookup applied
// `by_instructorId_and_ownerId_and_type_and_endedAt_and_deletedAt`
// .take(2) — both rows matched, `length === 2`, the function rejected.
// After: the pair lookup adds `.filter(archivedAt === undefined)` and
// then `.take(2)`, so the count drops back to the active one and
// `createSession` succeeds.
test("createSession succeeds when student has 1 active + 1 archived pair", async () => {
  const t = convexTest({ schema, modules });
  const studentUserId = "user_student_archive_plus_active";
  const instructorUserId = "user_instructor_archive_plus_active";
  await seedStudentInstructor(t, {
    studentUserId,
    studentEmail: "archive-plus-active@example.com",
    instructorUserId,
    instructorName: "Archive+Active Instructor",
  });
  const instructorId = (
    await t.run(async (ctx) =>
      (await ctx.db.query("instructors").withIndex("by_userId", (q) =>
        q.eq("userId", instructorUserId)
      ).first())!._id
    )
  );
  // Insert an old archived pair first.
  await seedWorkspace(t, {
    name: "Old Archive",
    ownerId: studentUserId,
    instructorId,
    type: "mentorship",
    archivedAt: Date.now() - 60 * 24 * 60 * 60 * 1000,
    archivedBy: instructorUserId,
  });
  // Insert a fresh active pair.
  const activePairId = await seedWorkspace(t, {
    name: "Newly Active",
    ownerId: studentUserId,
    instructorId,
    type: "mentorship",
  });

  // Now a fresh session pack + seat with no workspace link — the
  // pack-lookup returns null, forcing the function through the
  // pair-lookup branch.
  const { sessionPackId } = await seedActiveSeatAndPack(t, {
    studentUserId,
    instructorId,
  });

  // Before round-3 this would reject ("No active workspace"). The
  // filtered pair-lookup returns the active pair, so createSession
  // succeeds and the session's workspaceId points at the active one.
  const created = await t
    .withIdentity({ subject: instructorUserId })
    .mutation(api.sessions.createSession, {
      instructorId: instructorId as never,
      studentId: studentUserId,
      sessionPackId: sessionPackId as never,
      scheduledAt: Date.now() + 60_000,
    });
  expect(created).toBeDefined();
  // `createSession` returns the inserted sessions row's `_id`
  // directly, not the `{ sessionId }` wrapper some other mutations
  // use. Verify the new session actually points at the active
  // pair (and not the archived one).
  const newSession = await t.run(
    async (ctx) => await ctx.db.get(created as never)
  );
  expect(newSession?.workspaceId).toBe(activePairId);
});

// Greptile Round-3 #2 — `startAdhocCall` rejects archived workspaces on
// the backend. Mirror the gate in `convex/sessions.ts:3000-3010` so a
// raw `startAdhocCall` from the client cannot bypass the
// `assertCanToggleArchive` archive UI by going through the ad-hoc
// call surface directly.
test("startAdhocCall rejects when workspace is archived", async () => {
  const t = convexTest({ schema, modules });
  const studentUserId = "user_student_archive_adhoc";
  const instructorUserId = "user_instructor_archive_adhoc";
  await seedStudentInstructor(t, {
    studentUserId,
    studentEmail: "adhoc@example.com",
    instructorUserId,
    instructorName: "Adhoc Instructor",
  });
  const instructorId = (
    await t.run(async (ctx) =>
      (await ctx.db.query("instructors").withIndex("by_userId", (q) =>
        q.eq("userId", instructorUserId)
      ).first())!._id
    )
  );
  const archivedWsId = await seedWorkspace(t, {
    name: "Archived Adhoc",
    ownerId: studentUserId,
    instructorId,
    type: "mentorship",
    archivedAt: Date.now(),
    archivedBy: instructorUserId,
  });
  await expect(
    t
      .withIdentity({ subject: instructorUserId })
      .mutation(api.sessions.startAdhocCall, {
        workspaceId: archivedWsId,
        recordingConsent: true,
      })
  ).rejects.toThrow(/ended, deleted, or archived/i);
});
