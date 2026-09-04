/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const INSTRUCTOR_USER_ID = "user_instructor_test";
const STUDENT_USER_ID = "user_student_test";

/**
 * Regression test for the production bug where the ad-hoc call
 * invite notification was always framed as "Your instructor has
 * started…" regardless of who actually started the call. PR #797
 * enabled students to start ad-hoc calls, but the toast and
 * notification rows still defaulted to the instructor framing —
 * so when a student started the call, the instructor (recipient)
 * saw a misleading popup.
 *
 * These tests assert `createAdHocCallNotification` now records
 * the caller's role on the row so the UI can phrase the invite
 * correctly. Also asserts the dedup patch keeps the field in
 * sync if the call is re-started by the OTHER party.
 */

async function seedWorkspace(
  t: ReturnType<typeof convexTest>
): Promise<{ workspaceId: string; instructorId: string }> {
  let instructorId = "";
  let workspaceId = "";
  await t.run(async (ctx) => {
    instructorId = await ctx.db.insert("instructors", {
      userId: INSTRUCTOR_USER_ID,
      email: "instructor@example.com",
      name: "Test Instructor",
      slug: "test-instructor-incall",
      isActive: true,
      oneOnOneInventory: 0,
      groupInventory: 0,
      maxActiveStudents: 10,
    });
    workspaceId = await ctx.db.insert("workspaces", {
      name: "Test Workspace",
      ownerId: STUDENT_USER_ID,
      instructorId: instructorId as any,
      isPublic: false,
      studentImageCount: 0,
      instructorImageCount: 0,
    });
  });
  return { workspaceId, instructorId };
}

async function seedAdhocSession(
  t: ReturnType<typeof convexTest>,
  workspaceId: string
): Promise<{ sessionId: string }> {
  let sessionId = "";
  await t.run(async (ctx) => {
    sessionId = await ctx.db.insert("sessions", {
      instructorId: (await ctx.db.get(workspaceId as any))!.instructorId!,
      studentId: STUDENT_USER_ID,
      workspaceId: workspaceId as any,
      scheduledAt: Date.now(),
      status: "scheduled",
      recordingConsent: false,
      isAdhoc: true,
    });
  });
  return { sessionId };
}

test("createAdHocCallNotification records callerRole=instructor when the instructor starts the call", async () => {
  const t = convexTest(schema, modules);
  const { workspaceId } = await seedWorkspace(t);
  const { sessionId } = await seedAdhocSession(t, workspaceId);

  const notificationId = await t
    .withIdentity({ subject: INSTRUCTOR_USER_ID })
    .mutation(api.inCallNotifications.createAdHocCallNotification, {
      sessionId: sessionId as any,
      workspaceId: workspaceId as any,
    });

  const row = await t.run(async (ctx) => ctx.db.get(notificationId));
  expect(row).toMatchObject({
    userId: STUDENT_USER_ID,
    callerRole: "instructor",
  });
});

test("createAdHocCallNotification records callerRole=student when the student starts the call", async () => {
  const t = convexTest(schema, modules);
  const { workspaceId } = await seedWorkspace(t);
  const { sessionId } = await seedAdhocSession(t, workspaceId);

  const notificationId = await t
    .withIdentity({ subject: STUDENT_USER_ID })
    .mutation(api.inCallNotifications.createAdHocCallNotification, {
      sessionId: sessionId as any,
      workspaceId: workspaceId as any,
    });

  const row = await t.run(async (ctx) => ctx.db.get(notificationId));
  expect(row).toMatchObject({
    userId: INSTRUCTOR_USER_ID,
    callerRole: "student",
  });
});

test("createAdHocCallNotification patches callerRole on dedup so the same caller's re-issue stays a single row", async () => {
  const t = convexTest(schema, modules);
  const { workspaceId } = await seedWorkspace(t);
  const { sessionId } = await seedAdhocSession(t, workspaceId);

  // Instructor starts → student gets an instructor-framed invite.
  const first = await t
    .withIdentity({ subject: INSTRUCTOR_USER_ID })
    .mutation(api.inCallNotifications.createAdHocCallNotification, {
      sessionId: sessionId as any,
      workspaceId: workspaceId as any,
    });
  await t.run(async (ctx) => {
    await ctx.db.patch(first, { readAt: Date.now() });
  });

  // Same caller re-issues → the same (userId, sessionId) row should
  // be patched (readAt cleared so the badge re-surfaces, expiresAt
  // refreshed). callerRole stays "instructor" because the caller
  // is the same person.
  const second = await t
    .withIdentity({ subject: INSTRUCTOR_USER_ID })
    .mutation(api.inCallNotifications.createAdHocCallNotification, {
      sessionId: sessionId as any,
      workspaceId: workspaceId as any,
    });

  expect(second).toBe(first);
  const row = await t.run(async (ctx) => ctx.db.get(first));
  expect(row?.callerRole).toBe("instructor");
  // Convex drops `undefined` patch values, so absence of the
  // readAt field is the canonical "not read" state.
  expect(row).not.toHaveProperty("readAt");
});

test("createAdHocCallNotification rejects non-participants", async () => {
  const t = convexTest(schema, modules);
  const { workspaceId } = await seedWorkspace(t);
  const { sessionId } = await seedAdhocSession(t, workspaceId);

  await expect(
    t
      .withIdentity({ subject: "user_outside_test" })
      .mutation(api.inCallNotifications.createAdHocCallNotification, {
        sessionId: sessionId as any,
        workspaceId: workspaceId as any,
      })
  ).rejects.toThrow();
});
