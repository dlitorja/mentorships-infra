/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const NOW = Date.UTC(2026, 8, 6, 12, 0, 0);

async function insertRow(
  t: ReturnType<typeof convexTest<typeof schema>>,
  args: {
    kind: "bounce" | "complaint" | "unsubscribe" | "removed";
    email: string;
    domain: string;
    resendId: string;
    receivedAt: number;
    occurredAt?: number;
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
      receivedAt: args.receivedAt,
      occurredAt: args.occurredAt ?? args.receivedAt,
      audienceId: undefined,
      raw: {},
    });
  });
}

test("suppressionListQueries.getListStateRowsBefore: returns list:* rows with receivedAt < before", async () => {
  const t = convexTest(schema, modules);
  await insertRow(t, {
    kind: "bounce",
    email: "a@example.com",
    domain: "example.com",
    resendId: "list:abc",
    receivedAt: NOW - 100_000,
  });
  await insertRow(t, {
    kind: "removed",
    email: "b@example.com",
    domain: "example.com",
    resendId: "list:gone",
    receivedAt: NOW - 200_000,
  });

  const rows = await t.query(
    "queries/suppressionListQueries:getListStateRowsBefore" as never,
    { before: NOW }
  );
  expect(rows).toHaveLength(2);
  expect(rows.map((r) => r.resendId).sort()).toEqual(["list:abc", "list:gone"]);
});

test("suppressionListQueries.getListStateRowsBefore: excludes rows receivedAt >= before", async () => {
  const t = convexTest(schema, modules);
  await insertRow(t, {
    kind: "bounce",
    email: "a@example.com",
    domain: "example.com",
    resendId: "list:abc",
    receivedAt: NOW - 100_000,
  });
  await insertRow(t, {
    kind: "bounce",
    email: "b@example.com",
    domain: "example.com",
    resendId: "list:def",
    receivedAt: NOW + 100_000,
  });

  const rows = await t.query(
    "queries/suppressionListQueries:getListStateRowsBefore" as never,
    { before: NOW }
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].resendId).toBe("list:abc");
});

test("suppressionListQueries.getListStateRowsBefore: excludes suppress:* and event:* and removed:* prefixes", async () => {
  const t = convexTest(schema, modules);
  await insertRow(t, {
    kind: "bounce",
    email: "a@example.com",
    domain: "example.com",
    resendId: "list:abc",
    receivedAt: NOW - 100_000,
  });
  await insertRow(t, {
    kind: "bounce",
    email: "b@example.com",
    domain: "example.com",
    resendId: "suppress:webhook1",
    receivedAt: NOW - 100_000,
  });
  await insertRow(t, {
    kind: "bounce",
    email: "c@example.com",
    domain: "example.com",
    resendId: "event:email_123:c@example.com",
    receivedAt: NOW - 100_000,
  });
  await insertRow(t, {
    kind: "removed",
    email: "d@example.com",
    domain: "example.com",
    resendId: "removed:gone1",
    receivedAt: NOW - 100_000,
  });

  const rows = await t.query(
    "queries/suppressionListQueries:getListStateRowsBefore" as never,
    { before: NOW }
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].resendId).toBe("list:abc");
});

test("suppressionListQueries.getListStateRowsBefore: returns empty when no list: rows exist", async () => {
  const t = convexTest(schema, modules);
  const rows = await t.query(
    "queries/suppressionListQueries:getListStateRowsBefore" as never,
    { before: NOW }
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
