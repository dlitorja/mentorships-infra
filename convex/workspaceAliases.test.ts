/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

interface AliasWorkspaceFixture {
  workspaceId: string;
  instructorRowId: string;
  studentUserId: string;
  instructorUserId: string;
}

async function seedAliasWorkspace(
  t: ReturnType<typeof convexTest>
): Promise<AliasWorkspaceFixture> {
  let workspaceId = "";
  let instructorRowId = "";
  const studentUserId = "user_alias_student";
  const instructorUserId = "user_alias_instructor";

  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: studentUserId,
      clerkId: studentUserId,
      email: "student-alias@example.com",
      role: "student",
    });
    await ctx.db.insert("users", {
      userId: instructorUserId,
      clerkId: instructorUserId,
      email: "instructor-alias@example.com",
      role: "instructor",
    });
    instructorRowId = await ctx.db.insert("instructors", {
      userId: instructorUserId,
      email: "instructor-alias@example.com",
      name: "Alias Instructor",
      isActive: true,
      isNew: false,
      oneOnOneInventory: 0,
      groupInventory: 0,
      maxActiveStudents: 10,
    });
    workspaceId = await ctx.db.insert("workspaces", {
      name: "Default Workspace Name",
      ownerId: studentUserId,
      instructorId: instructorRowId,
      isPublic: false,
      studentImageCount: 0,
      instructorImageCount: 0,
    });
  });

  return { workspaceId, instructorRowId, studentUserId, instructorUserId };
}

test("setWorkspaceAlias: student upserts an alias for their workspace", async () => {
  const t = convexTest(schema, modules);
  const { workspaceId, studentUserId } = await seedAliasWorkspace(t);

  const student = t.withIdentity({ subject: studentUserId });
  const result = await student.mutation(api.workspaces.setWorkspaceAlias, {
    workspaceId,
    alias: "  Math Mentor  ",
  });
  expect(result.cleared).toBe(false);
  expect(result.alias).toBe("Math Mentor");

  const rows = await t.run(async (ctx) => ctx.db.query("workspaceAliases").collect());
  expect(rows.length).toBe(1);
  expect(rows[0].workspaceId).toBe(workspaceId);
  expect(rows[0].userId).toBe(studentUserId);
  expect(rows[0].alias).toBe("Math Mentor");
});

test("setWorkspaceAlias: instructor upserts an alias for their workspace", async () => {
  const t = convexTest(schema, modules);
  const { workspaceId, instructorUserId } = await seedAliasWorkspace(t);

  const instructor = t.withIdentity({ subject: instructorUserId });
  const result = await instructor.mutation(api.workspaces.setWorkspaceAlias, {
    workspaceId,
    alias: "Week 3 Cohort",
  });
  expect(result.cleared).toBe(false);
  expect(result.alias).toBe("Week 3 Cohort");

  const rows = await t.run(async (ctx) => ctx.db.query("workspaceAliases").collect());
  expect(rows.length).toBe(1);
  expect(rows[0].userId).toBe(instructorUserId);
});

test("setWorkspaceAlias: empty string clears the alias row", async () => {
  const t = convexTest(schema, modules);
  const { workspaceId, studentUserId } = await seedAliasWorkspace(t);

  const student = t.withIdentity({ subject: studentUserId });
  await student.mutation(api.workspaces.setWorkspaceAlias, {
    workspaceId,
    alias: "Math Mentor",
  });
  const before = await t.run(async (ctx) => ctx.db.query("workspaceAliases").collect());
  expect(before.length).toBe(1);

  const result = await student.mutation(api.workspaces.setWorkspaceAlias, {
    workspaceId,
    alias: "   ",
  });
  expect(result.cleared).toBe(true);
  expect(result.alias).toBe("");

  const after = await t.run(async (ctx) => ctx.db.query("workspaceAliases").collect());
  expect(after.length).toBe(0);
});

test("setWorkspaceAlias: whitespace-only update on an already-cleared alias is a no-op", async () => {
  const t = convexTest(schema, modules);
  const { workspaceId, studentUserId } = await seedAliasWorkspace(t);

  const student = t.withIdentity({ subject: studentUserId });
  const result = await student.mutation(api.workspaces.setWorkspaceAlias, {
    workspaceId,
    alias: "",
  });
  expect(result.cleared).toBe(true);
  expect(result.alias).toBe("");

  const rows = await t.run(async (ctx) => ctx.db.query("workspaceAliases").collect());
  expect(rows.length).toBe(0);
});

