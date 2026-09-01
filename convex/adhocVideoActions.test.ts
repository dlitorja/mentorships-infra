/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const INSTRUCTOR_USER_ID = "user_instructor_test";
const STUDENT_USER_ID = "user_student_test";

/**
 * Regression test for the production bug where `setVerifiedAdhocVideoRoom`
 * threw a generic `Error("DAILY_API_KEY is not configured")` when the
 * Convex deployment was missing `DAILY_API_KEY`. The generic error
 * slipped past the route's typed-ConvexError dispatch and surfaced as a
 * 500 instead of a 502.
 *
 * These tests assert the action now throws a typed ConvexError with
 * `code: "VIDEO_ROOM_VERIFICATION_FAILED"` so the route maps it to 502
 * with a meaningful message.
 */

async function seedAdhocSession(
  t: ReturnType<typeof convexTest>
): Promise<{ sessionId: string; workspaceId: string; instructorId: string }> {
  let instructorId = "";
  let workspaceId = "";
  let sessionId = "";
  await t.run(async (ctx) => {
    instructorId = await ctx.db.insert("instructors", {
      userId: INSTRUCTOR_USER_ID,
      email: "instructor@example.com",
      name: "Test Instructor",
      slug: "test-instructor-adhoc",
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
    sessionId = await ctx.db.insert("sessions", {
      instructorId: instructorId as any,
      studentId: STUDENT_USER_ID,
      scheduledAt: Date.now(),
      status: "scheduled",
      recordingConsent: false,
      isAdhoc: true,
    });
  });
  return { sessionId, workspaceId, instructorId };
}

test("setVerifiedAdhocVideoRoom throws typed ConvexError when DAILY_API_KEY is missing", async () => {
  const t = convexTest(schema, modules);
  const { sessionId } = await seedAdhocSession(t);

  const originalApiKey = process.env.DAILY_API_KEY;
  delete process.env.DAILY_API_KEY;
  try {
    await expect(
      t
        .withIdentity({ subject: INSTRUCTOR_USER_ID })
        .action(api.adhocVideoActions.setVerifiedAdhocVideoRoom, {
          sessionId: sessionId as any,
          videoRoomName: "mentorship-test",
          videoRoomUrl: "https://example.daily.co/mentorship-test",
          roomRecordingEnabled: false,
        })
    ).rejects.toMatchObject({
      data: {
        code: "VIDEO_ROOM_VERIFICATION_FAILED",
      },
    });
  } finally {
    if (originalApiKey !== undefined) {
      process.env.DAILY_API_KEY = originalApiKey;
    }
  }
});

test("setVerifiedAdhocVideoRoom throws typed ConvexError when fetch rejects (network error)", async () => {
  // Greptile P1: unguarded `fetch()` would previously bubble up a
  // generic Error and surface as 500 instead of the intended 502.
  const t = convexTest(schema, modules);
  const { sessionId } = await seedAdhocSession(t);

  const originalApiKey = process.env.DAILY_API_KEY;
  process.env.DAILY_API_KEY = "fake-key";
  try {
    await expect(
      t
        .withIdentity({ subject: INSTRUCTOR_USER_ID })
        .action(api.adhocVideoActions.setVerifiedAdhocVideoRoom, {
          sessionId: sessionId as any,
          videoRoomName: "mentorship-test",
          videoRoomUrl: "https://example.daily.co/mentorship-test",
          roomRecordingEnabled: false,
        })
    ).rejects.toMatchObject({
      data: {
        code: "VIDEO_ROOM_VERIFICATION_FAILED",
      },
    });
  } finally {
    if (originalApiKey === undefined) {
      delete process.env.DAILY_API_KEY;
    } else {
      process.env.DAILY_API_KEY = originalApiKey;
    }
  }
});
