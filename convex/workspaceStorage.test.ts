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

test("stampBackfillSchedule heartbeat is a low-cost marker (Greptile round 27 P1)", async () => {
  const t = convexTest({ schema, modules });
  const now = Date.now();
  const rowId = await seedUnmigratedRow(t, {
    workspaceOwnerId: "u_owner_1",
    uploaderId: "u_uploader_1",
    uploadedAt: now - 8 * 24 * 60 * 60 * 1000,
    storageId: "storage_for_stamp",
  });

  // First stamp sets scheduledBackfillAt on the oldest candidate.
  const first = await t.mutation(
    internal.workspaceStorage.stampBackfillSchedule,
    { scheduledAt: now }
  );
  expect(first).toEqual({ stamped: true });

  // Second stamp also succeeds (no longer a dedup guard — the
  // cron's re-entrancy model is now "Trigger.dev schedule +
  // per-row idempotency", so the stamp is a heartbeat that
  // must NOT gate the sweep).
  const second = await t.mutation(
    internal.workspaceStorage.stampBackfillSchedule,
    { scheduledAt: now + 60 * 1000 }
  );
  expect(second).toEqual({ stamped: true });

  // Verify the stamp landed on a row.
  const stored = await t.run(async (ctx) => ctx.db.get(rowId as any));
  expect((stored as any).scheduledBackfillAt).toBe(now + 60 * 1000);
});

test("acquireMigrationLock succeeds when row is unmigrated", async () => {
  const t = convexTest({ schema, modules });
  const now = Date.now();
  const rowId = await seedUnmigratedRow(t, {
    workspaceOwnerId: "u_owner_1",
    uploaderId: "u_uploader_1",
    uploadedAt: now - 8 * 24 * 60 * 60 * 1000,
    storageId: "storage_for_lock",
  });

  const result = await t.mutation(
    internal.workspaceStorage.acquireMigrationLock,
    { id: rowId as any, lockAt: now }
  );
  expect(result).toEqual({ locked: true, tookOverStaleLock: false });

  // The lock timestamp is on the row.
  const stored = await t.run(async (ctx) => ctx.db.get(rowId as any));
  expect((stored as any).migratedAt).toBe(now);
  expect((stored as any).b2Key).toBeUndefined();
});

test("acquireMigrationLock refuses already-locked rows", async () => {
  const t = convexTest({ schema, modules });
  const now = Date.now();
  const rowId = await seedUnmigratedRow(t, {
    workspaceOwnerId: "u_owner_1",
    uploaderId: "u_uploader_1",
    uploadedAt: now - 8 * 24 * 60 * 60 * 1000,
    storageId: "storage_for_concurrent_lock",
    migratedAt: now - 5 * 60 * 1000, // another trigger already locked (still recent, under STALE_MIGRATION_LOCK_MS)
  });

  const result = await t.mutation(
    internal.workspaceStorage.acquireMigrationLock,
    { id: rowId as any, lockAt: now }
  );
  expect(result).toEqual({ locked: false, tookOverStaleLock: false });

  // The pre-existing migratedAt survived.
  const stored = await t.run(async (ctx) => ctx.db.get(rowId as any));
  expect((stored as any).migratedAt).toBe(now - 5 * 60 * 1000);
});

test("acquireMigrationLock refuses already-migrated rows", async () => {
  const t = convexTest({ schema, modules });
  const now = Date.now();
  const rowId = await seedUnmigratedRow(t, {
    workspaceOwnerId: "u_owner_1",
    uploaderId: "u_uploader_1",
    uploadedAt: now - 8 * 24 * 60 * 60 * 1000,
    storageId: "storage_already_migrated",
    b2Key: "done/key",
    migratedAt: now - 5 * 60 * 1000,
  });

  const result = await t.mutation(
    internal.workspaceStorage.acquireMigrationLock,
    { id: rowId as any, lockAt: now }
  );
  expect(result).toEqual({ locked: false, tookOverStaleLock: false });
});

