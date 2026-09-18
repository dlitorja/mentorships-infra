/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

/**
 * Tests for the X-Trigger-Callback-Secret + CONVEX_HTTP_KEY
 * verification path on the four `/recording-ready/*` HTTP
 * endpoints in `convex/http.ts`:
 *   - POST /recording-ready/enqueue
 *   - POST /recording-ready/visibility
 *   - POST /recording-ready/mark-ready-to-send
 *   - POST /recording-ready/mark-sent
 *   - POST /recording-ready/mark-failed
 *
 * Mirrors the structure of `recordingTransferHttp.test.ts`:
 * each route requires both `Authorization: Bearer …` and
 * `X-Trigger-Callback-Secret`, and 401s if either is wrong.
 * Happy path tests also assert that the underlying mutation
 * actually ran (proves the validator passes, the auth passes,
 * and the db write commits).
 */

const VALID_KEY = "test-http-key-rrn";
const VALID_CALLBACK_SECRET = "test-callback-secret-rrn-32-bytes-of-hex!";

function bearerAndCallbackHeaders(
  key: string,
  callbackSecret: string | null
): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${key}`,
    ...(callbackSecret === null
      ? {}
      : { "X-Trigger-Callback-Secret": callbackSecret }),
  };
}

async function seedFixture(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const instructorId = await ctx.db.insert("instructors", {
      userId: "user_instructor_rrn_http",
      email: "instructor-rrn-http@example.com",
      name: "Test Instructor",
      slug: "test-instructor-rrn-http",
      isActive: true,
      oneOnOneInventory: 0,
      groupInventory: 0,
      maxActiveStudents: 10,
    });
    const sessionId = await ctx.db.insert("sessions", {
      instructorId,
      studentId: "user_student_rrn_http",
      scheduledAt: Date.now() - 5_000,
      status: "completed",
      recordingConsent: true,
      callStartedAt: Date.now() - 5_000,
      recordingTransferStatus: "ready",
      recordingUrl: "recordings/test/rec.mp4",
      hasRecordingArtifact: true,
    });
    return { instructorId, sessionId, studentUserId: "user_student_rrn_http" };
  });
}

test("recording-ready enqueue: 401 without callback secret", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;
  process.env.CONVEX_TRIGGER_CALLBACK_SECRET = VALID_CALLBACK_SECRET;

  const r = await t.fetch("/recording-ready/enqueue", {
    method: "POST",
    headers: bearerAndCallbackHeaders(VALID_KEY, null),
    body: JSON.stringify({
      sessionId: "j1abc",
      recipientUserId: "user_abc",
    }),
  });
  expect(r.status).toBe(401);
});

test("recording-ready enqueue: matching secret inserts pending_visibility row", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;
  process.env.CONVEX_TRIGGER_CALLBACK_SECRET = VALID_CALLBACK_SECRET;

  const { sessionId, studentUserId } = await seedFixture(t);

  const r = await t.fetch("/recording-ready/enqueue", {
    method: "POST",
    headers: bearerAndCallbackHeaders(VALID_KEY, VALID_CALLBACK_SECRET),
    body: JSON.stringify({
      sessionId,
      recipientUserId: studentUserId,
    }),
  });
  expect(r.status).toBe(200);
  const body = await r.json();
  expect(body.created).toBe(true);
  expect(typeof body.notificationId).toBe("string");

  const row = await t.run(async (ctx) => {
    return await ctx.db.get(body.notificationId);
  });
  expect(row?.deliveryStatus).toBe("pending_visibility");
  expect(row?.sessionId).toBe(sessionId);
  expect(row?.recipientUserId).toBe(studentUserId);
});

test("recording-ready visibility: matching secret returns ok for ready session + resolved workspace", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;
  process.env.CONVEX_TRIGGER_CALLBACK_SECRET = VALID_CALLBACK_SECRET;

  const { instructorId, sessionId, studentUserId } = await seedFixture(t);
  // Workspace + link so the visibility gate resolves cleanly.
  const workspaceId = await t.run(async (ctx) => {
    const wid = await ctx.db.insert("workspaces", {
      name: "Test",
      ownerId: studentUserId,
      instructorId: instructorId as any,
      isPublic: false,
      studentImageCount: 0,
      instructorImageCount: 0,
    });
    await ctx.db.patch(sessionId, { workspaceId: wid });
    return wid;
  });

  const r = await t.fetch("/recording-ready/visibility", {
    method: "POST",
    headers: bearerAndCallbackHeaders(VALID_KEY, VALID_CALLBACK_SECRET),
    body: JSON.stringify({
      sessionId,
      recipientUserId: studentUserId,
    }),
  });
  expect(r.status).toBe(200);
  const body = await r.json();
  expect(body.visible).toBe(true);
  expect(body.reason).toBe("ok");
  expect(body.workspaceId).toBe(workspaceId);
});

test("recording-ready mark-ready-to-send: matching secret transitions row to ready_to_send", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;
  process.env.CONVEX_TRIGGER_CALLBACK_SECRET = VALID_CALLBACK_SECRET;

  const { instructorId, sessionId, studentUserId } = await seedFixture(t);
  const workspaceId = await t.run(async (ctx) => {
    const wid = await ctx.db.insert("workspaces", {
      name: "Test",
      ownerId: studentUserId,
      instructorId: instructorId as any,
      isPublic: false,
      studentImageCount: 0,
      instructorImageCount: 0,
    });
    return wid;
  });

  const enqueue = await t.mutation(
    (require("./_generated/api") as typeof import("./_generated/api")).internal
      .recordingReadyNotifications.enqueuePendingVisibility,
    { sessionId: sessionId as any, recipientUserId: studentUserId }
  );

  const r = await t.fetch("/recording-ready/mark-ready-to-send", {
    method: "POST",
    headers: bearerAndCallbackHeaders(VALID_KEY, VALID_CALLBACK_SECRET),
    body: JSON.stringify({
      notificationId: enqueue.notificationId,
      workspaceId,
    }),
  });
  expect(r.status).toBe(200);

  const row = await t.run(async (ctx) => {
    return await ctx.db.get(enqueue.notificationId);
  });
  expect(row?.deliveryStatus).toBe("ready_to_send");
  expect(row?.workspaceId).toBe(workspaceId);
});

test("recording-ready mark-failed: matching secret transitions row to failed", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;
  process.env.CONVEX_TRIGGER_CALLBACK_SECRET = VALID_CALLBACK_SECRET;

  const { sessionId, studentUserId } = await seedFixture(t);
  const enqueue = await t.mutation(
    (require("./_generated/api") as typeof import("./_generated/api")).internal
      .recordingReadyNotifications.enqueuePendingVisibility,
    { sessionId: sessionId as any, recipientUserId: studentUserId }
  );

  const r = await t.fetch("/recording-ready/mark-failed", {
    method: "POST",
    headers: bearerAndCallbackHeaders(VALID_KEY, VALID_CALLBACK_SECRET),
    body: JSON.stringify({
      notificationId: enqueue.notificationId,
      deliveryError: "test-failure",
    }),
  });
  expect(r.status).toBe(200);

  const row = await t.run(async (ctx) => {
    return await ctx.db.get(enqueue.notificationId);
  });
  expect(row?.deliveryStatus).toBe("failed");
  expect(row?.deliveryError).toBe("test-failure");
});

test("recording-ready mark-sent: matching secret transitions row to sent with providerEmailId", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;
  process.env.CONVEX_TRIGGER_CALLBACK_SECRET = VALID_CALLBACK_SECRET;

  const { instructorId, sessionId, studentUserId } = await seedFixture(t);
  const workspaceId = await t.run(async (ctx) => {
    return await ctx.db.insert("workspaces", {
      name: "Test",
      ownerId: studentUserId,
      instructorId: instructorId as any,
      isPublic: false,
      studentImageCount: 0,
      instructorImageCount: 0,
    });
  });

  const enqueue = await t.mutation(
    (require("./_generated/api") as typeof import("./_generated/api")).internal
      .recordingReadyNotifications.enqueuePendingVisibility,
    { sessionId: sessionId as any, recipientUserId: studentUserId }
  );
  // Move to ready_to_send first (markSent requires it).
  await t.mutation(
    (require("./_generated/api") as typeof import("./_generated/api")).internal
      .recordingReadyNotifications.markReadyToSend,
    { notificationId: enqueue.notificationId, workspaceId: workspaceId as any }
  );

  const r = await t.fetch("/recording-ready/mark-sent", {
    method: "POST",
    headers: bearerAndCallbackHeaders(VALID_KEY, VALID_CALLBACK_SECRET),
    body: JSON.stringify({
      notificationId: enqueue.notificationId,
      providerEmailId: "resend_test_xxx",
    }),
  });
  expect(r.status).toBe(200);

  const row = await t.run(async (ctx) => {
    return await ctx.db.get(enqueue.notificationId);
  });
  expect(row?.deliveryStatus).toBe("sent");
  expect(row?.providerEmailId).toBe("resend_test_xxx");
  expect(row?.sentAt).toBeDefined();
});

test("recording-ready visibility: 401 without callback secret", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;
  process.env.CONVEX_TRIGGER_CALLBACK_SECRET = VALID_CALLBACK_SECRET;

  const r = await t.fetch("/recording-ready/visibility", {
    method: "POST",
    headers: bearerAndCallbackHeaders(VALID_KEY, null),
    body: JSON.stringify({
      sessionId: "j1abc",
      recipientUserId: "user_abc",
    }),
  });
  expect(r.status).toBe(401);
});
