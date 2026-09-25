/// <reference types="vite/client" />
import type { Id } from "./_generated/dataModel";
/**
 * PR workspace-storage-2 (migrate): tests for the backfill path
 * (candidate query, re-entrancy guard, idempotency) and for the
 * `chatFileRetention.ts` cleanup swap (B2 branch + legacy
 * branch).
 *
 * What is NOT tested here:
 *   - The actual B2 PUT/DELETE bytes. Convex test cannot reach
 *     B2, so the integration surface (`putBlobToB2Workspace` and
 *     `deleteFromB2WorkspaceAction`) is exercised in staging.
 *     The candidate query + per-row state-machine logic is
 *     tested below because that is what regresses if the
 *     schema or the grace window drifts.
 *   - The Trigger.dev cron + task. Trigger.dev is exercised
 *     in staging; the cron only calls the same Convex actions
 *     this file tests.
 */
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

async function seedUnmigratedRow(
  t: ReturnType<typeof convexTest>,
  args: {
    workspaceOwnerId: string;
    uploaderId: string;
    uploadedAt: number;
    storageId?: string;
    b2Key?: string;
    migratedAt?: number;
    cancelledAt?: number;
  }
): Promise<string> {
  let workspaceId = "";
  await t.run(async (ctx) => {
    workspaceId = await ctx.db.insert("workspaces", {
      name: "Test Workspace",
      ownerId: args.workspaceOwnerId,
      isPublic: false,
      studentImageCount: 0,
      instructorImageCount: 0,
    });
  });
  let rowId = "";
  await t.run(async (ctx) => {
    let storageId: Id<"_storage"> | undefined = undefined;
    if (args.storageId !== undefined) {
      storageId = await ctx.storage.store(new Blob([`seed:${args.storageId}`]));
    }
    rowId = await ctx.db.insert("fileUploads", {
      workspaceId: workspaceId as any,
      uploaderId: args.uploaderId,
      uploadedAt: args.uploadedAt,
      storageId,
      b2Key: args.b2Key,
      migratedAt: args.migratedAt,
      cancelledAt: args.cancelledAt,
    });
  });
  return rowId;
}

test("listWorkspaceMigrationCandidates respects 7-day grace", async () => {
  const t = convexTest({ schema, modules });
  const now = Date.now();
  const oldRowId = await seedUnmigratedRow(t, {
    workspaceOwnerId: "u_owner_1",
    uploaderId: "u_uploader_1",
    uploadedAt: now - 8 * 24 * 60 * 60 * 1000,
    storageId: "storage_old",
  });
  const recentRowId = await seedUnmigratedRow(t, {
    workspaceOwnerId: "u_owner_1",
    uploaderId: "u_uploader_1",
    uploadedAt: now - 1 * 24 * 60 * 60 * 1000,
    storageId: "storage_recent",
  });

  // With a 7-day grace and a 1-day-old row, the index range
  // `uploadedAt < now - 7d` drops the recent row, so only the
  // 8-day-old row appears.
  const result = await t.query(
    internal.workspaceStorage.listWorkspaceMigrationCandidates,
    {
      graceThreshold: now - SEVEN_DAYS_MS,
      cursor: undefined,
      limit: 50,
    }
  );
  expect(result.rows.map((r) => r._id)).toEqual([oldRowId]);
  void recentRowId;
});

test("listWorkspaceMigrationCandidates skips migrated rows", async () => {
  const t = convexTest({ schema, modules });
  const now = Date.now();
  const migratedId = await seedUnmigratedRow(t, {
    workspaceOwnerId: "u_owner_1",
    uploaderId: "u_uploader_1",
    uploadedAt: now - 8 * 24 * 60 * 60 * 1000,
    storageId: "storage_migrated",
    b2Key: "migrated/key",
    migratedAt: now - 1 * 60 * 60 * 1000,
  });
  const unmigratedId = await seedUnmigratedRow(t, {
    workspaceOwnerId: "u_owner_1",
    uploaderId: "u_uploader_1",
    uploadedAt: now - 8 * 24 * 60 * 60 * 1000,
    storageId: "storage_unmigrated",
  });
  const result = await t.query(
    internal.workspaceStorage.listWorkspaceMigrationCandidates,
    {
      graceThreshold: now - SEVEN_DAYS_MS,
      cursor: undefined,
      limit: 50,
    }
  );
  expect(result.rows.map((r) => r._id)).toEqual([unmigratedId]);
  void migratedId;
});

