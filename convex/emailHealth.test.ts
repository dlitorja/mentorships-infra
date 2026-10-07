/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.now();
const ADMIN_CLERK_ID = "user_admin_email_health";

async function seedAdmin(
  t: ReturnType<typeof convexTest<typeof schema>>,
): Promise<void> {
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
  windowDays: number,
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
  rows: Parameters<typeof seedRow>[0][],
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
  if (resendId.startsWith("list:") || resendId.startsWith("event:"))
    return true;
  if (resendId.startsWith("removed:") && kind === "removed") return true;
  return false;
}

test("emailHealth: rejects unauthenticated callers", async () => {
  const t = convexTest(schema, modules);
  await expect(
    t.query(internal.queries.emailHealth.getEmailHealthSummary, {
      windowDays: 7,
    }),
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
    }),
  ).rejects.toThrow(/Administrator role required/);
});

test("emailHealth: split-id admin record is still recognized via by_userId", async () => {
  const t = convexTest(schema, modules);
  const SHARED_CLERK_ID = "user_split_clerk";
  const ADMIN_USER_ID = "user_split_admin";
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: ADMIN_USER_ID,
      email: "split-admin@example.com",
      clerkId: SHARED_CLERK_ID,
      role: "admin",
    });
    await ctx.db.insert("users", {
      userId: "user_split_student",
      email: "split-student@example.com",
      clerkId: SHARED_CLERK_ID,
      role: "student",
    });
  });
  const client = t.withIdentity({ subject: ADMIN_USER_ID });
  const summary = await client.query(
    internal.queries.emailHealth.getEmailHealthSummary,
    {
      windowDays: 7,
    },
  );
  expect(summary.totals.domains).toBe(0);
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
    }),
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
    }),
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
    }),
  );
  await seed(t, rows);

  const summary = await callSummary(t, 30);

  expect(summary.recentEvents).toHaveLength(100);
  expect(summary.recentEvents[0].occurredAt).toBeGreaterThan(
    summary.recentEvents[summary.recentEvents.length - 1].occurredAt,
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

// --- PR Metrics 3b: getEmailMetricsOverlay ---

async function callOverlay(
  t: ReturnType<typeof convexTest<typeof schema>>,
  windowDays: number,
): Promise<Awaited<ReturnType<typeof t.query>>> {
  const client = t.withIdentity({ subject: ADMIN_CLERK_ID });
  return client.query(internal.queries.emailHealth.getEmailMetricsOverlay, {
    windowDays,
  });
}

function utcIsoDate(offsetDays: number): string {
  const d = new Date(
    Date.UTC(
      new Date().getUTCFullYear(),
      new Date().getUTCMonth(),
      new Date().getUTCDate() - offsetDays,
    ),
  );
  const yyyy = d.getUTCFullYear().toString().padStart(4, "0");
  const mm = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = d.getUTCDate().toString().padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

async function seedMetrics(
  t: ReturnType<typeof convexTest<typeof schema>>,
  rows: Array<{
    date: string;
    kind: "delivery" | "bounce" | "complaint" | "open" | "click";
    count: number;
    source: "api" | "webhook_reconcile";
    ingestedAt?: number;
  }>,
): Promise<void> {
  for (const r of rows) {
    await t.run(async (ctx) => {
      await ctx.db.insert("dailyEmailMetrics", {
        date: r.date,
        kind: r.kind,
        count: r.count,
        source: r.source,
        ingestedAt: r.ingestedAt ?? NOW,
        audienceId: undefined,
      });
    });
  }
}

test("emailHealth overlay: rejects unauthenticated callers", async () => {
  const t = convexTest(schema, modules);
  await expect(
    t.query(internal.queries.emailHealth.getEmailMetricsOverlay, {
      windowDays: 7,
    }),
  ).rejects.toThrow(/Authentication required/);
});

test("emailHealth overlay: rejects non-admin callers", async () => {
  const t = convexTest(schema, modules);
  const STUDENT_CLERK_ID = "user_student_overlay";
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: STUDENT_CLERK_ID,
      email: "stu-overlay@example.com",
      clerkId: STUDENT_CLERK_ID,
      role: "student",
    });
  });
  const studentClient = t.withIdentity({ subject: STUDENT_CLERK_ID });
  await expect(
    studentClient.query(internal.queries.emailHealth.getEmailMetricsOverlay, {
      windowDays: 7,
    }),
  ).rejects.toThrow(/Administrator role required/);
});

test("emailHealth overlay: windowDays clamps to [1, 30]", async () => {
  const t = convexTest(schema, modules);
  await seedAdmin(t);
  const a = await callOverlay(t, 0);
  const b = await callOverlay(t, 365);
  expect(a.windowDays).toBe(1);
  expect(b.windowDays).toBe(30);
});

