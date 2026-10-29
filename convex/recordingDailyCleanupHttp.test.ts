/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { beforeEach, expect, test } from "vitest";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const VALID_KEY = "test-http-key";
const VALID_SECRET = "test-callback-secret";

function callbackHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${VALID_KEY}`,
    "X-Trigger-Callback-Secret": VALID_SECRET,
  };
}

beforeEach(() => {
  process.env.CONVEX_HTTP_KEY = VALID_KEY;
  process.env.CONVEX_TRIGGER_CALLBACK_SECRET = VALID_SECRET;
});

async function seedReadySession(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const instructorId = await ctx.db.insert("instructors", {
      userId: "user_instructor_cleanup_http",
      email: "instructor-cleanup-http@example.com",
      name: "Test Instructor",
      slug: "test-instructor-cleanup-http",
      isActive: true,
      oneOnOneInventory: 0,
      groupInventory: 0,
      maxActiveStudents: 10,
    });
    const sessionId = await ctx.db.insert("sessions", {
      instructorId,
      studentId: "user_student_cleanup_http",
      scheduledAt: Date.now(),
      status: "completed",
      recordingConsent: true,
      recordingUrl: "recordings/session-http/rec-http.mp4",
      recordingId: "rec-http",
      recordingTransferStatus: "ready",
      recordingDailyCleanupStatus: "pending",
    });
    return sessionId;
  });
}

test("daily cleanup callbacks reject requests without both keys", async () => {
  const t = convexTest(schema, modules);
  const sessionId = await seedReadySession(t);

  const noAuth = await t.fetch("/recording-transfer/mark-daily-cleanup-done", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });
  expect(noAuth.status).toBe(401);

  const authOnly = await t.fetch(
    "/recording-transfer/mark-daily-cleanup-done",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${VALID_KEY}`,
      },
      body: JSON.stringify({ sessionId }),
    }
  );
  expect(authOnly.status).toBe(401);

  const wrongSecret = await t.fetch(
    "/recording-transfer/mark-daily-cleanup-retrying",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${VALID_KEY}`,
        "X-Trigger-Callback-Secret": "wrong",
      },
      body: JSON.stringify({ sessionId }),
    }
  );
  expect(wrongSecret.status).toBe(401);
});

test("mark-daily-cleanup-retrying advances the run counter over HTTP", async () => {
  const t = convexTest(schema, modules);
  const sessionId = await seedReadySession(t);

  const first = await t.fetch(
    "/recording-transfer/mark-daily-cleanup-retrying",
    {
      method: "POST",
      headers: callbackHeaders(),
      body: JSON.stringify({ sessionId }),
    }
  );
  expect(first.status).toBe(200);
  expect(await first.json()).toMatchObject({ attempts: 1 });

  const second = await t.fetch(
    "/recording-transfer/mark-daily-cleanup-retrying",
    {
      method: "POST",
      headers: callbackHeaders(),
      body: JSON.stringify({ sessionId }),
    }
  );
  expect(second.status).toBe(200);
  expect(await second.json()).toMatchObject({ attempts: 2 });

  const session = await t.run(async (ctx) => await ctx.db.get(sessionId));
  expect(session?.recordingDailyCleanupAttempts).toBe(2);
  expect(session?.recordingDailyCleanupStatus).toBe("pending");
});

test("mark-daily-cleanup-failed requires errorMessage and stores it", async () => {
  const t = convexTest(schema, modules);
  const sessionId = await seedReadySession(t);

  const invalid = await t.fetch(
    "/recording-transfer/mark-daily-cleanup-failed",
    {
      method: "POST",
      headers: callbackHeaders(),
      body: JSON.stringify({ sessionId }),
    }
  );
  expect(invalid.status).toBe(400);

  const ok = await t.fetch("/recording-transfer/mark-daily-cleanup-failed", {
    method: "POST",
    headers: callbackHeaders(),
    body: JSON.stringify({ sessionId, errorMessage: "Daily API 500" }),
  });
  expect(ok.status).toBe(200);
  expect(await ok.json()).toMatchObject({ ignored: false });

  const session = await t.run(async (ctx) => await ctx.db.get(sessionId));
  expect(session?.recordingDailyCleanupStatus).toBe("failed");
  expect(session?.recordingDailyCleanupError).toBe("Daily API 500");
  expect(session?.recordingTransferStatus).toBe("ready");
});

test("mark-daily-cleanup-retrying does not reopen a completed cleanup", async () => {
  const t = convexTest(schema, modules);
  const sessionId = await seedReadySession(t);

  await t.fetch("/recording-transfer/mark-daily-cleanup-done", {
    method: "POST",
    headers: callbackHeaders(),
    body: JSON.stringify({ sessionId }),
  });

  const claimed = await t.fetch(
    "/recording-transfer/mark-daily-cleanup-retrying",
    {
      method: "POST",
      headers: callbackHeaders(),
      body: JSON.stringify({ sessionId }),
    }
  );
  expect(claimed.status).toBe(200);
  expect(await claimed.json()).toMatchObject({ alreadyDone: true });

  const session = await t.run(async (ctx) => await ctx.db.get(sessionId));
  expect(session?.recordingDailyCleanupStatus).toBe("done");
});

test("mark-daily-cleanup-failed ignores a stale failure after done", async () => {
  const t = convexTest(schema, modules);
  const sessionId = await seedReadySession(t);

  const done = await t.fetch("/recording-transfer/mark-daily-cleanup-done", {
    method: "POST",
    headers: callbackHeaders(),
    body: JSON.stringify({ sessionId }),
  });
  expect(done.status).toBe(200);

  const stale = await t.fetch("/recording-transfer/mark-daily-cleanup-failed", {
    method: "POST",
    headers: callbackHeaders(),
    body: JSON.stringify({ sessionId, errorMessage: "late 500" }),
  });
  expect(stale.status).toBe(200);
  expect(await stale.json()).toMatchObject({ ignored: true });

  const session = await t.run(async (ctx) => await ctx.db.get(sessionId));
  expect(session?.recordingDailyCleanupStatus).toBe("done");
  expect(session?.recordingDailyCleanupError).toBeUndefined();
});