test("listWorkspaceMigrationCandidates skips cancelled rows", async () => {
  const t = convexTest({ schema, modules });
  const now = Date.now();
  const cancelledId = await seedUnmigratedRow(t, {
    workspaceOwnerId: "u_owner_1",
    uploaderId: "u_uploader_1",
    uploadedAt: now - 8 * 24 * 60 * 60 * 1000,
    storageId: "storage_cancelled",
    cancelledAt: now - 1 * 60 * 60 * 1000,
  });
  const unmigratedId = await seedUnmigratedRow(t, {
    workspaceOwnerId: "u_owner_1",
    uploaderId: "u_uploader_1",
    uploadedAt: now - 8 * 24 * 60 * 60 * 1000,
    storageId: "storage_unmigrated",
  });
  const result = await t.query(
    internal.workspaceStorage.listWorkspaceMigrationCandidates,
    {
      graceThreshold: now - SEVEN_DAYS_MS,
      cursor: undefined,
      limit: 50,
    }
  );
  expect(result.rows.map((r) => r._id)).toEqual([unmigratedId]);
  void cancelledId;
});

test("markLedgerMigrated is idempotent on repeat", async () => {
  const t = convexTest({ schema, modules });
  const now = Date.now();
  const rowId = await seedUnmigratedRow(t, {
    workspaceOwnerId: "u_owner_1",
    uploaderId: "u_uploader_1",
    uploadedAt: now - 8 * 24 * 60 * 60 * 1000,
    storageId: "storage_for_idempotency",
  });

  const first = await t.mutation(
    internal.workspaceStorage.markLedgerMigrated,
    {
      id: rowId as any,
      b2Key: "first/key",
      migratedAt: now,
    }
  );
  expect(first).toEqual({ alreadyMigrated: false });

  const second = await t.mutation(
    internal.workspaceStorage.markLedgerMigrated,
    {
      id: rowId as any,
      b2Key: "second/key",
      migratedAt: now + 1000,
    }
  );
  expect(second).toEqual({ alreadyMigrated: true });

  // Verify the original b2Key survived.
  const stored = await t.run(async (ctx) => ctx.db.get(rowId as any));
  expect((stored as any).b2Key).toBe("first/key");
});

test("stampBackfillSchedule re-entrancy guard", async () => {
  const t = convexTest({ schema, modules });
  const now = Date.now();
  await seedUnmigratedRow(t, {
    workspaceOwnerId: "u_owner_1",
    uploaderId: "u_uploader_1",
    uploadedAt: now - 8 * 24 * 60 * 60 * 1000,
    storageId: "storage_for_stamp",
  });

  // First stamp sets scheduledBackfillAt.
  const first = await t.mutation(
    internal.workspaceStorage.stampBackfillSchedule,
    { scheduledAt: now }
  );
  expect(first).toEqual({ stamped: true });

  // Second stamp within the dedup window returns stamped: false.
  const dedup = await t.mutation(
    internal.workspaceStorage.stampBackfillSchedule,
    { scheduledAt: now + 60 * 1000 }
  );
  expect(dedup).toEqual({ stamped: false });
});

test("getMigrationTargetById returns row when present", async () => {
  const t = convexTest({ schema, modules });
  const now = Date.now();
  const rowId = await seedUnmigratedRow(t, {
    workspaceOwnerId: "u_owner_1",
    uploaderId: "u_uploader_1",
    uploadedAt: now - 8 * 24 * 60 * 60 * 1000,
    storageId: "storage_for_target",
  });
  const target = await t.query(
    internal.workspaceStorage.getMigrationTargetById,
    { id: rowId as any }
  );
  expect(target).not.toBeNull();
  expect(target?._id).toBe(rowId);
  expect(target?.storageId).not.toBeUndefined();
  expect(target?.b2Key).toBeUndefined();
  expect(target?.migratedAt).toBeUndefined();
});

