/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

/**
 * F5 regression tests for `cleanup.wipePaymentData` audit logging.
 *
 * Covers the properties the fix claims:
 *   1. Authorization is unchanged (unauthenticated / non-admin rejected).
 *   2. A successful wipe writes exactly one `wipe_payment_data_begin` and
 *      one `wipe_payment_data_complete` row to `auditLogs` (the table that
 *      is NOT on the wipe list).
 *   3. Every target table is actually emptied and reported with its real
 *      pre-wipe count — the fixtures below seed each table non-empty, so a
 *      skipped delete loop shows up as a wrong count *and* as leftover rows.
 *   4. The audit `metadata` carries counts only. The fixtures contain an
 *      email and a Stripe-style payment id so the leak assertion is real
 *      rather than vacuous.
 *
 * The rollback invariant ("audit pair exists iff the wipe committed") is a
 * Convex transaction property rather than application logic; it is not
 * exercised here because convex-test cannot inject a mid-loop delete
 * failure without patching the mutation.
 */

const CUSTOMER_ID = "user_customer_1";
const CUSTOMER_EMAIL = "student@example.com";
const PROVIDER_PAYMENT_ID = "pi_live_SECRET123";

async function seedAdmin(t: ReturnType<typeof convexTest>) {
  const clerkId = "user_admin_1";
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: clerkId,
      email: "admin@example.com",
      clerkId,
      role: "admin",
    });
  });
  return clerkId;
}

/**
 * Seed one row in a representative subset of the wiped tables.
 *
 * `workspaceAuditLogs` is included on purpose: it is the table whose delete
 * loop is easiest to skip unnoticed, because the fix writes its audit rows to
 * a *different* table with a confusingly similar name.
 */
async function seedWipeTargets(t: ReturnType<typeof convexTest>) {
  await t.run(async (ctx) => {
    const workspaceId = await ctx.db.insert("workspaces", {
      name: "Seeded workspace",
      ownerId: CUSTOMER_ID,
      isPublic: false,
      studentImageCount: 0,
      instructorImageCount: 0,
    });

    const orderId = await ctx.db.insert("orders", {
      userId: CUSTOMER_ID,
      status: "paid",
      provider: "stripe",
      totalAmount: "150.00",
      currency: "usd",
    });

    await ctx.db.insert("payments", {
      orderId,
      provider: "stripe",
      providerPaymentId: PROVIDER_PAYMENT_ID,
      amount: "150.00",
      currency: "usd",
      status: "completed",
    });

    await ctx.db.insert("workspaceAuditLogs", {
      workspaceId,
      adminId: "user_admin_1",
      action: "view_workspace",
      timestamp: Date.now(),
    });

    await ctx.db.insert("marketingWaitlist", {
      email: CUSTOMER_EMAIL,
      instructorSlug: "jane-doe",
      mentorshipType: "oneOnOne",
      createdAt: Date.now(),
    });
  });
}

test("wipePaymentData: rejects unauthenticated callers", async () => {
  const t = convexTest(schema, modules);

  await expect(t.mutation(api.cleanup.wipePaymentData, {})).rejects.toThrow(
    "Unauthorized",
  );
});

test("wipePaymentData: rejects non-admin callers", async () => {
  const t = convexTest(schema, modules);

  const clerkId = "user_student_1";
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: clerkId,
      email: "student@example.com",
      clerkId,
      role: "student",
    });
  });

  await expect(
    t.withIdentity({ subject: clerkId }).mutation(api.cleanup.wipePaymentData, {}),
  ).rejects.toThrow("Forbidden");
});

