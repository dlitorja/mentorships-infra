/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 6, 12, 0, 0);
const ADMIN_CLERK_ID = "user_admin_email_health";

async function seedAdmin(t: ReturnType<typeof convexTest<typeof schema>>): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: ADMIN_CLERK_ID,
      email: "admin@example.com",
      clerkId: ADMIN_CLERK_ID,
      role: "admin",
    });
  });
}

async function callSummary(
  t: ReturnType<typeof convexTest<typeof schema>>,
  windowDays: number
): Promise<Awaited<ReturnType<typeof t.query>>> {
  const client = t.withIdentity({ subject: ADMIN_CLERK_ID });
  return client.query(internal.queries.emailHealth.getEmailHealthSummary, {
    windowDays,
  });
}

function seedRow(args: {
  kind: "bounce" | "complaint" | "unsubscribe" | "removed";
  email: string;
  domain: string;
  resendId: string;
  occurredAt: number;
  bounceType?: string;
  reason?: string;
}) {
  return {
    kind: args.kind,
    email: args.email,
    domain: args.domain,
    resendId: args.resendId,
    bounceType: args.bounceType,
    reason: args.reason,
    receivedAt: args.occurredAt,
    occurredAt: args.occurredAt,
    audienceId: undefined,
    raw: { seed: true },
  };
}

async function seed(
  t: ReturnType<typeof convexTest<typeof schema>>,
  rows: Parameters<typeof seedRow>[0][]
): Promise<void> {
  for (const r of rows) {
    await t.run(async (ctx) => {
      const dashboardRelevant = computeDashboardRelevant(r.resendId, r.kind);
      await ctx.db.insert("suppressionEvents", {
        kind: r.kind,
        email: r.email,
        domain: r.domain,
        resendId: r.resendId,
        bounceType: r.bounceType,
        reason: r.reason,
        receivedAt: r.occurredAt,
        occurredAt: r.occurredAt,
        audienceId: undefined,
        dashboardRelevant,
        raw: { seed: true },
      });
    });
  }
}

function computeDashboardRelevant(resendId: string, kind: string): boolean {
  if (resendId.startsWith("list:") || resendId.startsWith("event:")) return true;
  if (resendId.startsWith("removed:") && kind === "removed") return true;
  return false;
}

test("emailHealth: rejects unauthenticated callers", async () => {
  const t = convexTest(schema, modules);
  await expect(
    t.query(internal.queries.emailHealth.getEmailHealthSummary, { windowDays: 7 })
  ).rejects.toThrow(/Authentication required/);
});

test("emailHealth: rejects non-admin callers", async () => {
  const t = convexTest(schema, modules);
  const STUDENT_CLERK_ID = "user_student_1";
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: STUDENT_CLERK_ID,
      email: "stu@example.com",
      clerkId: STUDENT_CLERK_ID,
      role: "student",
    });
  });
  const studentClient = t.withIdentity({ subject: STUDENT_CLERK_ID });
  await expect(
    studentClient.query(internal.queries.emailHealth.getEmailHealthSummary, {
      windowDays: 7,
    })
  ).rejects.toThrow(/Administrator role required/);
});

test("emailHealth: empty database returns zero totals and empty domains", async () => {
  const t = convexTest(schema, modules);
  await seedAdmin(t);
  const summary = await callSummary(t, 7);
  expect(summary.totals).toEqual({
    bounces: 0,
    complaints: 0,
    unsubscribes: 0,
    removed: 0,
    domains: 0,
  });
  expect(summary.domains).toEqual([]);
  expect(summary.recentEvents).toEqual([]);
  expect(summary.truncated).toBe(false);
  expect(summary.scannedRows).toBe(0);
});

test("emailHealth: aggregates per-domain counts and sorts by severity", async () => {
  const t = convexTest(schema, modules);
  await seedAdmin(t);
  await seed(t, [
    seedRow({
      kind: "bounce",
      email: "u1@example.com",
      domain: "example.com",
      resendId: "list:abc1",
      occurredAt: NOW - 1 * DAY_MS,
      bounceType: "Permanent",
    }),
    seedRow({
      kind: "bounce",
      email: "u2@example.com",
      domain: "example.com",
      resendId: "list:abc2",
      occurredAt: NOW - 2 * DAY_MS,
    }),
    seedRow({
      kind: "complaint",
      email: "u3@example.com",
      domain: "example.com",
      resendId: "event:email_1:u3@example.com",
      occurredAt: NOW - 3 * DAY_MS,
    }),
    seedRow({
      kind: "unsubscribe",
      email: "u4@another.com",
      domain: "another.com",
      resendId: "list:def1",
      occurredAt: NOW - 1 * DAY_MS,
    }),
  ]);

  const summary = await callSummary(t, 7);

  expect(summary.totals.bounces).toBe(2);
  expect(summary.totals.complaints).toBe(1);
  expect(summary.totals.unsubscribes).toBe(1);
  expect(summary.totals.domains).toBe(2);

  expect(summary.domains[0].domain).toBe("example.com");
  expect(summary.domains[0].bounces).toBe(2);
  expect(summary.domains[0].complaints).toBe(1);
  expect(summary.domains[0].sampleEmails.length).toBeLessThanOrEqual(5);
  expect(summary.domains[1].domain).toBe("another.com");
});

