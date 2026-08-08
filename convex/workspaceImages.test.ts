/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

test("getWorkspaceImagesPaginated filters by uploader role", async () => {
  const t = convexTest({ schema, modules });
  const instructorUserId = "user_instructor_1";
  const studentUserId = "user_student_1";
  let workspaceId: string;
  let instructorImageId: string;
  let studentImageId: string;

  await t.run(async (ctx) => {
    const instructor = await ctx.db.insert("instructors", {
      userId: instructorUserId,
      name: "Instructor",
      email: "instructor@example.com",
    });
    const student = await ctx.db.insert("users", {
      userId: studentUserId,
      email: "student@example.com",
      clerkId: studentUserId,
      role: "student",
    });
    const ws = await ctx.db.insert("workspaces", {
      name: "Test Workspace",
      ownerId: studentUserId,
      instructorId: instructor,
      isPublic: false,
      studentImageCount: 2,
      instructorImageCount: 1,
    });
    workspaceId = ws;
    instructorImageId = await ctx.db.insert("workspaceImages", {
      workspaceId: ws,
      imageUrl: "https://example.com/instructor.png",
      createdBy: instructorUserId,
    });
    studentImageId = await ctx.db.insert("workspaceImages", {
      workspaceId: ws,
      imageUrl: "https://example.com/student.png",
      createdBy: studentUserId,
    });
  });

  const instructorT = t.withIdentity({ subject: instructorUserId });
  const studentT = t.withIdentity({ subject: studentUserId });

  const paginationOpts = { numItems: 10, cursor: null };

  const allForInstructor = await instructorT.query(
    api.workspaces.getWorkspaceImagesPaginated,
    {
      workspaceId: workspaceId as any,
      paginationOpts,
      uploadedBy: "all",
    }
  );
  expect(allForInstructor.page.map((i) => i._id).sort()).toEqual(
    [instructorImageId, studentImageId].sort()
  );

  const instructorOnly = await instructorT.query(
    api.workspaces.getWorkspaceImagesPaginated,
    {
      workspaceId: workspaceId as any,
      paginationOpts,
      uploadedBy: "instructor",
    }
  );
  expect(instructorOnly.page.map((i) => i._id)).toEqual([instructorImageId]);

  const studentForInstructor = await instructorT.query(
    api.workspaces.getWorkspaceImagesPaginated,
    {
      workspaceId: workspaceId as any,
      paginationOpts,
      uploadedBy: "student",
    }
  );
  expect(studentForInstructor.page.map((i) => i._id)).toEqual([studentImageId]);

  const studentOnly = await studentT.query(
    api.workspaces.getWorkspaceImagesPaginated,
    {
      workspaceId: workspaceId as any,
      paginationOpts,
      uploadedBy: "me",
    }
  );
  expect(studentOnly.page.map((i) => i._id)).toEqual([studentImageId]);
});