test("releaseMigrationLock clears the lock when PUT fails", async () => {
  const t = convexTest({ schema, modules });
  const now = Date.now();
  const rowId = await seedUnmigratedRow(t, {
    workspaceOwnerId: "u_owner_1",
    uploaderId: "u_uploader_1",
    uploadedAt: now - 8 * 24 * 60 * 60 * 1000,
    storageId: "storage_for_release",
    migratedAt: now, // lock in place
  });

  await t.mutation(
    internal.workspaceStorage.releaseMigrationLock,
    { id: rowId as any }
  );

  const stored = await t.run(async (ctx) => ctx.db.get(rowId as any));
  expect((stored as any).migratedAt).toBeUndefined();
});

test("releaseMigrationLock does NOT clear an already-migrated row", async () => {
  const t = convexTest({ schema, modules });
  const now = Date.now();
  const rowId = await seedUnmigratedRow(t, {
    workspaceOwnerId: "u_owner_1",
    uploaderId: "u_uploader_1",
    uploadedAt: now - 8 * 24 * 60 * 60 * 1000,
    storageId: "storage_for_release_with_b2key",
    b2Key: "successful/key",
    migratedAt: now - 5 * 60 * 1000,
  });

  await t.mutation(
    internal.workspaceStorage.releaseMigrationLock,
    { id: rowId as any }
  );

  // Both b2Key + migratedAt survived (this is a successful
  // migration, not a failed PUT — release is a no-op).
  const stored = await t.run(async (ctx) => ctx.db.get(rowId as any));
  expect((stored as any).b2Key).toBe("successful/key");
  expect((stored as any).migratedAt).toBe(now - 5 * 60 * 1000);
});

test("propagateMigratedB2KeyToMessages patches sharing chat rows", async () => {
  const t = convexTest({ schema, modules });
  const now = Date.now();
  let workspaceId = "";
  let storageId: Id<"_storage"> | undefined = undefined;
  let messageId = "";
  await t.run(async (ctx) => {
    workspaceId = await ctx.db.insert("workspaces", {
      name: "Test WS",
      ownerId: "u_owner_1",
      isPublic: false,
      studentImageCount: 0,
      instructorImageCount: 0,
    });
    storageId = await ctx.storage.store(new Blob(["shared bytes"]));
    messageId = await ctx.db.insert("workspaceMessages", {
      workspaceId: workspaceId as any,
      userId: "u_uploader_1",
      content: "image",
      type: "image",
      storageId,
    });
  });

  await t.mutation(
    internal.workspaceStorage.propagateMigratedB2KeyToMessages,
    { storageId: storageId as any, b2Key: "migrated/share/key" }
  );

  const msgAfter = await t.run(async (ctx) => ctx.db.get(messageId as any));
  expect((msgAfter as any).b2Key).toBe("migrated/share/key");
});