test("getMigrationTargetById returns null when missing", async () => {
  const t = convexTest({ schema, modules });
  // Insert + delete to get a valid id format.
  const now = Date.now();
  const rowId = await seedUnmigratedRow(t, {
    workspaceOwnerId: "u_owner_1",
    uploaderId: "u_uploader_1",
    uploadedAt: now - 8 * 24 * 60 * 60 * 1000,
    storageId: "storage_short_lived",
  });
  await t.run(async (ctx) => {
    await ctx.db.delete(rowId as any);
  });
  const target = await t.query(
    internal.workspaceStorage.getMigrationTargetById,
    { id: rowId as any }
  );
  expect(target).toBeNull();
});

test("forceDeleteExpiredChatMessageRow preserves migrated ledger rows", async () => {
  const t = convexTest({ schema, modules });
  const now = Date.now();
  let workspaceId = "";
  let messageId = "";
  let ledgerId = "";
  await t.run(async (ctx) => {
    workspaceId = await ctx.db.insert("workspaces", {
      name: "Test WS",
      ownerId: "u_owner_1",
      isPublic: false,
      studentImageCount: 0,
      instructorImageCount: 0,
    });
    const storageId = await ctx.storage.store(new Blob(["migrated chat bytes"]));
    messageId = await ctx.db.insert("workspaceMessages", {
      workspaceId: workspaceId as any,
      userId: "u_uploader_1",
      content: "image",
      type: "image",
      storageId,
      b2Key: "migrated/chat/key",
      deletedAt: now - 31 * 24 * 60 * 60 * 1000,
    });
    ledgerId = await ctx.db.insert("fileUploads", {
      workspaceId: workspaceId as any,
      uploaderId: "u_uploader_1",
      uploadedAt: now - 8 * 24 * 60 * 60 * 1000,
      storageId,
      b2Key: "migrated/chat/key",
      completedAt: now - 7 * 24 * 60 * 60 * 1000,
      migratedAt: now - 7 * 24 * 60 * 60 * 1000,
    });
  });

  await t.mutation(
    internal.cleanup.chatFileRetention.forceDeleteExpiredChatMessageRow,
    { messageId: messageId as any }
  );

  // Chat message is gone.
  const chatAfter = await t.run(async (ctx) => ctx.db.get(messageId as any));
  expect(chatAfter).toBeNull();

  // Ledger row SURVIVED because the message had `b2Key !==
  // undefined`. The download action resolves the workspace that
  // owns a `b2Key` through the ledger; deleting it here would
  // break `getWorkspaceDownloadUrl` until PR 3.
  const ledgerAfter = await t.run(async (ctx) => ctx.db.get(ledgerId as any));
  expect(ledgerAfter).not.toBeNull();
  expect((ledgerAfter as any).b2Key).toBe("migrated/chat/key");
});

test("forceDeleteExpiredChatMessageRow removes legacy ledger rows", async () => {
  const t = convexTest({ schema, modules });
  const now = Date.now();
  let workspaceId = "";
  let messageId = "";
  let ledgerId = "";
  await t.run(async (ctx) => {
    workspaceId = await ctx.db.insert("workspaces", {
      name: "Legacy WS",
      ownerId: "u_owner_1",
      isPublic: false,
      studentImageCount: 0,
      instructorImageCount: 0,
    });
    const storageId = await ctx.storage.store(new Blob(["legacy chat bytes"]));
    messageId = await ctx.db.insert("workspaceMessages", {
      workspaceId: workspaceId as any,
      userId: "u_uploader_1",
      content: "image",
      type: "image",
      storageId,
      deletedAt: now - 31 * 24 * 60 * 60 * 1000,
    });
    ledgerId = await ctx.db.insert("fileUploads", {
      workspaceId: workspaceId as any,
      uploaderId: "u_uploader_1",
      uploadedAt: now - 8 * 24 * 60 * 60 * 1000,
      storageId,
    });
  });

  await t.mutation(
    internal.cleanup.chatFileRetention.forceDeleteExpiredChatMessageRow,
    { messageId: messageId as any }
  );

  // Both the chat message and the legacy ledger row are gone.
  const chatAfter = await t.run(async (ctx) => ctx.db.get(messageId as any));
  expect(chatAfter).toBeNull();
  const ledgerAfter = await t.run(async (ctx) => ctx.db.get(ledgerId as any));
  expect(ledgerAfter).toBeNull();
});