test("setWorkspaceAlias: rejects alias longer than 120 characters", async () => {
  const t = convexTest(schema, modules);
  const { workspaceId, studentUserId } = await seedAliasWorkspace(t);

  const student = t.withIdentity({ subject: studentUserId });
  await expect(
    student.mutation(api.workspaces.setWorkspaceAlias, {
      workspaceId,
      alias: "x".repeat(121),
    })
  ).rejects.toThrow(/120 characters or fewer/);
});

test("setWorkspaceAlias: rejects unauthenticated callers", async () => {
  const t = convexTest(schema, modules);
  const { workspaceId } = await seedAliasWorkspace(t);

  await expect(
    t.mutation(api.workspaces.setWorkspaceAlias, {
      workspaceId,
      alias: "Anon",
    })
  ).rejects.toThrow(/Unauthorized/);
});

test("setWorkspaceAlias: rejects users not on the workspace", async () => {
  const t = convexTest(schema, modules);
  const { workspaceId } = await seedAliasWorkspace(t);

  const stranger = t.withIdentity({ subject: "user_random_stranger_alias" });
  await expect(
    stranger.mutation(api.workspaces.setWorkspaceAlias, {
      workspaceId,
      alias: "Pwned",
    })
  ).rejects.toThrow(/Not authorized to rename this workspace/);
});

test("setWorkspaceAlias: two participants get distinct aliases and neither sees the other", async () => {
  const t = convexTest(schema, modules);
  const { workspaceId, studentUserId, instructorUserId } = await seedAliasWorkspace(t);

  const student = t.withIdentity({ subject: studentUserId });
  const instructor = t.withIdentity({ subject: instructorUserId });

  await student.mutation(api.workspaces.setWorkspaceAlias, {
    workspaceId,
    alias: "Student Private Name",
  });
  await instructor.mutation(api.workspaces.setWorkspaceAlias, {
    workspaceId,
    alias: "Instructor Private Name",
  });

  // Student sees the student's alias.
  const studentView = await student.query(api.workspaces.getWorkspaceById, {
    id: workspaceId as any,
  });
  expect(studentView?.displayName).toBe("Student Private Name");
  expect(studentView?.name).toBe("Default Workspace Name");

  // Instructor sees the instructor's alias.
  const instructorView = await instructor.query(api.workspaces.getWorkspaceById, {
    id: workspaceId as any,
  });
  expect(instructorView?.displayName).toBe("Instructor Private Name");
  expect(instructorView?.name).toBe("Default Workspace Name");
});

test("getWorkspaceById: displayName falls back to workspace name when no alias is set", async () => {
  const t = convexTest(schema, modules);
  const { workspaceId, studentUserId } = await seedAliasWorkspace(t);

  const student = t.withIdentity({ subject: studentUserId });
  const view = await student.query(api.workspaces.getWorkspaceById, {
    id: workspaceId as any,
  });
  expect(view?.displayName).toBe("Default Workspace Name");
  expect(view?.name).toBe("Default Workspace Name");
});

test("getUserWorkspaces: each row carries the caller's displayName alias", async () => {
  const t = convexTest(schema, modules);
  const { workspaceId, studentUserId, instructorUserId } = await seedAliasWorkspace(t);

  const student = t.withIdentity({ subject: studentUserId });
  await student.mutation(api.workspaces.setWorkspaceAlias, {
    workspaceId,
    alias: "Student View Name",
  });

  const instructor = t.withIdentity({ subject: instructorUserId });
  await instructor.mutation(api.workspaces.setWorkspaceAlias, {
    workspaceId,
    alias: "Instructor View Name",
  });

  const studentList = await student.query(api.workspaces.getUserWorkspaces, {
    ownerId: studentUserId,
  });
  expect(studentList.length).toBe(1);
  expect(studentList[0].displayName).toBe("Student View Name");
  expect(studentList[0].name).toBe("Default Workspace Name");

  const instructorList = await instructor.query(api.workspaces.getUserWorkspaces, {
    ownerId: instructorUserId,
  });
  expect(instructorList.length).toBe(1);
  expect(instructorList[0].displayName).toBe("Instructor View Name");
  expect(instructorList[0].name).toBe("Default Workspace Name");
});
