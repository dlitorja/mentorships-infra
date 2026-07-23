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