test("propagateMigratedB2KeyToMessages skips already-matched rows", async () => {
  const t = convexTest({ schema, modules });
  const now = Date.now();
  let workspaceId = "";
  let storageId: Id<"_storage"> | undefined = undefined;
  let messageId = "";
  await t.run(async (ctx) => {
    workspaceId = await ctx.db.insert("workspaces", {
      name: "Test WS",
      ownerId: "u_owner_1",
      isPublic: false,
      studentImageCount: 0,
      instructorImageCount: 0,
    });
    storageId = await ctx.storage.store(new Blob(["already propagated"]));
    messageId = await ctx.db.insert("workspaceMessages", {
      workspaceId: workspaceId as any,
      userId: "u_uploader_1",
      content: "image",
      type: "image",
      storageId,
      b2Key: "already/set/key",
    });
  });

  const result = await t.mutation(
    internal.workspaceStorage.propagateMigratedB2KeyToMessages,
    { storageId: storageId as any, b2Key: "already/set/key" }
  );
  expect(result.patched).toBe(0);

  const msgAfter = await t.run(async (ctx) => ctx.db.get(messageId as any));
  expect((msgAfter as any).b2Key).toBe("already/set/key");
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

test("forceDeleteExpiredChatMessageRow deletes mid-migration ledger rows (Greptile round 28 P1)", async () => {
  // Round 28 P1 fix: the round 27 implementation preserved
  // the ledger when the migration was mid-flight
  // (`migratedAt !== undefined && b2Key === undefined`) so
  // the migration action could finish its PUT and then call
  // `propagateMigratedB2KeyToMessages` to copy the B2 key
  // onto chat rows still referencing the same blob. With
  // the chat row already deleted, propagate finds zero
  // matching `workspaceMessages` and the B2 object lives on
  // without a chat-row pointer — silent per-row orphan.
  //
  // Round 28 deletes the ledger in the mid-migration case
  // so any B2 object the migration still writes is orphaned
  // in a controllable way (PR 3's lifecycle rule sweeps by
  // `workspaceId + uploadedAt` age).
  const t = convexTest({ schema, modules });
  const now = Date.now();
  let workspaceId = "";
  let messageId = "";
  let ledgerId = "";
  await t.run(async (ctx) => {
    workspaceId = await ctx.db.insert("workspaces", {
      name: "Mid-Migration WS",
      ownerId: "u_owner_1",
      isPublic: false,
      studentImageCount: 0,
      instructorImageCount: 0,
    });
    const storageId = await ctx.storage.store(new Blob(["in-flight bytes"]));
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
      // Mid-migration: lock acquired, PUT in flight, no b2Key yet.
      migratedAt: now - 100,
    });
  });

  await t.mutation(
    internal.cleanup.chatFileRetention.forceDeleteExpiredChatMessageRow,
    { messageId: messageId as any }
  );

  // Chat message is gone (the chat-side state is unrecoverable
  // anyway once `deletedAt` is in the past).
  const chatAfter = await t.run(async (ctx) => ctx.db.get(messageId as any));
  expect(chatAfter).toBeNull();

  // Ledger row is DELETED — round 28 fix. The migration
  // action's downstream PUT, if it completes, will orphan a
  // B2 object that PR 3's lifecycle rule sweeps.
  const ledgerAfter = await t.run(async (ctx) => ctx.db.get(ledgerId as any));
  expect(ledgerAfter).toBeNull();
});

test("forceDeleteExpiredChatMessageRow preserves migrated ledger rows (chat row already has b2Key)", async () => {
  // Round 28 keeps the round 27 preservation when the chat
  // row's own `b2Key` is set. In that case the chat-side
  // retention path is responsible for the B2 object, and
  // deleting the ledger would orphan a B2 object that the
  // retention flow expects to find.
  const t = convexTest({ schema, modules });
  const now = Date.now();
  let workspaceId = "";
  let messageId = "";
  let ledgerId = "";
  await t.run(async (ctx) => {
    workspaceId = await ctx.db.insert("workspaces", {
      name: "Migrated Chat WS",
      ownerId: "u_owner_1",
      isPublic: false,
      studentImageCount: 0,
      instructorImageCount: 0,
    });
    const storageId = await ctx.storage.store(new Blob(["migrated bytes"]));
    messageId = await ctx.db.insert("workspaceMessages", {
      workspaceId: workspaceId as any,
      userId: "u_uploader_1",
      content: "image",
      type: "image",
      storageId,
      b2Key: "workspace/owner/migrated/key",
      deletedAt: now - 31 * 24 * 60 * 60 * 1000,
    });
    ledgerId = await ctx.db.insert("fileUploads", {
      workspaceId: workspaceId as any,
      uploaderId: "u_uploader_1",
      uploadedAt: now - 8 * 24 * 60 * 60 * 1000,
      storageId,
      b2Key: "workspace/owner/migrated/key",
      migratedAt: now - 100,
      completedAt: now - 100,
    });
  });

  await t.mutation(
    internal.cleanup.chatFileRetention.forceDeleteExpiredChatMessageRow,
    { messageId: messageId as any }
  );

  // Chat message is gone.
  const chatAfter = await t.run(async (ctx) => ctx.db.get(messageId as any));
  expect(chatAfter).toBeNull();

  // Ledger row SURVIVED — chat row's b2Key implies the B2
  // object is still referenced for downstream cleanup.
  const ledgerAfter = await t.run(async (ctx) => ctx.db.get(ledgerId as any));
  expect(ledgerAfter).not.toBeNull();
  expect((ledgerAfter as any).b2Key).toBe("workspace/owner/migrated/key");
});