test("emailHealth overlay: empty database returns zero rows for every day", async () => {
  const t = convexTest(schema, modules);
  await seedAdmin(t);
  const overlay = await callOverlay(t, 7);
  expect(overlay.windowDays).toBe(7);
  expect(overlay.byDate).toHaveLength(7);
  for (const d of overlay.byDate) {
    expect(d.delivery).toBe(0);
    expect(d.bounce).toBe(0);
    expect(d.complaint).toBe(0);
    expect(d.open).toBe(0);
    expect(d.click).toBe(0);
    expect(d.webhookTotal).toBe(0);
    expect(d.divergencePct).toBe(0);
    expect(d.severity).toBe("green");
  }
  expect(overlay.totals.apiDelivery).toBe(0);
  expect(overlay.totals.divergentDays).toBe(0);
  expect(overlay.totals.redDays).toBe(0);
});

test("emailHealth overlay: matching API and webhook counts are green", async () => {
  const t = convexTest(schema, modules);
  await seedAdmin(t);
  const today = utcIsoDate(0);
  await seedMetrics(t, [
    { date: today, kind: "delivery", count: 1000, source: "api" },
    { date: today, kind: "bounce", count: 2, source: "api" },
    { date: today, kind: "complaint", count: 1, source: "api" },
    { date: today, kind: "open", count: 400, source: "api" },
    { date: today, kind: "click", count: 80, source: "api" },
  ]);
  await seed(t, [
    seedRow({
      kind: "bounce",
      email: "a@example.com",
      domain: "example.com",
      resendId: "event:1",
      occurredAt: NOW,
    }),
    seedRow({
      kind: "bounce",
      email: "b@example.com",
      domain: "example.com",
      resendId: "event:2",
      occurredAt: NOW,
    }),
    seedRow({
      kind: "complaint",
      email: "c@example.com",
      domain: "example.com",
      resendId: "event:3",
      occurredAt: NOW,
    }),
  ]);
  const overlay = await callOverlay(t, 7);
  const row = overlay.byDate.find((d) => d.date === today);
  expect(row).toBeDefined();
  expect(row?.severity).toBe("green");
  expect(row?.divergencePct).toBe(0);
  expect(row?.delivery).toBe(1000);
  expect(row?.bounceRate).toBe(0.2);
  expect(row?.complaintRate).toBe(0.1);
  expect(row?.openRate).toBe(40);
  expect(row?.clickRate).toBe(8);
  expect(overlay.totals.divergentDays).toBe(0);
});

test("emailHealth overlay: 13% webhook-over-API divergence is yellow", async () => {
  const t = convexTest(schema, modules);
  await seedAdmin(t);
  const today = utcIsoDate(0);
  await seedMetrics(t, [
    { date: today, kind: "delivery", count: 100, source: "api" },
    { date: today, kind: "bounce", count: 20, source: "api" },
  ]);
  for (let i = 0; i < 23; i++) {
    await seed(t, [
      seedRow({
        kind: "bounce",
        email: `b${i}@example.com`,
        domain: "example.com",
        resendId: `event:${i}`,
        occurredAt: NOW,
      }),
    ]);
  }
  const overlay = await callOverlay(t, 7);
  const row = overlay.byDate.find((d) => d.date === today);
  expect(row).toBeDefined();
  expect(row?.webhookTotal).toBe(23);
  expect(row?.divergencePct).toBe(13);
  expect(row?.severity).toBe("yellow");
  expect(overlay.totals.divergentDays).toBe(1);
});

test("emailHealth overlay: 33% webhook-over-API divergence is red", async () => {
  const t = convexTest(schema, modules);
  await seedAdmin(t);
  const today = utcIsoDate(0);
  await seedMetrics(t, [
    { date: today, kind: "delivery", count: 100, source: "api" },
    { date: today, kind: "bounce", count: 20, source: "api" },
  ]);
  for (let i = 0; i < 30; i++) {
    await seed(t, [
      seedRow({
        kind: "bounce",
        email: `b${i}@example.com`,
        domain: "example.com",
        resendId: `event:${i}`,
        occurredAt: NOW,
      }),
    ]);
  }
  const overlay = await callOverlay(t, 7);
  const row = overlay.byDate.find((d) => d.date === today);
  expect(row).toBeDefined();
  expect(row?.webhookTotal).toBe(30);
  expect(row?.divergencePct).toBe(33);
  expect(row?.severity).toBe("red");
  expect(overlay.totals.redDays).toBe(1);
});

test("emailHealth overlay: aggregates across multiple audienceId rows", async () => {
  const t = convexTest(schema, modules);
  await seedAdmin(t);
  const today = utcIsoDate(0);
  await t.run(async (ctx) => {
    await ctx.db.insert("dailyEmailMetrics", {
      date: today,
      kind: "delivery",
      count: 500,
      source: "api",
      ingestedAt: NOW,
      audienceId: "aud_a",
    });
    await ctx.db.insert("dailyEmailMetrics", {
      date: today,
      kind: "delivery",
      count: 500,
      source: "api",
      ingestedAt: NOW,
      audienceId: "aud_b",
    });
  });
  const overlay = await callOverlay(t, 7);
  const row = overlay.byDate.find((d) => d.date === today);
  expect(row?.delivery).toBe(1000);
});