test("wipePaymentData: admin call empties targets and writes begin + complete audit rows", async () => {
  const t = convexTest(schema, modules);
  const clerkId = await seedAdmin(t);
  await seedWipeTargets(t);

  // Guard against a vacuous test: the seeded rows must exist before the call.
  const before = await t.run(async (ctx) => ({
    orders: (await ctx.db.query("orders").collect()).length,
    payments: (await ctx.db.query("payments").collect()).length,
    workspaces: (await ctx.db.query("workspaces").collect()).length,
    workspaceAuditLogs: (await ctx.db.query("workspaceAuditLogs").collect()).length,
    marketingWaitlist: (await ctx.db.query("marketingWaitlist").collect()).length,
  }));
  expect(before).toEqual({
    orders: 1,
    payments: 1,
    workspaces: 1,
    workspaceAuditLogs: 1,
    marketingWaitlist: 1,
  });

  const result = await t
    .withIdentity({ subject: clerkId })
    .mutation(api.cleanup.wipePaymentData, {});

  expect(result.success).toBe(true);

  // Counts are the real pre-wipe row counts, not zeros.
  expect(result.deleted.orders).toBe(1);
  expect(result.deleted.payments).toBe(1);
  expect(result.deleted.workspaces).toBe(1);
  expect(result.deleted.workspaceAuditLogs).toBe(1);
  expect(result.deleted.marketingWaitlist).toBe(1);

  // Every target table is empty afterwards.
  const after = await t.run(async (ctx) => ({
    orders: (await ctx.db.query("orders").collect()).length,
    payments: (await ctx.db.query("payments").collect()).length,
    workspaces: (await ctx.db.query("workspaces").collect()).length,
    workspaceAuditLogs: (await ctx.db.query("workspaceAuditLogs").collect()).length,
    marketingWaitlist: (await ctx.db.query("marketingWaitlist").collect()).length,
    // `users` is on the preserved list and must survive.
    users: (await ctx.db.query("users").collect()).length,
  }));
  expect(after).toEqual({
    orders: 0,
    payments: 0,
    workspaces: 0,
    workspaceAuditLogs: 0,
    marketingWaitlist: 0,
    users: 1,
  });

  const rows = await t.run(async (ctx) =>
    ctx.db.query("auditLogs").collect(),
  );

  const begin = rows.filter((r) => r.action === "wipe_payment_data_begin");
  const complete = rows.filter((r) => r.action === "wipe_payment_data_complete");

  expect(begin).toHaveLength(1);
  expect(complete).toHaveLength(1);

  // Both rows identify the acting admin and the global system target.
  for (const row of [begin[0], complete[0]]) {
    expect(row.actorId).toBe(clerkId);
    expect(row.actorRole).toBe("admin");
    expect(row.targetType).toBe("system_state");
    expect(row.targetId).toBe("global");
  }

  // The begin row records the table list; the complete row records counts.
  const beginMeta = begin[0].metadata as { tables?: unknown };
  expect(Array.isArray(beginMeta.tables)).toBe(true);
  expect((beginMeta.tables as string[]).length).toBeGreaterThan(0);

  const completeMeta = complete[0].metadata as {
    results?: Record<string, unknown>;
  };
  const results = completeMeta.results ?? {};
  expect(Object.keys(results).length).toBeGreaterThan(0);
  for (const value of Object.values(results)) {
    expect(typeof value).toBe("number");
  }

  // The audit record mirrors the mutation's return value exactly.
  expect(results).toEqual(result.deleted);

  // No customer email, provider payment id, or user id leaked into the audit
  // record. These fixtures are seeded, so this assertion can actually fail.
  const serialized = JSON.stringify(complete[0].metadata);
  expect(serialized).not.toContain(CUSTOMER_EMAIL);
  expect(serialized).not.toContain(PROVIDER_PAYMENT_ID);
  expect(serialized).not.toContain(CUSTOMER_ID);
  expect(serialized).not.toMatch(/sk_|pi_/);
});

test("wipePaymentData: audit rows survive the wipe of workspaceAuditLogs", async () => {
  const t = convexTest(schema, modules);
  const clerkId = await seedAdmin(t);
  await seedWipeTargets(t);

  // `workspaceAuditLogs` is seeded non-empty, otherwise this test would pass
  // even if its delete loop (and the count) were wrong.
  const seededWorkspaceAuditRows = await t.run(async (ctx) =>
    ctx.db.query("workspaceAuditLogs").collect(),
  );
  expect(seededWorkspaceAuditRows).toHaveLength(1);

  await t.withIdentity({ subject: clerkId }).mutation(
    api.cleanup.wipePaymentData,
    {},
  );

  // `auditLogs` is the cross-cutting table and must not be caught by the
  // wipe, unlike `workspaceAuditLogs` which is explicitly cleared.
  const auditRows = await t.run(async (ctx) =>
    ctx.db.query("auditLogs").collect(),
  );
  const workspaceAuditRows = await t.run(async (ctx) =>
    ctx.db.query("workspaceAuditLogs").collect(),
  );

  expect(auditRows.length).toBe(2);
  expect(workspaceAuditRows).toHaveLength(0);
});