test("markLedgerMigrated writes b2Key when lock is held (Greptile round 28 P1)", async () => {
  // Round 28 P1 fix: round 27's `markLedgerMigrated` short-
  // circuited on `migratedAt !== undefined`, but the
  // round 27 `acquireMigrationLock` sets `migratedAt`
  // BEFORE the B2 PUT. That made every successful PUT leave
  // its B2 copy unrecorded on the ledger and the row was
  // permanently excluded from the candidate query.
  // Idempotency now keys off `b2Key` alone.
  const t = convexTest({ schema, modules });
  const now = Date.now();
  const rowId = await seedUnmigratedRow(t, {
    workspaceOwnerId: "u_owner_1",
    uploaderId: "u_uploader_1",
    uploadedAt: now - 8 * 24 * 60 * 60 * 1000,
    storageId: "storage_for_post_lock_finalize",
    // Lock in place — round 27 finalize would short-circuit here.
    migratedAt: now - 30 * 1000,
  });

  const result = await t.mutation(
    internal.workspaceStorage.markLedgerMigrated,
    {
      id: rowId as any,
      b2Key: "workspace/owner/post-lock/key",
      migratedAt: now,
    }
  );
  expect(result).toEqual({ alreadyMigrated: false });

  const stored = await t.run(async (ctx) => ctx.db.get(rowId as any));
  expect((stored as any).b2Key).toBe("workspace/owner/post-lock/key");
  expect((stored as any).migratedAt).toBe(now);
  expect((stored as any).completedAt).toBe(now);
});

test("acquireMigrationLock takes over stale locks (Greptile round 28 P1)", async () => {
  // Round 28 P1 fix: an action that crashes or restarts
  // AFTER acquiring the lock but BEFORE finishing the PUT
  // leaves `migratedAt` set without `b2Key`. Without stale
  // takeover, the candidate query excludes the row and a
  // retry sees `migratedAt !== undefined` and short-circuits,
  // permanently disabling the row.
  const t = convexTest({ schema, modules });
  const now = Date.now();
  const staleLockAt = now - 2 * 60 * 60 * 1000; // 2 h ago, well over 1 h threshold
  const rowId = await seedUnmigratedRow(t, {
    workspaceOwnerId: "u_owner_1",
    uploaderId: "u_uploader_1",
    uploadedAt: now - 8 * 24 * 60 * 60 * 1000,
    storageId: "storage_for_stale_lock_takeover",
    migratedAt: staleLockAt,
  });

  const result = await t.mutation(
    internal.workspaceStorage.acquireMigrationLock,
    { id: rowId as any, lockAt: now }
  );
  expect(result).toEqual({ locked: true, tookOverStaleLock: true });

  const stored = await t.run(async (ctx) => ctx.db.get(rowId as any));
  expect((stored as any).migratedAt).toBe(now);
  expect((stored as any).b2Key).toBeUndefined();
});

test("acquireMigrationLock refuses recent locks within STALE_MIGRATION_LOCK_MS", async () => {
  // Round 28: locks that are recent (within the stale
  // threshold) must still be refused — the previous action
  // is still legitimately running.
  const t = convexTest({ schema, modules });
  const now = Date.now();
  const recentLockAt = now - 30 * 60 * 1000; // 30 min ago, under 1 h threshold
  const rowId = await seedUnmigratedRow(t, {
    workspaceOwnerId: "u_owner_1",
    uploaderId: "u_uploader_1",
    uploadedAt: now - 8 * 24 * 60 * 60 * 1000,
    storageId: "storage_for_recent_lock_refusal",
    migratedAt: recentLockAt,
  });

  const result = await t.mutation(
    internal.workspaceStorage.acquireMigrationLock,
    { id: rowId as any, lockAt: now }
  );
  expect(result).toEqual({ locked: false, tookOverStaleLock: false });

  const stored = await t.run(async (ctx) => ctx.db.get(rowId as any));
  expect((stored as any).migratedAt).toBe(recentLockAt);
});