test("emailHealth: severity flips red when bounces >= 100", async () => {
  const t = convexTest(schema, modules);
  await seedAdmin(t);
  const rows = Array.from({ length: 100 }).map((_, i) =>
    seedRow({
      kind: "bounce",
      email: `u${i}@redflag.com`,
      domain: "redflag.com",
      resendId: `list:r${i}`,
      occurredAt: NOW - (i % 7) * DAY_MS,
    })
  );
  await seed(t, rows);

  const summary = await callSummary(t, 7);

  expect(summary.domains[0].domain).toBe("redflag.com");
  expect(summary.domains[0].bounces).toBe(100);
  expect(summary.domains[0].severity).toBe("red");
});

test("emailHealth: severity is yellow for half-threshold bounces", async () => {
  const t = convexTest(schema, modules);
  await seedAdmin(t);
  const rows = Array.from({ length: 60 }).map((_, i) =>
    seedRow({
      kind: "bounce",
      email: `u${i}@halfway.com`,
      domain: "halfway.com",
      resendId: `list:h${i}`,
      occurredAt: NOW - (i % 7) * DAY_MS,
    })
  );
  await seed(t, rows);

  const summary = await callSummary(t, 7);

  expect(summary.domains[0].severity).toBe("yellow");
});

test("emailHealth: rows outside the window are excluded", async () => {
  const t = convexTest(schema, modules);
  await seedAdmin(t);
  await seed(t, [
    seedRow({
      kind: "bounce",
      email: "old@stale.com",
      domain: "stale.com",
      resendId: "list:old",
      occurredAt: NOW - 60 * DAY_MS,
    }),
    seedRow({
      kind: "bounce",
      email: "new@fresh.com",
      domain: "fresh.com",
      resendId: "list:new",
      occurredAt: NOW - 1 * DAY_MS,
    }),
  ]);

  const summary = await callSummary(t, 7);

  expect(summary.domains.map((d) => d.domain).sort()).toEqual(["fresh.com"]);
  expect(summary.scannedRows).toBe(1);
});

test("emailHealth: recent events sorted newest-first and capped at 100", async () => {
  const t = convexTest(schema, modules);
  await seedAdmin(t);
  const rows = Array.from({ length: 150 }).map((_, i) =>
    seedRow({
      kind: "bounce",
      email: `u${i}@cap.com`,
      domain: "cap.com",
      resendId: `list:c${i}`,
      occurredAt: NOW - (i + 1) * 60_000,
    })
  );
  await seed(t, rows);

  const summary = await callSummary(t, 30);

  expect(summary.recentEvents).toHaveLength(100);
  expect(summary.recentEvents[0].occurredAt).toBeGreaterThan(
    summary.recentEvents[summary.recentEvents.length - 1].occurredAt
  );
  expect(summary.scanCap).toBe(5000);
  expect(summary.scannedRows).toBe(150);
  expect(summary.truncated).toBe(false);
});

test("emailHealth: removed events are counted separately", async () => {
  const t = convexTest(schema, modules);
  await seedAdmin(t);
  await seed(t, [
    seedRow({
      kind: "bounce",
      email: "u1@example.com",
      domain: "example.com",
      resendId: "list:live1",
      occurredAt: NOW - 1 * DAY_MS,
    }),
    seedRow({
      kind: "removed",
      email: "u2@example.com",
      domain: "example.com",
      resendId: "removed:gone1",
      occurredAt: NOW - 1 * DAY_MS,
    }),
  ]);

  const summary = await callSummary(t, 7);

  expect(summary.domains[0].bounces).toBe(1);
  expect(summary.domains[0].removed).toBe(1);
  expect(summary.totals.removed).toBe(1);
});

test("emailHealth: suppresses:* webhook rows are NOT counted (no double-counting)", async () => {
  const t = convexTest(schema, modules);
  await seedAdmin(t);
  await seed(t, [
    seedRow({
      kind: "bounce",
      email: "u1@example.com",
      domain: "example.com",
      resendId: "list:abc1",
      occurredAt: NOW - 1 * DAY_MS,
    }),
    seedRow({
      kind: "bounce",
      email: "u1@example.com",
      domain: "example.com",
      resendId: "suppress:abc1",
      occurredAt: NOW - 1 * DAY_MS,
    }),
  ]);

  const summary = await callSummary(t, 7);

  expect(summary.domains[0].bounces).toBe(1);
  expect(summary.totals.bounces).toBe(1);
  expect(summary.scannedRows).toBe(1);
});

test("emailHealth: deniedDomains are returned separately", async () => {
  const t = convexTest(schema, modules);
  await seedAdmin(t);
  await t.run(async (ctx) => {
    await ctx.db.insert("deniedDomains", {
      domain: "spam.example.com",
      firstDeniedAt: NOW - 5 * DAY_MS,
      lastDeniedAt: NOW - 1 * DAY_MS,
      kind: "bounce",
      note: "high bounce rate",
    });
  });

  const summary = await callSummary(t, 7);
  expect(summary.deniedDomains).toHaveLength(1);
  expect(summary.deniedDomains[0].domain).toBe("spam.example.com");
});

test("emailHealth: windowDays clamps to [1, 90]", async () => {
  const t = convexTest(schema, modules);
  await seedAdmin(t);
  const a = await callSummary(t, 0);
  const b = await callSummary(t, 200);
  expect(a.windowDays).toBe(1);
  expect(b.windowDays).toBe(90);
});