test("emailHealth overlay: sources.apiLatestIngestedAt tracks the most recent row", async () => {
  const t = convexTest(schema, modules);
  await seedAdmin(t);
  const today = utcIsoDate(0);
  await seedMetrics(t, [
    {
      date: today,
      kind: "delivery",
      count: 100,
      source: "api",
      ingestedAt: NOW - 60_000,
    },
    {
      date: today,
      kind: "delivery",
      count: 50,
      source: "webhook_reconcile",
      ingestedAt: NOW,
    },
  ]);
  const overlay = await callOverlay(t, 7);
  expect(overlay.sources.apiLatestIngestedAt).toBe(NOW);
  const row = overlay.byDate.find((d) => d.date === today);
  expect(row?.delivery).toBe(150);
});

test("emailHealth overlay: dedupes webhook + list-scan duplicates without collapsing distinct events", async () => {
  const t = convexTest(schema, modules);
  await seedAdmin(t);
  const today = utcIsoDate(0);
  await seedMetrics(t, [
    { date: today, kind: "delivery", count: 100, source: "api" },
    { date: today, kind: "bounce", count: 2, source: "api" },
    { date: today, kind: "complaint", count: 1, source: "api" },
  ]);
  // a@example.com bounced twice today (2 distinct events = 2 event: rows)
  // AND the suppression-list scan produced 1 list: row. The list:
  // row is a snapshot of one of the events, so the day's webhook
  // count is 2, not 1.
  await seed(t, [
    seedRow({
      kind: "bounce",
      email: "a@example.com",
      domain: "example.com",
      resendId: "event:abc1",
      occurredAt: NOW,
    }),
    seedRow({
      kind: "bounce",
      email: "a@example.com",
      domain: "example.com",
      resendId: "event:abc2",
      occurredAt: NOW,
    }),
    seedRow({
      kind: "bounce",
      email: "a@example.com",
      domain: "example.com",
      resendId: "list:abc",
      occurredAt: NOW,
    }),
    seedRow({
      kind: "complaint",
      email: "b@example.com",
      domain: "example.com",
      resendId: "event:def",
      occurredAt: NOW,
    }),
    seedRow({
      kind: "complaint",
      email: "b@example.com",
      domain: "example.com",
      resendId: "list:def",
      occurredAt: NOW,
    }),
  ]);
  const overlay = await callOverlay(t, 7);
  const row = overlay.byDate.find((d) => d.date === today);
  expect(row).toBeDefined();
  expect(row?.webhookBounces).toBe(2);
  expect(row?.webhookComplaints).toBe(1);
  expect(row?.severity).toBe("green");
  expect(row?.divergencePct).toBe(0);
});

test("emailHealth overlay: list: row counts as 1 only when no event: row exists for the same (email, kind, day)", async () => {
  const t = convexTest(schema, modules);
  await seedAdmin(t);
  const today = utcIsoDate(0);
  await seedMetrics(t, [
    { date: today, kind: "delivery", count: 100, source: "api" },
    { date: today, kind: "bounce", count: 1, source: "api" },
  ]);
  // The webhook didn't fire for this bounce today, but the
  // suppression-list scan caught it. We should count 1 (the list:
  // row represents an event even if the webhook missed).
  await seed(t, [
    seedRow({
      kind: "bounce",
      email: "old@example.com",
      domain: "example.com",
      resendId: "list:old",
      occurredAt: NOW,
    }),
  ]);
  const overlay = await callOverlay(t, 7);
  const row = overlay.byDate.find((d) => d.date === today);
  expect(row).toBeDefined();
  expect(row?.webhookBounces).toBe(1);
  expect(row?.severity).toBe("green");
  expect(row?.divergencePct).toBe(0);
});

test("emailHealth overlay: totals include webhookRemoved so totals and per-day webhookTotal match", async () => {
  const t = convexTest(schema, modules);
  await seedAdmin(t);
  const today = utcIsoDate(0);
  await seed(t, [
    seedRow({
      kind: "bounce",
      email: "b@example.com",
      domain: "example.com",
      resendId: "event:1",
      occurredAt: NOW,
    }),
    seedRow({
      kind: "removed",
      email: "r@example.com",
      domain: "example.com",
      resendId: "removed:1",
      occurredAt: NOW,
    }),
  ]);
  const overlay = await callOverlay(t, 7);
  const row = overlay.byDate.find((d) => d.date === today);
  expect(row?.webhookBounces).toBe(1);
  expect(row?.webhookRemoved).toBe(1);
  expect(row?.webhookTotal).toBe(2);
  expect(overlay.totals.webhookBounces).toBe(1);
  expect(overlay.totals.webhookRemoved).toBe(1);
  expect(overlay.totals.webhookTotal).toBe(2);
});
