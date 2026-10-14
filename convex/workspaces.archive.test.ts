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
