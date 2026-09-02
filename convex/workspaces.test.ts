/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

test("workspace messages and comments expose profile labels instead of user IDs", async () => {
  const t = convexTest({ schema, modules });
  const studentUserId = "user_student_label";
  const instructorUserId = "user_instructor_label";

  const { workspaceId, noteId } = await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: studentUserId,
      clerkId: studentUserId,
      email: "student@example.com",
      firstName: "Updated",
      lastName: "Student",
      role: "student",
    });
    const instructorId = await ctx.db.insert("instructors", {
      userId: instructorUserId,
      email: "instructor@example.com",
      name: "Studio Instructor",
    });
    const workspaceId = await ctx.db.insert("workspaces", {
      name: "Identity Test",
      ownerId: studentUserId,
      instructorId,
      isPublic: false,
      studentImageCount: 0,
      instructorImageCount: 0,
    });
    await ctx.db.insert("workspaceMessages", {
      workspaceId,
      userId: studentUserId,
      content: "Student message",
      type: "text",
      senderRole: "student",
    });
    await ctx.db.insert("workspaceMessages", {
      workspaceId,
      userId: instructorUserId,
      content: "Instructor message",
      type: "text",
      senderRole: "instructor",
    });
    const noteId = await ctx.db.insert("workspaceNotes", {
      workspaceId,
      title: "Test note",
      content: "",
      createdBy: instructorUserId,
      updatedAt: Date.now(),
    });
    await ctx.db.insert("workspaceNoteComments", {
      noteId,
      content: "Student comment",
      createdBy: studentUserId,
      createdAt: Date.now(),
    });
    return { workspaceId, noteId };
  });

  const student = t.withIdentity({ subject: studentUserId });
  const messages = await student.query(api.workspaces.getWorkspaceMessagesPaginated, {
    workspaceId,
    paginationOpts: { numItems: 10, cursor: null },
  });
  expect(messages.page).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ authorDisplayName: "Updated Student" }),
      expect.objectContaining({ authorDisplayName: "Studio Instructor" }),
    ])
  );
  expect(messages.page.map((message) => message.authorDisplayName)).not.toContain(studentUserId);

  const comments = await student.query(api.workspaces.getNoteComments, { noteId });
  expect(comments[0]).toMatchObject({ authorDisplayName: "Updated Student" });

  await t.mutation(internal.users.syncClerkProfile, {
    clerkUserId: studentUserId,
    email: "student@example.com",
    firstName: "Newest",
    lastName: "Name",
  });
  const updatedMessages = await student.query(api.workspaces.getWorkspaceMessagesPaginated, {
    workspaceId,
    paginationOpts: { numItems: 10, cursor: null },
  });
  expect(
    updatedMessages.page.find((message) => message.userId === studentUserId)?.authorDisplayName
  ).toBe("Newest Name");
});

test("workspace author labels fall back to roles, never stored IDs", async () => {
  const t = convexTest({ schema, modules });
  const studentUserId = "user_without_profile";
  const workspaceId = await t.run(async (ctx) => {
    const workspaceId = await ctx.db.insert("workspaces", {
      name: "Fallback Test",
      ownerId: studentUserId,
      isPublic: false,
      studentImageCount: 0,
      instructorImageCount: 0,
    });
    await ctx.db.insert("workspaceMessages", {
      workspaceId,
      userId: studentUserId,
      content: "Fallback message",
      type: "text",
      senderRole: "student",
    });
    return workspaceId;
  });

  const result = await t.withIdentity({ subject: studentUserId }).query(
    api.workspaces.getWorkspaceMessagesPaginated,
    { workspaceId, paginationOpts: { numItems: 10, cursor: null } }
  );
  expect(result.page[0].authorDisplayName).toBe("Student");
  expect(result.page[0].authorDisplayName).not.toContain("user_");
});
