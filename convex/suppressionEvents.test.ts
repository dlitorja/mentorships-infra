import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

test("suppressionEvents.upsertSuppressionEvent: first write creates, replay is idempotent", async () => {
  const t = convexTest(schema, modules);

  const first = await t.run(async (ctx) => {
    return await ctx.runMutation(internal.mutations.suppressionEvents.upsertSuppressionEvent, {
      kind: "bounce",
      email: "alice@example.com",
      domain: "example.com",
      resendId: "msg_abc123",
      bounceType: "hard",
      reason: "Mailbox does not exist",
      receivedAt: 1_700_000_000_000,
      occurredAt: 1_700_000_000_000,
      audienceId: "aud_1",
      raw: { id: "msg_abc123", origin: "bounce" },
    });
  });

  expect(first.created).toBe(true);
  expect(typeof first.id).toBe("string");

  const replay = await t.run(async (ctx) => {
    return await ctx.runMutation(internal.mutations.suppressionEvents.upsertSuppressionEvent, {
      kind: "bounce",
      email: "alice@example.com",
      domain: "example.com",
      resendId: "msg_abc123",
      bounceType: "hard",
      reason: "Mailbox does not exist",
      receivedAt: 1_700_000_000_500,
      occurredAt: 1_700_000_000_000,
      audienceId: "aud_1",
      raw: { id: "msg_abc123", origin: "bounce" },
    });
  });

  expect(replay.created).toBe(false);
  expect(replay.id).toBe(first.id);

  const count = await t.run(async (ctx) => {
    return await ctx.db.query("suppressionEvents").collect().then((rows) => rows.length);
  });
  expect(count).toBe(1);
});

test("suppressionEvents.upsertSuppressionEvent: same resendId with different kind writes both rows", async () => {
  const t = convexTest(schema, modules);

  await t.run(async (ctx) => {
    await ctx.runMutation(internal.mutations.suppressionEvents.upsertSuppressionEvent, {
      kind: "bounce",
      email: "bob@example.com",
      domain: "example.com",
      resendId: "msg_xyz",
      bounceType: "soft",
      reason: "Mailbox full",
      receivedAt: 1_700_000_001_000,
      occurredAt: 1_700_000_001_000,
      raw: {},
    });
  });

  await t.run(async (ctx) => {
    await ctx.runMutation(internal.mutations.suppressionEvents.upsertSuppressionEvent, {
      kind: "complaint",
      email: "bob@example.com",
      domain: "example.com",
      resendId: "msg_xyz",
      reason: "Spam complaint",
      receivedAt: 1_700_000_002_000,
      occurredAt: 1_700_000_002_000,
      raw: {},
    });
  });

  const rows = await t.run(async (ctx) => {
    return await ctx.db.query("suppressionEvents").collect();
  });

  expect(rows).toHaveLength(2);
  expect(rows.map((r) => r.kind).sort()).toEqual(["bounce", "complaint"]);
});

test("suppressionEvents indexes resolve by occurredAt, not receivedAt (Greptile finding)", async () => {
  const t = convexTest(schema, modules);

  await t.run(async (ctx) => {
    await ctx.runMutation(internal.mutations.suppressionEvents.upsertSuppressionEvent, {
      kind: "bounce",
      email: "carol@example.com",
      domain: "example.com",
      resendId: "msg_historical",
      bounceType: "hard",
      receivedAt: 1_700_000_010_000,
      occurredAt: 1_600_000_000_000,
      raw: {},
    });
  });

  const historical = await t.run(async (ctx) => {
    return await ctx.db
      .query("suppressionEvents")
      .withIndex("by_occurredAt", (q) => q.eq("occurredAt", 1_600_000_000_000))
      .first();
  });

  expect(historical).not.toBeNull();
  expect(historical?.email).toBe("carol@example.com");
  expect(historical?.occurredAt).toBe(1_600_000_000_000);
  expect(historical?.receivedAt).toBe(1_700_000_010_000);
});
