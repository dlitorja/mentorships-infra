/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const WEBHOOK_SECRET_BASE64 = "dGVzdC1zZWNyZXQ=";
const WEBHOOK_SECRET = `whsec_${WEBHOOK_SECRET_BASE64}`;
const PATH = "/webhooks/resend";

async function signSvix(body: string, svixId: string, svixTimestamp: number): Promise<string> {
  const keyBinary = atob(WEBHOOK_SECRET_BASE64);
  const keyBuffer = new ArrayBuffer(keyBinary.length);
  const keyView = new Uint8Array(keyBuffer);
  for (let i = 0; i < keyBinary.length; i++) {
    keyView[i] = keyBinary.charCodeAt(i);
  }
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    keyView,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${svixId}.${svixTimestamp}.${body}`)
  );
  const sigArray = new Uint8Array(sigBuffer);
  let binary = "";
  for (let i = 0; i < sigArray.length; i++) {
    binary += String.fromCharCode(sigArray[i]);
  }
  return `v1,${btoa(binary)}`;
}

function headersFor(body: string, svixId: string, svixTimestamp: number): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "svix-id": svixId,
    "svix-timestamp": String(svixTimestamp),
    "svix-signature": "placeholder",
  };
}

async function signedHeadersFor(
  body: string,
  svixId: string,
  svixTimestamp: number
): Promise<Record<string, string>> {
  const headers = headersFor(body, svixId, svixTimestamp);
  headers["svix-signature"] = await signSvix(body, svixId, svixTimestamp);
  return headers;
}

function setup(): void {
  process.env.RESEND_WEBHOOK_SECRET = WEBHOOK_SECRET;
}

test("resend webhook: 500 when RESEND_WEBHOOK_SECRET is not configured", async () => {
  setup();
  delete process.env.RESEND_WEBHOOK_SECRET;

  const t = convexTest(schema, modules);
  const response = await t.fetch(PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });

  expect(response.status).toBe(500);
});

test("resend webhook: 400 when Svix headers are missing", async () => {
  setup();
  const t = convexTest(schema, modules);

  const response = await t.fetch(PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "suppression.added" }),
  });

  expect(response.status).toBe(400);
});

test("resend webhook: 401 when Svix signature is invalid", async () => {
  setup();
  const t = convexTest(schema, modules);

  const body = JSON.stringify({ type: "suppression.added", created_at: "2026-09-06T12:00:00Z" });
  const now = Math.floor(Date.now() / 1000);

  const response = await t.fetch(PATH, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "svix-id": "msg_invalid",
      "svix-timestamp": String(now),
      "svix-signature": "v1,AAAAdeadbeefdeadbeefdeadbeefdeadbeefdeadbe=",
    },
    body,
  });

  expect(response.status).toBe(401);
});

test("resend webhook: 401 when timestamp is more than 5 minutes old", async () => {
  setup();
  const t = convexTest(schema, modules);

  const body = JSON.stringify({ type: "suppression.added" });
  const oldTimestamp = Math.floor(Date.now() / 1000) - 600;

  const headers = await signedHeadersFor(body, "msg_old", oldTimestamp);
  const response = await t.fetch(PATH, {
    method: "POST",
    headers,
    body,
  });

  expect(response.status).toBe(401);
});

test("resend webhook: suppression.added (bounce origin) writes bounce row", async () => {
  setup();
  const t = convexTest(schema, modules);

  const event = {
    type: "suppression.added",
    created_at: "2026-09-06T12:00:00.000Z",
    data: {
      id: "sup_abc123",
      email: "alice@example.com",
      origin: "bounce",
      source_id: "email_xyz",
      created_at: "2026-09-06T12:00:00.000Z",
    },
  };
  const body = JSON.stringify(event);
  const now = Math.floor(Date.now() / 1000);
  const headers = await signedHeadersFor(body, "msg_suppression_added_1", now);

  const response = await t.fetch(PATH, { method: "POST", headers, body });
  expect(response.status).toBe(200);

  const rows = await t.run(async (ctx) => ctx.db.query("suppressionEvents").collect());
  expect(rows).toHaveLength(1);
  expect(rows[0].kind).toBe("bounce");
  expect(rows[0].email).toBe("alice@example.com");
  expect(rows[0].domain).toBe("example.com");
  expect(rows[0].resendId).toBe("suppress:sup_abc123");
  expect(rows[0].audienceId).toBe("email_xyz");
  expect(rows[0].occurredAt).toBe(Date.parse("2026-09-06T12:00:00.000Z"));
});

test("resend webhook: suppression.added (manual origin) writes unsubscribe row", async () => {
  setup();
  const t = convexTest(schema, modules);

  const event = {
    type: "suppression.added",
    created_at: "2026-09-06T12:30:00.000Z",
    data: {
      id: "sup_def456",
      email: "bob@example.com",
      origin: "manual",
      source_id: null,
    },
  };
  const body = JSON.stringify(event);
  const now = Math.floor(Date.now() / 1000);
  const headers = await signedHeadersFor(body, "msg_suppression_manual_1", now);

  const response = await t.fetch(PATH, { method: "POST", headers, body });
  expect(response.status).toBe(200);

  const rows = await t.run(async (ctx) => ctx.db.query("suppressionEvents").collect());
  expect(rows).toHaveLength(1);
  expect(rows[0].kind).toBe("unsubscribe");
  expect(rows[0].audienceId).toBeUndefined();
});

test("resend webhook: email.bounced writes bounce row with bounceType", async () => {
  setup();
  const t = convexTest(schema, modules);

  const event = {
    type: "email.bounced",
    created_at: "2026-09-06T13:00:00.000Z",
    data: {
      email_id: "email_zzz",
      to: ["carol@example.com"],
      bounce: { type: "Permanent", message: "Mailbox does not exist" },
    },
  };
  const body = JSON.stringify(event);
  const now = Math.floor(Date.now() / 1000);
  const headers = await signedHeadersFor(body, "msg_bounced_1", now);

  const response = await t.fetch(PATH, { method: "POST", headers, body });
  expect(response.status).toBe(200);

  const rows = await t.run(async (ctx) => ctx.db.query("suppressionEvents").collect());
  expect(rows).toHaveLength(1);
  expect(rows[0].kind).toBe("bounce");
  expect(rows[0].bounceType).toBe("Permanent");
  expect(rows[0].reason).toBe("Mailbox does not exist");
  expect(rows[0].resendId).toBe("email_zzz");
});

test("resend webhook: email.complained writes complaint row", async () => {
  setup();
  const t = convexTest(schema, modules);

  const event = {
    type: "email.complained",
    created_at: "2026-09-06T14:00:00.000Z",
    data: {
      email_id: "email_qqq",
      to: ["dave@example.com"],
    },
  };
  const body = JSON.stringify(event);
  const now = Math.floor(Date.now() / 1000);
  const headers = await signedHeadersFor(body, "msg_complained_1", now);

  const response = await t.fetch(PATH, { method: "POST", headers, body });
  expect(response.status).toBe(200);

  const rows = await t.run(async (ctx) => ctx.db.query("suppressionEvents").collect());
  expect(rows).toHaveLength(1);
  expect(rows[0].kind).toBe("complaint");
  expect(rows[0].resendId).toBe("email_qqq");
});

test("resend webhook: suppression.removed is acknowledged but does NOT write a row", async () => {
  setup();
  const t = convexTest(schema, modules);

  const event = {
    type: "suppression.removed",
    created_at: "2026-09-06T15:00:00.000Z",
    data: { id: "sup_removed_1", email: "eve@example.com", origin: "manual" },
  };
  const body = JSON.stringify(event);
  const now = Math.floor(Date.now() / 1000);
  const headers = await signedHeadersFor(body, "msg_removed_1", now);

  const response = await t.fetch(PATH, { method: "POST", headers, body });
  expect(response.status).toBe(200);

  const rows = await t.run(async (ctx) => ctx.db.query("suppressionEvents").collect());
  expect(rows).toHaveLength(0);
});

test("resend webhook: idempotent on Resend message replay (same svix-id + email_id)", async () => {
  setup();
  const t = convexTest(schema, modules);

  const event = {
    type: "email.bounced",
    created_at: "2026-09-06T13:00:00.000Z",
    data: {
      email_id: "email_dup",
      to: ["frank@example.com"],
      bounce: { type: "Permanent", message: "Mailbox does not exist" },
    },
  };
  const body = JSON.stringify(event);
  const now = Math.floor(Date.now() / 1000);
  const headers = await signedHeadersFor(body, "msg_dup_1", now);

  const first = await t.fetch(PATH, { method: "POST", headers, body });
  expect(first.status).toBe(200);

  const replay = await t.fetch(PATH, { method: "POST", headers, body });
  expect(replay.status).toBe(200);

  const rows = await t.run(async (ctx) => ctx.db.query("suppressionEvents").collect());
  expect(rows).toHaveLength(1);
});
