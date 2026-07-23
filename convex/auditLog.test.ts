/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

/**
 * Smoke test for `writeAuditLog` + `listAuditLogs`.
 *
 * Covers:
 *   - In-mutation write via the helper
 *   - Cross-call write via `internal.auditLog.recordAuditLog`
 *   - Admin read filters (actorId, action, targetType)
 *   - Non-admin caller denied
 *
 * This is the safety net for the secret-removal follow-up PR: any
 * regression in the write path will be caught here, not in prod.
 */
test("auditLogs: write + list round-trip with admin filters", async () => {
  const t = convexTest(schema, modules);

  const adminUserId = "user_admin_1";
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: adminUserId,
      email: "admin@example.com",
      clerkId: adminUserId,
      role: "admin",
    });
  });

  const adminClient = t.withIdentity({ subject: adminUserId });

  // Two writes from different actors.
  await adminClient.mutation(internal.auditLog.recordAuditLog, {
    actorId: "user_admin_1",
    actorRole: "admin",
    action: "create_hd_invitation",
    targetType: "hdInvitation",
    targetId: "inv_1",
    details: "Invited foo@example.com as instructor",
  });

  await adminClient.mutation(internal.auditLog.recordAuditLog, {
    actorId: "system",
    actorRole: "system",
    action: "create_user_from_invitation",
    targetType: "user",
    targetId: "user_new_1",
    details: "User created from invitation inv_1",
  });

  // List all.
  const all = await adminClient.query(api.auditLog.listAuditLogs, {
    paginationOpts: { numItems: 50 },
  });
  expect(all.page).toHaveLength(2);

  // Filter by actorId.
  const byActor = await adminClient.query(api.auditLog.listAuditLogs, {
    paginationOpts: { numItems: 50 },
    actorId: "user_admin_1",
  });
  expect(byActor.page).toHaveLength(1);
  expect(byActor.page[0]?.action).toBe("create_hd_invitation");

  // Filter by action.
  const byAction = await adminClient.query(api.auditLog.listAuditLogs, {
    paginationOpts: { numItems: 50 },
    action: "create_user_from_invitation",
  });
  expect(byAction.page).toHaveLength(1);
  expect(byAction.page[0]?.targetType).toBe("user");

  // Filter by targetType + targetId.
  const byTarget = await adminClient.query(api.auditLog.listAuditLogs, {
    paginationOpts: { numItems: 50 },
    targetType: "hdInvitation",
    targetId: "inv_1",
  });
  expect(byTarget.page).toHaveLength(1);
});

test("auditLogs.listAuditLogs: non-admin caller is rejected", async () => {
  const t = convexTest(schema, modules);

  const instructorUserId = "user_instructor_1";
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: instructorUserId,
      email: "instructor@example.com",
      clerkId: instructorUserId,
      role: "instructor",
    });
  });

  const instructorClient = t.withIdentity({ subject: instructorUserId });

  await expect(
    instructorClient.query(api.auditLog.listAuditLogs, {
      paginationOpts: { numItems: 50 },
    })
  ).rejects.toThrow(/Admin or support role required/);
});

test("auditLogs.listAuditLogs: unauthenticated caller returns empty", async () => {
  const t = convexTest(schema, modules);

  const result = await t.query(api.auditLog.listAuditLogs, {
    paginationOpts: { numItems: 50 },
  });
  expect(result.page).toHaveLength(0);
  expect(result.isDone).toBe(true);
});

test("auditLogs.listAuditLogs: rejects combined filters instead of silently dropping", async () => {
  const t = convexTest(schema, modules);

  const adminUserId = "user_admin_combined";
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: adminUserId,
      email: "admin3@example.com",
      clerkId: adminUserId,
      role: "admin",
    });
  });

  const adminClient = t.withIdentity({ subject: adminUserId });

  await expect(
    adminClient.query(api.auditLog.listAuditLogs, {
      paginationOpts: { numItems: 50 },
      actorId: "user_a",
      action: "some_action",
    })
  ).rejects.toThrow(/supports a single filter/i);

  await expect(
    adminClient.query(api.auditLog.listAuditLogs, {
      paginationOpts: { numItems: 50 },
      targetType: "user",
      targetId: "user_a",
    })
  ).resolves.toBeDefined();

  await expect(
    adminClient.query(api.auditLog.listAuditLogs, {
      paginationOpts: { numItems: 50 },
      targetId: "user_a",
    })
  ).rejects.toThrow(/targetId requires targetType/);
});

test("auditLogs.listAuditLogs: multi-page compound-target pagination advances", async () => {
  const t = convexTest(schema, modules);

  const adminUserId = "user_admin_pagination";
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: adminUserId,
      email: "admin2@example.com",
      clerkId: adminUserId,
      role: "admin",
    });
  });

  const adminClient = t.withIdentity({ subject: adminUserId });

  const TARGET = "pagination_target_1";
  await t.run(async (ctx) => {
    const baseTime = 1_700_000_000_000;
    for (let i = 0; i < 75; i++) {
      await ctx.db.insert("auditLogs", {
        actorId: "system",
        actorRole: "system",
        action: `test_action_${i}`,
        targetType: "testTarget",
        targetId: TARGET,
        details: `row ${i}`,
        timestamp: baseTime + i,
      });
    }
  });

  const page1 = await adminClient.query(api.auditLog.listAuditLogs, {
    paginationOpts: { numItems: 30 },
    targetType: "testTarget",
    targetId: TARGET,
  });
  expect(page1.page).toHaveLength(30);
  expect(page1.isDone).toBe(false);
  expect(page1.continueCursor).not.toBeNull();
  expect(page1.page[0]?.action).toBe("test_action_74");
  expect(page1.page[29]?.action).toBe("test_action_45");

  const page2 = await adminClient.query(api.auditLog.listAuditLogs, {
    paginationOpts: { numItems: 30, cursor: page1.continueCursor },
    targetType: "testTarget",
    targetId: TARGET,
  });
  expect(page2.page).toHaveLength(30);
  expect(page2.isDone).toBe(false);
  expect(page2.continueCursor).not.toBeNull();
  expect(page2.page[0]?.action).toBe("test_action_44");
  expect(page2.page[29]?.action).toBe("test_action_15");

  const page3 = await adminClient.query(api.auditLog.listAuditLogs, {
    paginationOpts: { numItems: 30, cursor: page2.continueCursor },
    targetType: "testTarget",
    targetId: TARGET,
  });
  expect(page3.page).toHaveLength(15);
  expect(page3.isDone).toBe(true);
  expect(page3.page[0]?.action).toBe("test_action_14");
  expect(page3.page[14]?.action).toBe("test_action_0");

  const allActions = [
    ...page1.page.map((r) => r.action),
    ...page2.page.map((r) => r.action),
    ...page3.page.map((r) => r.action),
  ];
  expect(new Set(allActions).size).toBe(75);
});
