/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 6, 12, 0, 0);

async function insertRow(
  t: ReturnType<typeof convexTest<typeof schema>>,
  args: {
    kind: "bounce" | "complaint" | "unsubscribe" | "removed";
    email: string;
    domain: string;
    resendId: string;
    occurredAt: number;
  }
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert("suppressionEvents", {
      kind: args.kind,
      email: args.email,
      domain: args.domain,
      resendId: args.resendId,
      bounceType: undefined,
      reason: undefined,
      receivedAt: args.occurredAt,
      occurredAt: args.occurredAt,
      audienceId: undefined,
      raw: {},
    });
  });
}

test("suppressionListQueries.getActiveSuppressionRows: filters out removed rows", async () => {
  const t = convexTest(schema, modules);
  await insertRow(t, {
    kind: "bounce",
    email: "a@example.com",
    domain: "example.com",
    resendId: "suppress:abc",
    occurredAt: NOW,
  });
  await insertRow(t, {
    kind: "removed",
    email: "b@example.com",
    domain: "example.com",
    resendId: "suppress:gone",
    occurredAt: NOW,
  });

  const rows = await t.query(
    // @ts-expect-error internal query reference not in api.d.ts export surface
    "queries/suppressionListQueries:getActiveSuppressionRows" as never,
    {}
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].resendId).toBe("suppress:abc");
});

test("suppressionListQueries.getActiveSuppressionRows: excludes list:* and event:* prefixes", async () => {
  const t = convexTest(schema, modules);
  await insertRow(t, {
    kind: "bounce",
    email: "a@example.com",
    domain: "example.com",
    resendId: "suppress:abc",
    occurredAt: NOW,
  });
  await insertRow(t, {
    kind: "bounce",
    email: "b@example.com",
    domain: "example.com",
    resendId: "list:backfilled",
    occurredAt: NOW,
  });
  await insertRow(t, {
    kind: "bounce",
    email: "c@example.com",
    domain: "example.com",
    resendId: "event:email_123:c@example.com",
    occurredAt: NOW,
  });

  const rows = await t.query(
    // @ts-expect-error internal query reference not in api.d.ts export surface
    "queries/suppressionListQueries:getActiveSuppressionRows" as never,
    {}
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].resendId).toBe("suppress:abc");
});

test("suppressionListQueries.getActiveSuppressionRows: returns empty when no suppress: rows exist", async () => {
  const t = convexTest(schema, modules);
  const rows = await t.query(
    // @ts-expect-error internal query reference not in api.d.ts export surface
    "queries/suppressionListQueries:getActiveSuppressionRows" as never,
    {}
  );
  expect(rows).toEqual([]);
});

test("schema: deniedDomains table accepts the documented fields", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("deniedDomains", {
      domain: "test.com",
      firstDeniedAt: NOW,
      lastDeniedAt: NOW,
      kind: "bounce",
      note: "manual flag",
    });
  });
  const rows = await t.run(async (ctx) => ctx.db.query("deniedDomains").collect());
  expect(rows).toHaveLength(1);
  expect(rows[0].domain).toBe("test.com");
});

void DAY_MS;
