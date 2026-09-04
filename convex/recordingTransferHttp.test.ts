/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

/**
 * Tests for the X-Trigger-Callback-Secret verification path used by
 * the three `/recording-transfer/*` HTTP endpoints in
 * `convex/http.ts`:
 *   - POST /recording-transfer/attach-from-b2
 *   - POST /recording-transfer/mark-retrying
 *   - POST /recording-transfer/mark-failed
 *
 * `verifyCallbackSecret` must:
 *   - 401 when the `X-Trigger-Callback-Secret` header is missing.
 *   - 401 when the header is present but wrong (any length, any bytes).
 *   - 200 + actual session-row patch when the header matches
 *     `CONVEX_TRIGGER_CALLBACK_SECRET` (proves the full happy path:
 *     auth gate → validator → mutation → db.write).
 *
 * Regression guard: `ReferenceError: Buffer is not defined` (caught
 * 2026-09-04 by a Tier-1 smoke test against prod). The pre-fix
 * implementation used `Buffer.from(...)` / `Buffer.alloc(...)`,
 * which are Node-only globals and do not exist in Convex's V8
 * isolate runtime — every callback was 500'ing for ~7 weeks
 * (commit 2aa50df3b 2026-07-18).
 */

const VALID_KEY = "test-http-key";
const VALID_CALLBACK_SECRET = "test-callback-secret-32-bytes-of-hex!";

function bearerHeaders(key: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${key}`,
  };
}

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

test("recording-transfer callback auth: 401 without callback secret header", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;
  process.env.CONVEX_TRIGGER_CALLBACK_SECRET = VALID_CALLBACK_SECRET;

  const r = await t.fetch("/recording-transfer/attach-from-b2", {
    method: "POST",
    headers: bearerHeaders(VALID_KEY),
    body: JSON.stringify({ sessionId: "j1abc", b2Key: "recordings/test/test.mp4" }),
  });
  expect(r.status).toBe(401);
});

test("recording-transfer callback auth: 401 with wrong callback secret", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;
  process.env.CONVEX_TRIGGER_CALLBACK_SECRET = VALID_CALLBACK_SECRET;

  const r = await t.fetch("/recording-transfer/attach-from-b2", {
    method: "POST",
    headers: bearerAndCallbackHeaders(VALID_KEY, "wrong-secret-bytes"),
    body: JSON.stringify({ sessionId: "j1abc", b2Key: "recordings/test/test.mp4" }),
  });
  expect(r.status).toBe(401);
});

test("recording-transfer callback auth: 401 with wrong callback secret (different length)", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;
  process.env.CONVEX_TRIGGER_CALLBACK_SECRET = VALID_CALLBACK_SECRET;

  const r = await t.fetch("/recording-transfer/attach-from-b2", {
    method: "POST",
    headers: bearerAndCallbackHeaders(VALID_KEY, "x"),
    body: JSON.stringify({ sessionId: "j1abc", b2Key: "recordings/test/test.mp4" }),
  });
  expect(r.status).toBe(401);
});

test("recording-transfer callback auth: matching secret + valid session → 200 + session row patched", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;
  process.env.CONVEX_TRIGGER_CALLBACK_SECRET = VALID_CALLBACK_SECRET;

  // Seed an instructor + session in the `uploading` state so the
  // mutation will actually patch the row (early-returns when
  // status is already `ready`).
  const { sessionId, instructorId } = await t.run(async (ctx) => {
    const instructorId = await ctx.db.insert("instructors", {
      userId: "user_instructor_rhtt",
      email: "instructor-rhtt@example.com",
      name: "Test Instructor",
      slug: "test-instructor-rhtt",
      isActive: true,
      oneOnOneInventory: 0,
      groupInventory: 0,
      maxActiveStudents: 10,
    });
    const sessionId = await ctx.db.insert("sessions", {
      instructorId,
      studentId: "user_student_rhtt",
      scheduledAt: Date.now() - 5_000,
      status: "completed",
      recordingConsent: true,
      callStartedAt: Date.now() - 5_000,
      recordingTransferStatus: "uploading",
    });
    return { sessionId, instructorId };
  });

  const b2Key = `recordings/${sessionId}/rec.mp4`;
  const r = await t.fetch("/recording-transfer/attach-from-b2", {
    method: "POST",
    headers: bearerAndCallbackHeaders(VALID_KEY, VALID_CALLBACK_SECRET),
    body: JSON.stringify({ sessionId, b2Key, durationSeconds: 42 }),
  });
  expect(r.status).toBe(200);

  // Verify the mutation actually ran end-to-end (auth passed,
  // validator passed, b2Key prefix passed, session found, row
  // patched). This is the full happy path that proves the
  // fix didn't break anything downstream of the auth gate.
  const session = await t.run(async (ctx) => {
    return await ctx.db.get(sessionId);
  });
  expect(session).not.toBeNull();
  expect(session?.recordingUrl).toBe(b2Key);
  expect(session?.hasRecordingArtifact).toBe(true);
  expect(session?.recordingTransferStatus).toBe("ready");
  expect(session?.recordingDurationSeconds).toBe(42);
});

test("recording-transfer mark-retrying callback auth: 401 without callback secret", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;
  process.env.CONVEX_TRIGGER_CALLBACK_SECRET = VALID_CALLBACK_SECRET;

  const r = await t.fetch("/recording-transfer/mark-retrying", {
    method: "POST",
    headers: bearerHeaders(VALID_KEY),
    body: JSON.stringify({ sessionId: "j1abc", attemptNumber: 1 }),
  });
  expect(r.status).toBe(401);
});

test("recording-transfer mark-failed callback auth: 401 without callback secret", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;
  process.env.CONVEX_TRIGGER_CALLBACK_SECRET = VALID_CALLBACK_SECRET;

  const r = await t.fetch("/recording-transfer/mark-failed", {
    method: "POST",
    headers: bearerHeaders(VALID_KEY),
    body: JSON.stringify({
      sessionId: "j1abc",
      errorMessage: "test",
      attempts: 1,
    }),
  });
  expect(r.status).toBe(401);
});
