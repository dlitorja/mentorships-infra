/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import * as sessions from "./sessions";

const modules = import.meta.glob("./**/*.ts");

const INSTRUCTOR = "user_instructor3b";
const STUDENT = "user_student3b";
const ADMIN = "user_admin3b";
const OTHER = "user_other3b";

async function seedSession(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: ADMIN,
      clerkId: ADMIN,
      email: "session-admin@example.com",
      role: "admin",
    });
    const instructorId = await ctx.db.insert("instructors", {
      userId: INSTRUCTOR,
      name: "Session Instructor",
      slug: "session-instructor",
    });
    const sessionId = await ctx.db.insert("sessions", {
      instructorId,
      studentId: STUDENT,
      scheduledAt: Date.now() + 86400000,
      status: "scheduled",
      recordingConsent: false,
    });
    return { instructorId, sessionId };
  });
}

test("session update/complete require instructor, student, or admin", async () => {
  const t = convexTest(schema, modules);
  const { sessionId } = await seedSession(t);

  await expect(
    t.mutation(api.sessions.updateSession, { id: sessionId, notes: "anon" })
  ).rejects.toThrow("Unauthorized");

  await expect(
    t
      .withIdentity({ subject: OTHER })
      .mutation(api.sessions.updateSession, { id: sessionId, notes: "other" })
  ).rejects.toThrow("Forbidden");

  await expect(
    t.mutation(api.sessions.completeSession, { id: sessionId })
  ).rejects.toThrow("Unauthorized");

  await expect(
    t
      .withIdentity({ subject: OTHER })
      .mutation(api.sessions.completeSession, { id: sessionId })
  ).rejects.toThrow("Forbidden");

  const studentUpdate = await t
    .withIdentity({ subject: STUDENT })
    .mutation(api.sessions.updateSession, { id: sessionId, notes: "student note" });
  expect(studentUpdate?.notes).toBe("student note");

  const instructorComplete = await t
    .withIdentity({ subject: INSTRUCTOR })
    .mutation(api.sessions.completeSession, { id: sessionId, notes: "done" });
  expect(instructorComplete?.status).toBe("completed");

  const adminUpdate = await t
    .withIdentity({ subject: ADMIN })
    .mutation(api.sessions.updateSession, { id: sessionId, notes: "admin note" });
  expect(adminUpdate?.notes).toBe("admin note");
});

test("deleteSession is internal-only", () => {
  const visibility = sessions.deleteSession as {
    isInternal?: boolean;
    isPublic?: boolean;
  };
  expect(visibility.isInternal).toBe(true);
  expect(visibility.isPublic).not.toBe(true);
});
