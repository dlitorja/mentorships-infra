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
 *   - 401 when the header is present but wrong.
 *   - NOT throw `ReferenceError: Buffer is not defined` (caught
 *     2026-09-04 by a Tier-1 smoke test against prod). The old
 *     implementation used `Buffer.from(...)` / `Buffer.alloc(...)`,
 *     which are Node-only globals and don't exist in Convex's V8
 *     isolate runtime — every callback was 500'ing.
 *   - 200 when the header matches `CONVEX_TRIGGER_CALLBACK_SECRET`.
 *
 * Note: we don't drive an actual mutation end-to-end here because
 * the seed session row would need real recording data. The
 * mutation would return 422/500 on a missing session, which is
 * fine — what matters is that the auth path doesn't 500.
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

test("recording-transfer callback auth: passes verifyCallbackSecret with matching secret (no Buffer ReferenceError)", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;
  process.env.CONVEX_TRIGGER_CALLBACK_SECRET = VALID_CALLBACK_SECRET;

  let status: number | null = null;
  let error: unknown = null;
  try {
    const r = await t.fetch("/recording-transfer/attach-from-b2", {
      method: "POST",
      headers: bearerAndCallbackHeaders(VALID_KEY, VALID_CALLBACK_SECRET),
      body: JSON.stringify({ sessionId: "j1abc", b2Key: "recordings/test/test.mp4" }),
    });
    status = r.status;
  } catch (e) {
    // `t.fetch` re-throws Convex validator/mutation errors as
    // exceptions instead of returning a Response. The pre-fix
    // bug surfaced as `ReferenceError: Buffer is not defined`,
    // which we explicitly want to NOT see. Any other error
    // (validator rejection of the fake sessionId, missing
    // sessions row, etc.) proves auth passed and the handler
    // reached `ctx.runMutation`.
    error = e;
  }
  if (error !== null) {
    const msg = String((error as Error)?.message ?? error);
    expect(msg).not.toMatch(/Buffer is not defined/);
    expect(msg).not.toMatch(/ReferenceError/);
  } else {
    expect(status).not.toBe(500);
    expect(status).not.toBe(401);
  }
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
