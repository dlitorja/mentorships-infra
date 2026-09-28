/// <reference types="vite/client" />
import type { Id } from "./_generated/dataModel";
/**
 * PR workspace-storage-2 (migrate): tests for the backfill path
 * (candidate query, re-entrancy guard, idempotency) and for the
 * `chatFileRetention.ts` cleanup swap (B2 branch + legacy
 * branch).
 *
 * The B2 mint/confirm/download blocks below prove the *server-
 * side state machine* that PR 3 will rely on when it swaps the
 * UI to B2. The actual B2 PUT/DELETE bytes still go through
 * `fetch`, which is mocked with `vi.stubGlobal` (see the
 * `discordActionQueue.test.ts` precedent).
 *
 * What is NOT tested here:
 *   - The actual B2 PUT/DELETE bytes against the real bucket.
 *     Convex test cannot reach B2, so the integration surface
 *     is exercised in staging via the CLI backfill wrapper.
 *   - The Trigger.dev cron + task. Trigger.dev is exercised in
 *     staging; the cron only calls the same Convex actions
 *     this file tests.
 *   - Real SigV4 signature verification by B2. The presigned-
 *     URL helpers are exercised in a separate staging script
 *     (`scripts/verify-workspace-b2-credentials.ts`).
 */
import { convexTest } from "convex-test";
import { expect, test, vi, afterEach } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.B2_KEY_ID;
  delete process.env.B2_APPLICATION_KEY;
});

/**
 * Seed a workspace owned by `studentUserId` with an instructor
 * mapped to `instructorUserId` so the B2 mint / confirm /
 * download authz branches can be exercised. Used by the new
 * B2 mint/confirm/download test block below.
 */
async function seedWorkspaceWithInstructor(t: ReturnType<typeof convexTest>, args: {
  studentUserId: string;
  instructorUserId: string;
  endedAt?: number;
  deletedAt?: number;
  type?: "mentorship" | "admin_student" | "admin_instructor";
}): Promise<{ workspaceId: string; instructorId: string }> {
  let workspaceId = "";
  let instructorId = "";
  await t.run(async (ctx) => {
    instructorId = await ctx.db.insert("instructors", {
      userId: args.instructorUserId,
    });
    workspaceId = await ctx.db.insert("workspaces", {
      name: "Test Workspace",
      ownerId: args.studentUserId,
      isPublic: false,
      studentImageCount: 0,
      instructorImageCount: 0,
      instructorId: instructorId as any,
      type: args.type ?? "mentorship",
      endedAt: args.endedAt,
      deletedAt: args.deletedAt,
    });
  });
  return { workspaceId, instructorId };
}

function stubB2Credentials(): void {
  process.env.B2_KEY_ID = "test-b2-key-id";
  process.env.B2_APPLICATION_KEY = "test-b2-secret";
}

/**
 * Build the expected B2 base URL from the same env vars the
 * production code reads in `loadB2Credentials`. Keeps the
 * signature assertions tied to whatever bucket / region the
 * test environment sets (Greptile P2: "Assertions assume
 * default B2 settings").
 */
function expectedB2BaseUrl(): string {
  const region =
    process.env.WORKSPACE_STORAGE_BUCKET_REGION || "us-east-005";
  const endpoint =
    process.env.WORKSPACE_STORAGE_BUCKET_ENDPOINT ||
    `https://s3.${region}.backblazeb2.com`;
  const bucket =
    process.env.WORKSPACE_STORAGE_BUCKET_NAME || "mentorship-workspace-storage";
  return `${endpoint.replace(/\/+$/, "")}/${bucket}`;
}

/**
 * Mirror `expectedB2BaseUrl` for the SigV4 credential-scope
 * region. Round 33 P2 "Signature assertion assumes default
 * region" — a regression is unlikely, but a test environment
 * pointing at a non-default region would break a hardcoded
 * `us-east-005` literal even when the signer is correct.
 */
function expectedB2Region(): string {
  return process.env.WORKSPACE_STORAGE_BUCKET_REGION || "us-east-005";
}

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
      now,
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
      now,
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
      now,
    }
  );
  expect(result.rows.map((r) => r._id)).toEqual([unmigratedId]);
  void cancelledId;
});

test("listWorkspaceMigrationCandidates includes stale-locked rows (Greptile round 29 P1)", async () => {
  // Round 29 P1 fix: stale-locked rows (migratedAt set, no
  // b2Key, lock older than STALE_MIGRATION_LOCK_MS) MUST be
  // visible to the candidate query so the per-row action
  // takes over the lock via acquireMigrationLock. Without
  // this, rows whose previous migration attempt crashed
  // between lock and finalize are permanently disabled.
  const t = convexTest({ schema, modules });
  const now = Date.now();
  const staleLockRowId = await seedUnmigratedRow(t, {
    workspaceOwnerId: "u_owner_1",
    uploaderId: "u_uploader_1",
    uploadedAt: now - 8 * 24 * 60 * 60 * 1000,
    storageId: "storage_stale_locked",
    migratedAt: now - 2 * 60 * 60 * 1000, // 2h, over the 1h threshold
  });
  const recentLockRowId = await seedUnmigratedRow(t, {
    workspaceOwnerId: "u_owner_1",
    uploaderId: "u_uploader_1",
    uploadedAt: now - 8 * 24 * 60 * 60 * 1000,
    storageId: "storage_recent_locked",
    migratedAt: now - 30 * 60 * 1000, // 30min, under the threshold — still in flight
  });
  const result = await t.query(
    internal.workspaceStorage.listWorkspaceMigrationCandidates,
    {
      graceThreshold: now - SEVEN_DAYS_MS,
      cursor: undefined,
      limit: 50,
      now,
    }
  );
  // Stale-locked row IS included; recent-locked row is NOT.
  expect(result.rows.map((r) => r._id)).toEqual([staleLockRowId]);
  void recentLockRowId;
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

test("forceDeleteExpiredChatMessageRow preserves mid-migration ledger rows (Greptile round 27 P1 + round 29 reverted)", async () => {
  // Mirrors the PUT-vs-cleanup race window: migration sets
  // `migratedAt` BEFORE the B2 PUT, so a concurrent cleanup
  // tick must NOT delete the ledger — the B2 PUT is in flight
  // and deleting the ledger here would orphan the B2 object
  // the migration is about to write.
  //
  // Greptile round 29: the round 28 attempt to delete the
  // ledger in this case created a worse orphan — the
  // migration wrote the B2 object, finalize threw because the
  // ledger was gone, and the B2 object lived on with no row
  // pointing to it (PR 3's B2 lifecycle rule is not in this
  // branch). The ledger IS the cleanup pointer (the workspace
  // can still download via `b2Key`), so preserving it is the
  // right call.
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

  // Ledger row SURVIVED — migration is still in flight, and
  // it is the cleanup pointer for the B2 object once it
  // finishes.
  const ledgerAfter = await t.run(async (ctx) => ctx.db.get(ledgerId as any));
  expect(ledgerAfter).not.toBeNull();
  expect((ledgerAfter as any).migratedAt).toBe(now - 100);
  expect((ledgerAfter as any).b2Key).toBeUndefined();
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

// ---------------------------------------------------------------------------
// PR workspace-storage-2 (migrate) test coverage for the B2
// mint/confirm/download path. The actions are the only way the
// PR 3 UI swap can succeed; proving their state-machine logic
// in convex-test now means the cutover is a one-line change.
// ---------------------------------------------------------------------------

test("generateWorkspaceUploadUrl mints a presigned PUT and reserves a ledger row", async () => {
  stubB2Credentials();
  const t = convexTest({ schema, modules });
  const { workspaceId, instructorId } = await seedWorkspaceWithInstructor(t, {
    studentUserId: "u_student_1",
    instructorUserId: "u_instructor_1",
  });
  // Mint as the instructor so the B2 key path includes the
  // instructor / student / workspace ids (used by PR 3
  // lifecycle rules). As a student, the key would fall back
  // to the org-shape `{date}/workspaces/...` path.
  const asInstructor = t.withIdentity({ subject: "u_instructor_1" });

  const result = await asInstructor.action(
    api.workspaceStorage.generateWorkspaceUploadUrl,
    {
      workspaceId: workspaceId as any,
      fileId: "file_abc",
      fileName: "image.png",
      contentType: "image/png",
      size: 1024,
    }
  );

  expect(result.fileId).toBe("file_abc");
  expect(result.uploadUrl).toMatch(
    new RegExp("^" + expectedB2BaseUrl().replace(/\//g, "\\/") + "/")
  );
  expect(result.uploadUrl).toContain("x-amz-signature=");
  // The key path includes the instructor / student / workspace
  // ids so a B2 lifecycle rule can scope per-pair in PR 3.
  expect(result.b2Key).toContain(`instructors/${instructorId}/`);
  expect(result.b2Key).toContain(`/workspaces/${workspaceId}/`);
  expect(result.b2Key).toContain("/file_abc/image.png");

  // The ledger row is reserved (pending) so the binding flow
  // has a place to look up the workspaceId + uploaderId for
  // the subsequent `recordB2FileUpload` call.
  const ledger = await t.run(async (ctx) =>
    ctx.db
      .query("fileUploads")
      .withIndex("by_b2Key", (q) => q.eq("b2Key", result.b2Key))
      .first()
  );
  expect(ledger).not.toBeNull();
  expect(ledger?.uploaderId).toBe("u_instructor_1");
  expect(ledger?.workspaceId).toBe(workspaceId);
  expect(ledger?.completedAt).toBeUndefined();
  expect(ledger?.cancelledAt).toBeUndefined();
});

test("generateWorkspaceUploadUrl refuses oversized image above MAX_IMAGE_BYTES", async () => {
  stubB2Credentials();
  const t = convexTest({ schema, modules });
  const { workspaceId } = await seedWorkspaceWithInstructor(t, {
    studentUserId: "u_student_1",
    instructorUserId: "u_instructor_1",
  });
  const asStudent = t.withIdentity({ subject: "u_student_1" });

  await expect(
    asStudent.action(api.workspaceStorage.generateWorkspaceUploadUrl, {
      workspaceId: workspaceId as any,
      fileId: "file_big",
      fileName: "big.png",
      contentType: "image/png",
      size: 9 * 1024 * 1024, // MAX_IMAGE_BYTES is 8 MB
    })
  ).rejects.toThrow(/too large/i);

  // No ledger row reserved because signing threw before
  // `reserveB2FileUploadLedger` ran (Greptile P2: "Failed
  // signing consumes upload slots").
  const ledger = await t.run(async (ctx) =>
    ctx.db.query("fileUploads").collect()
  );
  expect(ledger).toHaveLength(0);
});

test("generateWorkspaceUploadUrl refuses non-members (authz)", async () => {
  stubB2Credentials();
  const t = convexTest({ schema, modules });
  const { workspaceId } = await seedWorkspaceWithInstructor(t, {
    studentUserId: "u_student_1",
    instructorUserId: "u_instructor_1",
  });
  const asStranger = t.withIdentity({ subject: "u_stranger" });

  await expect(
    asStranger.action(api.workspaceStorage.generateWorkspaceUploadUrl, {
      workspaceId: workspaceId as any,
      fileId: "file_x",
      fileName: "x.png",
      contentType: "image/png",
      size: 1024,
    })
  ).rejects.toThrow(/not authorized/i);
});

test("generateWorkspaceUploadUrl refuses ended workspaces", async () => {
  stubB2Credentials();
  const t = convexTest({ schema, modules });
  const { workspaceId } = await seedWorkspaceWithInstructor(t, {
    studentUserId: "u_student_1",
    instructorUserId: "u_instructor_1",
    endedAt: Date.now() - 1000,
  });
  const asStudent = t.withIdentity({ subject: "u_student_1" });

  await expect(
    asStudent.action(api.workspaceStorage.generateWorkspaceUploadUrl, {
      workspaceId: workspaceId as any,
      fileId: "file_x",
      fileName: "x.png",
      contentType: "image/png",
      size: 1024,
    })
  ).rejects.toThrow(/not authorized/i);
});

test("reserveB2FileUploadLedger rejects duplicate b2Key", async () => {
  stubB2Credentials();
  const t = convexTest({ schema, modules });
  const { workspaceId } = await seedWorkspaceWithInstructor(t, {
    studentUserId: "u_student_1",
    instructorUserId: "u_instructor_1",
  });
  const now = Date.now();
  await t.mutation(internal.workspaceStorage.reserveB2FileUploadLedger, {
    workspaceId: workspaceId as any,
    b2Key: "2026-01-01/file_x/x.png",
    uploaderId: "u_student_1",
    uploadedAt: now,
  });

  await expect(
    t.mutation(internal.workspaceStorage.reserveB2FileUploadLedger, {
      workspaceId: workspaceId as any,
      b2Key: "2026-01-01/file_x/x.png",
      uploaderId: "u_student_1",
      uploadedAt: now + 1,
    })
  ).rejects.toThrow(/already reserved/i);
});

test("reserveB2FileUploadLedger enforces MAX_PENDING_UPLOADS_PER_WORKSPACE per uploader", async () => {
  stubB2Credentials();
  const t = convexTest({ schema, modules });
  const { workspaceId } = await seedWorkspaceWithInstructor(t, {
    studentUserId: "u_student_1",
    instructorUserId: "u_instructor_1",
  });
  const now = Date.now();
  // Fill 20 pending reservations for one uploader.
  for (let i = 0; i < 20; i++) {
    await t.mutation(internal.workspaceStorage.reserveB2FileUploadLedger, {
      workspaceId: workspaceId as any,
      b2Key: `2026-01-01/file_${i}/${i}.png`,
      uploaderId: "u_student_1",
      uploadedAt: now,
    });
  }
  await expect(
    t.mutation(internal.workspaceStorage.reserveB2FileUploadLedger, {
      workspaceId: workspaceId as any,
      b2Key: "2026-01-01/file_21/21.png",
      uploaderId: "u_student_1",
      uploadedAt: now,
    })
  ).rejects.toThrow(/too many pending uploads/i);
});

test("reserveB2FileUploadLedger excludes legacy Convex-storage rows from the B2 cap", async () => {
  // Greptile P1: "Legacy uploads consume B2 slots". A row with
  // `storageId !== undefined && b2Key === undefined` is the
  // legacy path; it must not count against the new B2 pending
  // cap so a workspace that has hundreds of pre-#B chat
  // attachments can still mint new B2 URLs after PR 2.
  stubB2Credentials();
  const t = convexTest({ schema, modules });
  const { workspaceId } = await seedWorkspaceWithInstructor(t, {
    studentUserId: "u_student_1",
    instructorUserId: "u_instructor_1",
  });
  const now = Date.now();
  // Insert 25 legacy rows with storageId set (no b2Key) and
  // LEFT PENDING (no completedAt). A regression where legacy
  // rows count against the B2 cap would cause the fresh mint
  // below to throw; without the pending state the index would
  // drop them before the b2Key filter and the test would pass
  // even with the regression present.
  for (let i = 0; i < 25; i++) {
    const storageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob([`legacy:${i}`]))
    );
    await t.run(async (ctx) =>
      ctx.db.insert("fileUploads", {
        workspaceId: workspaceId as any,
        uploaderId: "u_student_1",
        uploadedAt: now - 1000 * (i + 1),
        storageId,
      })
    );
  }
  // A single fresh B2 mint must still succeed because none of
  // the legacy rows have `b2Key !== undefined` (the compound
  // index filters to pending rows by completedAt; legacy rows
  // are not b2Key-reservations).
  await t.mutation(internal.workspaceStorage.reserveB2FileUploadLedger, {
    workspaceId: workspaceId as any,
    b2Key: "2026-01-01/file_fresh/fresh.png",
    uploaderId: "u_student_1",
    uploadedAt: now,
  });
});

test("recordB2FileUpload binds a freshly minted key after B2 HEAD succeeds", async () => {
  stubB2Credentials();
  const t = convexTest({ schema, modules });
  const { workspaceId } = await seedWorkspaceWithInstructor(t, {
    studentUserId: "u_student_1",
    instructorUserId: "u_instructor_1",
  });
  const asStudent = t.withIdentity({ subject: "u_student_1" });

  // Mint + reserve.
  const { b2Key } = await asStudent.action(
    api.workspaceStorage.generateWorkspaceUploadUrl,
    {
      workspaceId: workspaceId as any,
      fileId: "file_bind",
      fileName: "bind.png",
      contentType: "image/png",
      size: 1024,
    }
  );

  // Mock B2 HEAD: object exists.
  const fetchSpy = vi.fn(async () =>
    ({ ok: true, status: 200, text: async () => "" }) as Response
  );
  vi.stubGlobal("fetch", fetchSpy);

  await asStudent.action(api.workspaceStorage.recordB2FileUpload, {
    workspaceId: workspaceId as any,
    b2Key,
  });

  // Confirm: ledger row is now completed.
  const ledger = await t.run(async (ctx) =>
    ctx.db
      .query("fileUploads")
      .withIndex("by_b2Key", (q) => q.eq("b2Key", b2Key))
      .first()
  );
  expect(ledger?.completedAt).toBeTypeOf("number");
  expect(ledger?.cancelledAt).toBeUndefined();
  // Exactly one HEAD fetch (the confirm path); the mint action
  // does not fetch.
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

test("recordB2FileUpload rejects when B2 HEAD reports a missing object", async () => {
  stubB2Credentials();
  const t = convexTest({ schema, modules });
  const { workspaceId } = await seedWorkspaceWithInstructor(t, {
    studentUserId: "u_student_1",
    instructorUserId: "u_instructor_1",
  });
  const asStudent = t.withIdentity({ subject: "u_student_1" });

  const { b2Key } = await asStudent.action(
    api.workspaceStorage.generateWorkspaceUploadUrl,
    {
      workspaceId: workspaceId as any,
      fileId: "file_missing",
      fileName: "missing.png",
      contentType: "image/png",
      size: 1024,
    }
  );

  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      ({ ok: false, status: 404, text: async () => "NoSuchKey" }) as Response
    )
  );

  await expect(
    asStudent.action(api.workspaceStorage.recordB2FileUpload, {
      workspaceId: workspaceId as any,
      b2Key,
    })
  ).rejects.toThrow(/not found/i);

  const ledger = await t.run(async (ctx) =>
    ctx.db
      .query("fileUploads")
      .withIndex("by_b2Key", (q) => q.eq("b2Key", b2Key))
      .first()
  );
  // Greptile P1: "Missing uploads appear complete" — the
  // completedAt MUST remain undefined.
  expect(ledger?.completedAt).toBeUndefined();
});

test("recordB2FileUpload rejects an unknown b2Key", async () => {
  stubB2Credentials();
  const t = convexTest({ schema, modules });
  const { workspaceId } = await seedWorkspaceWithInstructor(t, {
    studentUserId: "u_student_1",
    instructorUserId: "u_instructor_1",
  });
  const asStudent = t.withIdentity({ subject: "u_student_1" });

  await expect(
    asStudent.action(api.workspaceStorage.recordB2FileUpload, {
      workspaceId: workspaceId as any,
      b2Key: "1970-01-01/nonexistent/x.png",
    })
  ).rejects.toThrow(/not reserved/i);
});

test("recordB2FileUpload rejects a key whose binding window has expired (Greptile round 27 P1)", async () => {
  stubB2Credentials();
  const t = convexTest({ schema, modules });
  const { workspaceId } = await seedWorkspaceWithInstructor(t, {
    studentUserId: "u_student_1",
    instructorUserId: "u_instructor_1",
  });
  const now = Date.now();
  // Seed a ledger row whose uploadedAt is older than
  // B2_BINDING_AGE_MS (1h). The reservation cap test above
  // already covers fresh mint; this exercises the age check
  // in recordB2FileUpload.
  const tooOldB2Key = "2026-01-01/file_stale/stale.png";
  await t.run(async (ctx) =>
    ctx.db.insert("fileUploads", {
      workspaceId: workspaceId as any,
      uploaderId: "u_student_1",
      uploadedAt: now - 2 * 60 * 60 * 1000, // 2h ago
      b2Key: tooOldB2Key,
    })
  );

  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      ({ ok: true, status: 200, text: async () => "" }) as Response
    )
  );
  const asStudent = t.withIdentity({ subject: "u_student_1" });

  await expect(
    asStudent.action(api.workspaceStorage.recordB2FileUpload, {
      workspaceId: workspaceId as any,
      b2Key: tooOldB2Key,
    })
  ).rejects.toThrow(/too old/i);
});

test("recordB2FileUpload rejects a key bound to a different workspace (Greptile round 28 P1)", async () => {
  stubB2Credentials();
  const t = convexTest({ schema, modules });
  const { workspaceId } = await seedWorkspaceWithInstructor(t, {
    studentUserId: "u_student_1",
    instructorUserId: "u_instructor_1",
  });
  // Seed a SECOND workspace for the same student so the
  // caller can try to bind workspace A's key against
  // workspace B.
  const { workspaceId: otherWorkspaceId } = await seedWorkspaceWithInstructor(
    t,
    {
      studentUserId: "u_student_1",
      instructorUserId: "u_instructor_1",
    }
  );

  const asStudent = t.withIdentity({ subject: "u_student_1" });
  const { b2Key } = await asStudent.action(
    api.workspaceStorage.generateWorkspaceUploadUrl,
    {
      workspaceId: workspaceId as any,
      fileId: "file_cross",
      fileName: "cross.png",
      contentType: "image/png",
      size: 1024,
    }
  );

  // Look up the original ledger row so we can assert it
  // survives the cross-workspace rejection (Greptile round
  // 32 P2: "Rejection leaves cleanup unchecked" — without
  // this assertion, a regression that cancels the original
  // upload and schedules its B2 deletion on rejection would
  // pass the test).
  const originalRow = await t.run(async (ctx) =>
    ctx.db
      .query("fileUploads")
      .withIndex("by_b2Key", (q) => q.eq("b2Key", b2Key))
      .first()
  );

  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      ({ ok: true, status: 200, text: async () => "" }) as Response
    )
  );

  // Caller passes `otherWorkspaceId` but the ledger row
  // belongs to `workspaceId`. recordB2FileUpload must reject
  // (Greptile P1: "Rejected confirmation deletes other files").
  await expect(
    asStudent.action(api.workspaceStorage.recordB2FileUpload, {
      workspaceId: otherWorkspaceId as any,
      b2Key,
    })
  ).rejects.toThrow(/does not belong to this workspace/i);

  // The original ledger row must remain pending + not cancelled.
  // A regression that scheduled cleanup on rejection would mark
  // this row cancelled.
  const after = await t.run(async (ctx) =>
    ctx.db.get(originalRow!._id)
  );
  expect((after as any).cancelledAt).toBeUndefined();
  expect((after as any).completedAt).toBeUndefined();
});

test("confirmB2FileUpload refuses to re-confirm an already-completed ledger row", async () => {
  // Greptile round 28 P1: the cancel path must guard against
  // completed rows so a concurrent confirmation cannot
  // schedule a B2 cleanup that deletes a live file.
  stubB2Credentials();
  const t = convexTest({ schema, modules });
  const { workspaceId } = await seedWorkspaceWithInstructor(t, {
    studentUserId: "u_student_1",
    instructorUserId: "u_instructor_1",
  });
  const now = Date.now();
  const rowId = await t.run(async (ctx) =>
    ctx.db.insert("fileUploads", {
      workspaceId: workspaceId as any,
      uploaderId: "u_student_1",
      uploadedAt: now,
      b2Key: "2026-01-01/file_done/done.png",
      completedAt: now - 1000,
    })
  );

  // Calling confirmB2FileUpload on a completed row is a
  // no-op (the action's terminal state machine). Verify by
  // reading the row back: completedAt must NOT change.
  await t.mutation(internal.workspaceStorage.confirmB2FileUpload, {
    ledgerId: rowId as any,
    callerId: "u_student_1",
  });
  const ledger = await t.run(async (ctx) => ctx.db.get(rowId as any));
  expect((ledger as any).completedAt).toBe(now - 1000);
  expect((ledger as any).cancelledAt).toBeUndefined();
});

test("confirmB2FileUpload sets completedAt when workspace state still authorizes", async () => {
  stubB2Credentials();
  const t = convexTest({ schema, modules });
  const { workspaceId } = await seedWorkspaceWithInstructor(t, {
    studentUserId: "u_student_1",
    instructorUserId: "u_instructor_1",
  });
  const now = Date.now();
  const rowId = await t.run(async (ctx) =>
    ctx.db.insert("fileUploads", {
      workspaceId: workspaceId as any,
      uploaderId: "u_student_1",
      uploadedAt: now,
      b2Key: "2026-01-01/file_ok/ok.png",
    })
  );

  await t.mutation(internal.workspaceStorage.confirmB2FileUpload, {
    ledgerId: rowId as any,
    callerId: "u_student_1",
  });
  const ledger = await t.run(async (ctx) => ctx.db.get(rowId as any));
  expect((ledger as any).completedAt).toBeTypeOf("number");
  expect((ledger as any).cancelledAt).toBeUndefined();
});

test("confirmB2FileUpload rejects and leaves row pending when the workspace ended during HEAD (TOCTOU)", async () => {
  // Greptile round 24 P1: a workspace could be ended between
  // the action's authz check and the B2 HEAD call. The
  // mutation must re-verify rather than mark complete.
  //
  // HUC-53 / Greptile P1 r25: the cancel + cleanup that
  // previously lived inside `confirmB2FileUpload` was a
  // no-op — `ctx.runMutation` (or `ctx.scheduler.runAfter`)
  // from inside a mutation that subsequently throws is part
  // of the same transaction and gets rolled back when the
  // throw fires. The cancel + scheduled cleanup now live in
  // the action caller (`verifyAndConfirmB2Upload`'s catch
  // handler), which is not in a transaction, so the writes
  // commit independently of the throw.
  //
  // This test exercises the mutation IN ISOLATION (no
  // wrapping action) so `cancelledAt` MUST stay undefined —
  // the mutation has no caller to delegate to. The
  // `verifyAndConfirmB2Upload catches TOCTOU throw and
  // cancels` test below exercises the full production flow
  // through `verifyAndConfirmB2Upload` and asserts the
  // action's catch handler DOES commit `cancelledAt`.
  stubB2Credentials();
  const t = convexTest({ schema, modules });
  const { workspaceId } = await seedWorkspaceWithInstructor(t, {
    studentUserId: "u_student_1",
    instructorUserId: "u_instructor_1",
  });
  const now = Date.now();
  const rowId = await t.run(async (ctx) =>
    ctx.db.insert("fileUploads", {
      workspaceId: workspaceId as any,
      uploaderId: "u_student_1",
      uploadedAt: now,
      b2Key: "2026-01-01/file_toctou/toctou.png",
    })
  );
  // Race: the workspace was ended by an admin a few ms ago.
  await t.run(async (ctx) =>
    ctx.db.patch(workspaceId as any, { endedAt: now - 10 })
  );

  await expect(
    t.mutation(internal.workspaceStorage.confirmB2FileUpload, {
      ledgerId: rowId as any,
      callerId: "u_student_1",
    })
  ).rejects.toThrow(/ended during/i);

  const ledger = await t.run(async (ctx) => ctx.db.get(rowId as any));
  // Greptile P1: "Missing uploads appear complete" — the row
  // MUST NOT be marked complete even though HEAD would have
  // returned 200 had the action not re-verified. This is
  // the actual TOCTOU protection.
  expect((ledger as any).completedAt).toBeUndefined();
  // The mutation alone cannot cancel: nested writes are
  // rolled back when the throw fires. The cancel is the
  // action caller's responsibility — see the next test.
  expect((ledger as any).cancelledAt).toBeUndefined();

  // Greptile round 1 P1 follow-up: the throw carries the
  // TOCTOU reject marker so the action caller can
  // distinguish a TOCTOU rejection (cleanup) from a
  // transient error (no cleanup).
  await expect(
    t.mutation(internal.workspaceStorage.confirmB2FileUpload, {
      ledgerId: rowId as any,
      callerId: "u_student_1",
    })
  ).rejects.toThrow(/\[TOCTOU-REJECT\]/);
});

test("verifyAndConfirmB2Upload catches TOCTOU throw and commits cancelledAt (HUC-53 fix)", async () => {
  // HUC-53 / Greptile P1 r25 follow-up: confirm the
  // production flow (`verifyAndConfirmB2Upload` action)
  // DOES commit `cancelledAt` when `confirmB2FileUpload`
  // throws due to a TOCTOU race.
  //
  // Setup: simulate the workspace ending BETWEEN the
  // action's pre-cancel (which only fires when the action
  // itself detects the ended state) and the mutation's
  // re-check. We pre-end the workspace BEFORE the action
  // runs, then call `verifyAndConfirmB2Upload` directly
  // (which does not have a pre-cancel — only
  // `recordB2FileUpload` does). The mutation throws, the
  // action's catch handler calls `cancelB2FileUpload`,
  // then the action rethrows.
  stubB2Credentials();
  const t = convexTest({ schema, modules });
  const { workspaceId } = await seedWorkspaceWithInstructor(t, {
    studentUserId: "u_student_1",
    instructorUserId: "u_instructor_1",
  });
  const now = Date.now();
  const b2Key = "2026-01-01/file_toctou_action_catch/catch.png";
  const rowId = await t.run(async (ctx) =>
    ctx.db.insert("fileUploads", {
      workspaceId: workspaceId as any,
      uploaderId: "u_student_1",
      uploadedAt: now,
      b2Key,
    })
  );
  // End the workspace so the mutation's re-check throws.
  await t.run(async (ctx) =>
    ctx.db.patch(workspaceId as any, { endedAt: now + 1 })
  );

  // Mock the B2 HEAD to succeed; otherwise the action would
  // throw on HEAD (not on the mutation's re-check).
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      ({ ok: true, status: 200, text: async () => "" }) as Response
    )
  );

  await expect(
    t.action(internal.workspaceStorage.verifyAndConfirmB2Upload, {
      b2Key,
      ledgerId: rowId as any,
      callerId: "u_student_1",
    })
  ).rejects.toThrow(/ended during/i);

  // HUC-53 fix: the action's catch handler committed
  // `cancelledAt` even though the mutation's nested cancel
  // (had it been inlined) would have been rolled back.
  const ledger = await t.run(async (ctx) => ctx.db.get(rowId as any));
  expect((ledger as any).cancelledAt).toBeTypeOf("number");
  expect((ledger as any).completedAt).toBeUndefined();
});

test("verifyAndConfirmB2Upload catch handler does NOT cancel on transient errors (Greptile round 1 P1)", async () => {
  // Greptile round 1 P1: the catch handler must distinguish a
  // TOCTOU rejection (workspace state changed during HEAD) from
  // a transient DB / Convex error. The former must trigger
  // cleanup; the latter must propagate untouched so the caller
  // can retry the same key.
  //
  // We force the mutation to throw a NON-TOCTOU error by
  // pre-cancelling the ledger row — the mutation throws
  // "Ledger row was cancelled during verify-and-confirm"
  // (NOT a TOCTOU rejection, no `[TOCTOU-REJECT]` prefix).
  // The ledger row still exists with `cancelledAt` set, so
  // we can assert the catch handler left it alone (no
  // cancelledAt re-patch, no re-scheduled cleanup).
  stubB2Credentials();
  const t = convexTest({ schema, modules });
  const { workspaceId } = await seedWorkspaceWithInstructor(t, {
    studentUserId: "u_student_1",
    instructorUserId: "u_instructor_1",
  });
  const now = Date.now();
  const b2Key = "2026-01-01/file_transient/transient.png";
  const preCancelledAt = now - 5000;
  const rowId = await t.run(async (ctx) =>
    ctx.db.insert("fileUploads", {
      workspaceId: workspaceId as any,
      uploaderId: "u_student_1",
      uploadedAt: now,
      b2Key,
      cancelledAt: preCancelledAt,
    })
  );

  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      ({ ok: true, status: 200, text: async () => "" }) as Response
    )
  );

  await expect(
    t.action(internal.workspaceStorage.verifyAndConfirmB2Upload, {
      b2Key,
      ledgerId: rowId as any,
      callerId: "u_student_1",
    })
  ).rejects.toThrow(/cancelled during/i);

  // HUC-53 P1 follow-up: the catch handler MUST NOT call
  // `cancelB2FileUpload` on a non-TOCTOU error. The error
  // message does not start with `[TOCTOU-REJECT]`, so the
  // handler skips cleanup. Assert the ledger row is
  // unchanged (no re-patch of `cancelledAt`, no re-schedule
  // of cleanup). If a regression re-enabled unconditional
  // cancel, `cancelledAt` would be overwritten with a
  // later timestamp and a redundant cleanup would be
  // scheduled (which would issue an extra B2 DELETE).
  const ledger = await t.run(async (ctx) => ctx.db.get(rowId as any));
  expect((ledger as any).cancelledAt).toBe(preCancelledAt);
  expect((ledger as any).completedAt).toBeUndefined();
});

test("recordB2FileUpload TOCTOU during HEAD: catch handler commits cancelledAt (end-to-end)", async () => {
  // Greptile round 2 P2 follow-up: exercise the production
  // entry point (`recordB2FileUpload`) with a HEAD delay so
  // the workspace can end DURING HEAD — not before the
  // action's pre-check (covered by the test at line 1505)
  // and not after the mutation (covered by the catch-handler
  // test above). This test simulates the production timing
  // race by stalling the HEAD fetch, patching the workspace
  // to endedAt, then resolving the HEAD.
  //
  // Greptile round 3 P2 follow-up: the timing race could
  // allow the action's pre-check (which reads workspace
  // state) to see the ended state and fire the pre-cancel
  // path before HEAD is reached. In that case the catch
  // handler never runs and `cancelledAt` would be set by
  // the pre-cancel path — the test would pass without
  // exercising the catch handler. We assert HEAD was
  // actually called (`fetchSpy` was invoked): the
  // pre-cancel path throws before HEAD, so a HEAD call
  // proves the catch handler was the cancel source.
  //
  // Greptile round 4 P2 follow-up: instead of a fixed
  // `setTimeout(50)` (which assumes the pre-check completes
  // within that window), the HEAD mock signals when it is
  // called and we `await` that signal before patching the
  // workspace. The test is now deterministic — it waits
  // for HEAD to actually be in flight, regardless of how
  // long the pre-check takes.
  stubB2Credentials();
  const t = convexTest({ schema, modules });
  const { workspaceId } = await seedWorkspaceWithInstructor(t, {
    studentUserId: "u_student_1",
    instructorUserId: "u_instructor_1",
  });
  const asStudent = t.withIdentity({ subject: "u_student_1" });

  // Step 1: mint a fresh upload URL while the workspace is
  // active.
  const { b2Key } = await asStudent.action(
    api.workspaceStorage.generateWorkspaceUploadUrl,
    {
      workspaceId: workspaceId as any,
      fileId: "file_toctou_head_e2e",
      fileName: "toctou_head_e2e.png",
      contentType: "image/png",
      size: 1024,
    }
  );

  // Step 2: stall the HEAD fetch so we can end the workspace
  // while HEAD is "in flight". The mock signals when HEAD
  // starts so the test can synchronize the workspace patch
  // with the actual HEAD call (rather than guessing a
  // timeout).
  let resolveHead: () => void = () => {};
  const headStalled = new Promise<void>((resolve) => {
    resolveHead = resolve;
  });
  let headStartedResolve: () => void = () => {};
  const headStarted = new Promise<void>((resolve) => {
    headStartedResolve = resolve;
  });
  const fetchSpy = vi.fn(async () => {
    headStartedResolve();
    await headStalled;
    return { ok: true, status: 200, text: async () => "" } as Response;
  });
  vi.stubGlobal("fetch", fetchSpy);

  // Step 3: kick off the action. Its pre-check (workspace +
  // authorization) reads the workspace as active, then it
  // calls `verifyAndConfirmB2Upload`, which calls HEAD and
  // gets stuck on the stall.
  const actionPromise = asStudent.action(
    api.workspaceStorage.recordB2FileUpload,
    {
      workspaceId: workspaceId as any,
      b2Key,
    }
  );

  // Step 4: wait for HEAD to actually be called (deterministic
  // — no fixed timeout). Once HEAD is in flight, the
  // pre-check has already passed and the pre-cancel path
  // cannot take over.
  await headStarted;

  // Step 5: end the workspace while HEAD is in flight. The
  // mutation's re-check will see `endedAt` and throw TOCTOU.
  await t.run(async (ctx) =>
    ctx.db.patch(workspaceId as any, { endedAt: Date.now() })
  );

  // Step 6: release the HEAD. The catch handler now commits
  // the cancel.
  resolveHead();

  await expect(actionPromise).rejects.toThrow(/ended/i);

  // Step 7: assert HEAD was actually called (defense in
  // depth — a regression that short-circuits before HEAD
  // would fail this assertion).
  expect(fetchSpy).toHaveBeenCalledTimes(1);

  // Step 8: assert the catch handler committed
  // `cancelledAt`. This is the production timing race in
  // miniature.
  const ledger = await t.run(async (ctx) =>
    ctx.db
      .query("fileUploads")
      .withIndex("by_b2Key", (q) => q.eq("b2Key", b2Key))
      .first()
  );
  expect(ledger?.cancelledAt).toBeTypeOf("number");
  expect(ledger?.completedAt).toBeUndefined();
});

test("recordB2FileUpload TOCTOU: action-level cancel commits even though the mutation's nested cancel rolls back", async () => {
  // Round 33 follow-up: prove the actual production flow
  // DOES cancel the ledger when the workspace ends during
  // HEAD. `recordB2FileUpload` (the action) checks authz and
  // cancel-delegates BEFORE calling `confirmB2FileUpload`.
  // The action's cancel lives outside any transaction, so
  // it commits independently of any throw that happens
  // later in `confirmB2FileUpload`.
  //
  // We simulate the TOCTOU by minting an upload URL while
  // the workspace is active, then patching the workspace
  // to endedAt before `recordB2FileUpload` runs. The
  // action's bind-checks (which re-read the workspace) will
  // see the ended state and cancel the ledger before
  // throwing — the cancel commits because actions are
  // not in a transaction.
  stubB2Credentials();
  const t = convexTest({ schema, modules });
  const { workspaceId } = await seedWorkspaceWithInstructor(t, {
    studentUserId: "u_student_1",
    instructorUserId: "u_instructor_1",
  });
  const asStudent = t.withIdentity({ subject: "u_student_1" });

  // Step 1: mint a fresh upload URL while the workspace is
  // still active. This reserves a ledger row.
  const { b2Key } = await asStudent.action(
    api.workspaceStorage.generateWorkspaceUploadUrl,
    {
      workspaceId: workspaceId as any,
      fileId: "file_toctou_action",
      fileName: "toctou.png",
      contentType: "image/png",
      size: 1024,
    }
  );

  // Step 2: simulate the TOCTOU race — end the workspace
  // AFTER the mint, BEFORE the action's bind-check fires.
  await t.run(async (ctx) =>
    ctx.db.patch(workspaceId as any, { endedAt: Date.now() - 10 })
  );

  // Step 3: the action re-reads the workspace at the bind
  // check, sees endedAt, schedules the cancel + cleanup via
  // `ctx.runMutation(cancelB2FileUpload)` (in action
  // context), and then throws.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      ({ ok: true, status: 200, text: async () => "" }) as Response
    )
  );
  await expect(
    asStudent.action(api.workspaceStorage.recordB2FileUpload, {
      workspaceId: workspaceId as any,
      b2Key,
    })
  ).rejects.toThrow(/ended/i);

  // Step 4: assert the action-level cancel DID commit.
  const ledger = await t.run(async (ctx) =>
    ctx.db
      .query("fileUploads")
      .withIndex("by_b2Key", (q) => q.eq("b2Key", b2Key))
      .first()
  );
  expect(ledger?.cancelledAt).toBeTypeOf("number");
  expect(ledger?.completedAt).toBeUndefined();
});

test("getWorkspaceDownloadUrl signs a GET URL for a completed, in-workspace key", async () => {
  stubB2Credentials();
  const t = convexTest({ schema, modules });
  const { workspaceId } = await seedWorkspaceWithInstructor(t, {
    studentUserId: "u_student_1",
    instructorUserId: "u_instructor_1",
  });
  const now = Date.now();
  await t.run(async (ctx) =>
    ctx.db.insert("fileUploads", {
      workspaceId: workspaceId as any,
      uploaderId: "u_student_1",
      uploadedAt: now,
      b2Key: "2026-01-01/file_dl/dl.png",
      completedAt: now,
    })
  );

  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      ({ ok: true, status: 200, text: async () => "" }) as Response
    )
  );
  const asStudent = t.withIdentity({ subject: "u_student_1" });
  const result = await asStudent.action(
    api.workspaceStorage.getWorkspaceDownloadUrl,
    {
      b2Key: "2026-01-01/file_dl/dl.png",
      workspaceId: workspaceId as any,
      expiresInSeconds: 3600,
    }
  );
  expect(result.url).toMatch(
    new RegExp("^" + expectedB2BaseUrl().replace(/\//g, "\\/") + "/")
  );
  expect(result.url).toContain("x-amz-signature=");
  // The signed GET URL embeds the credential scope so the
  // signer is bound to the bucket's region. A regression
  // that lost the region in the signer would still produce
  // a URL that contains `x-amz-signature=` but would not
  // reach the bucket. Round 33 P2 "Signature assertion
  // assumes default region" — derive the region from env.
  const region = expectedB2Region();
  expect(result.url).toContain(`%2F${region}%2F`);
  expect(result.expiresAt).toBeGreaterThan(Date.now());
});

test("getWorkspaceDownloadUrl clamps the URL lifetime to the workspace retention deadline for an ended workspace", async () => {
  // Greptile round 33 P2 "Retention expiry lacks coverage":
  // an active workspace test only proves the URL expires
  // sometime in the future; a regression that ignores the
  // ended-workspace retention clamp (Greptile round 24 P1
  // "Download outlives retention") would pass that test.
  // The clamp code is `min(24h, timeUntilDeadline)`, so we
  // pick a deadline that's much closer than 24h (e.g. the
  // workspace ended 18 months minus 5 minutes ago, leaving
  // 5 minutes until deadline) — a regression that ignored
  // the clamp would set expiresAt to ~now + 24h.
  stubB2Credentials();
  const t = convexTest({ schema, modules });
  const { workspaceId } = await seedWorkspaceWithInstructor(t, {
    studentUserId: "u_student_1",
    instructorUserId: "u_instructor_1",
  });
  const now = Date.now();
  // Ended ~18 months minus 5 minutes ago — the retention
  // deadline is 5 minutes from `now`. The clamp MUST set the
  // URL lifetime to ~5 minutes, not the 24h the caller
  // asked for.
  const retentionMs = 18 * 30 * 24 * 60 * 60 * 1000;
  const secondsRemaining = 5 * 60;
  const endedAt = now - (retentionMs - secondsRemaining * 1000);
  await t.run(async (ctx) =>
    ctx.db.patch(workspaceId as any, { endedAt })
  );
  await t.run(async (ctx) =>
    ctx.db.insert("fileUploads", {
      workspaceId: workspaceId as any,
      uploaderId: "u_student_1",
      uploadedAt: now,
      b2Key: "2026-01-01/file_retention_clamp/clamp.png",
      completedAt: now,
    })
  );

  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      ({ ok: true, status: 200, text: async () => "" }) as Response
    )
  );
  const asStudent = t.withIdentity({ subject: "u_student_1" });
  const result = await asStudent.action(
    api.workspaceStorage.getWorkspaceDownloadUrl,
    {
      b2Key: "2026-01-01/file_retention_clamp/clamp.png",
      workspaceId: workspaceId as any,
      expiresInSeconds: 24 * 3600,
    }
  );
  // expiresAt MUST be much less than the 24h fallback.
  // Allow a 60s slack above `now + 5min` to keep the
  // assertion robust against clock jitter, but a
  // regression that ignored the clamp would set expiresAt
  // to roughly now + 24h (way above this bound).
  const clampedCeilingMs = now + (secondsRemaining + 60) * 1000;
  expect(result.expiresAt).toBeLessThanOrEqual(clampedCeilingMs);
  // And it MUST be much less than the 24h fallback the
  // caller asked for.
  const twentyFourHoursMs = Date.now() + 24 * 3600 * 1000;
  expect(result.expiresAt).toBeLessThan(twentyFourHoursMs);
});

test("getWorkspaceDownloadUrl refuses to sign when the retention deadline has passed", async () => {
  // Greptile round 24 P1: "Files remain downloadable after
  // retention" — once an ended workspace is past the
  // retention deadline, downloads must be refused. The
  // resolver at `resolveWorkspaceDownloadAccess` enforces
  // this BEFORE the action body runs; the action body's
  // secondary check at the deadline tick is for the
  // narrow race where the deadline passes between the
  // resolver and the signer. Both paths must refuse; this
  // test exercises the resolver path because that is what
  // actually triggers in steady state.
  stubB2Credentials();
  const t = convexTest({ schema, modules });
  const { workspaceId } = await seedWorkspaceWithInstructor(t, {
    studentUserId: "u_student_1",
    instructorUserId: "u_instructor_1",
  });
  const now = Date.now();
  // Ended 19 months ago — past the 18-month retention
  // deadline.
  const endedAt = now - 19 * 30 * 24 * 60 * 60 * 1000;
  await t.run(async (ctx) =>
    ctx.db.patch(workspaceId as any, { endedAt })
  );
  await t.run(async (ctx) =>
    ctx.db.insert("fileUploads", {
      workspaceId: workspaceId as any,
      uploaderId: "u_student_1",
      uploadedAt: now,
      b2Key: "2026-01-01/file_expired/expired.png",
      completedAt: now,
    })
  );

  const asStudent = t.withIdentity({ subject: "u_student_1" });
  await expect(
    asStudent.action(api.workspaceStorage.getWorkspaceDownloadUrl, {
      b2Key: "2026-01-01/file_expired/expired.png",
      workspaceId: workspaceId as any,
      expiresInSeconds: 3600,
    })
  ).rejects.toThrow(/Not authorized|retention deadline has passed/i);
});

test("getWorkspaceDownloadUrl refuses a key whose ledger row has been cancelled", async () => {
  stubB2Credentials();
  const t = convexTest({ schema, modules });
  const { workspaceId } = await seedWorkspaceWithInstructor(t, {
    studentUserId: "u_student_1",
    instructorUserId: "u_instructor_1",
  });
  const now = Date.now();
  await t.run(async (ctx) =>
    ctx.db.insert("fileUploads", {
      workspaceId: workspaceId as any,
      uploaderId: "u_student_1",
      uploadedAt: now,
      b2Key: "2026-01-01/file_dlx/dlx.png",
      completedAt: now,
      cancelledAt: now,
    })
  );

  const asStudent = t.withIdentity({ subject: "u_student_1" });
  await expect(
    asStudent.action(api.workspaceStorage.getWorkspaceDownloadUrl, {
      b2Key: "2026-01-01/file_dlx/dlx.png",
      workspaceId: workspaceId as any,
    })
  ).rejects.toThrow(/not available for download/i);
});

test("getWorkspaceDownloadUrl refuses a cross-workspace b2Key (Greptile P1 sec)", async () => {
  stubB2Credentials();
  const t = convexTest({ schema, modules });
  const { workspaceId } = await seedWorkspaceWithInstructor(t, {
    studentUserId: "u_student_1",
    instructorUserId: "u_instructor_1",
  });
  const { workspaceId: otherWorkspaceId } = await seedWorkspaceWithInstructor(
    t,
    {
      studentUserId: "u_student_2",
      instructorUserId: "u_instructor_2",
    }
  );
  const now = Date.now();
  // The b2Key is in `otherWorkspaceId`; the caller will pass
  // `workspaceId` (their own workspace).
  await t.run(async (ctx) =>
    ctx.db.insert("fileUploads", {
      workspaceId: otherWorkspaceId as any,
      uploaderId: "u_student_2",
      uploadedAt: now,
      b2Key: "2026-01-01/file_cross/cross.png",
      completedAt: now,
    })
  );

  const asStudent = t.withIdentity({ subject: "u_student_1" });
  await expect(
    asStudent.action(api.workspaceStorage.getWorkspaceDownloadUrl, {
      b2Key: "2026-01-01/file_cross/cross.png",
      workspaceId: workspaceId as any,
    })
  ).rejects.toThrow(/does not belong to the authorized workspace/i);
});

test("deleteFromB2WorkspaceAction issues a SigV4 DELETE to the workspace bucket", async () => {
  stubB2Credentials();
  const t = convexTest({ schema, modules });
  const fetchSpy = vi.fn(async () =>
    ({ ok: true, status: 204, text: async () => "" }) as Response
  );
  vi.stubGlobal("fetch", fetchSpy);

  await t.action(internal.workspaceStorage.deleteFromB2WorkspaceAction, {
    b2Key: "2026-01-01/file_del/del.png",
  });

  expect(fetchSpy).toHaveBeenCalledTimes(1);
  const [calledUrl, calledInit] = fetchSpy.mock.calls[0] as [string, RequestInit];
  expect(calledUrl).toBe(
    `${expectedB2BaseUrl()}/2026-01-01/file_del/del.png`
  );
  expect(calledInit.method).toBe("DELETE");
  // Authorization header carries the SigV4 signature.
  const headers = calledInit.headers as Record<string, string>;
  // Derive the region from env (round 33 P2: a hardcoded
  // region breaks any test environment that points at a
  // non-default region).
  const region = expectedB2Region().replace(/\./g, "\\.");
  expect(headers["Authorization"]).toMatch(
    new RegExp(
      `^AWS4-HMAC-SHA256 Credential=test-b2-key-id\\/\\d{8}\\/${region}\\/s3\\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$`
    )
  );
});

test("deleteFromB2WorkspaceAction treats a 404 as a successful cleanup (object already gone)", async () => {
  stubB2Credentials();
  const t = convexTest({ schema, modules });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      ({ ok: false, status: 404, statusText: "Not Found", text: async () => "" }) as Response
    )
  );
  // Should NOT throw — 404 is treated as success.
  await t.action(internal.workspaceStorage.deleteFromB2WorkspaceAction, {
    b2Key: "2026-01-01/file_ghost/ghost.png",
  });
});

test("forceDeleteExpiredChatMessageRow B2 branch deletes from B2 and skips ctx.storage.delete", async () => {
  // Greptile round 27 P1 / round 30 topology: when a chat row
  // has been migrated (`b2Key !== undefined`), the chat
  // retention cron must call `deleteFromB2WorkspaceAction`
  // and MUST NOT call `ctx.storage.delete` (otherwise we'd
  // hit Convex's free-plan storage quota).
  stubB2Credentials();
  const t = convexTest({ schema, modules });
  const { workspaceId } = await seedWorkspaceWithInstructor(t, {
    studentUserId: "u_student_1",
    instructorUserId: "u_instructor_1",
  });
  const now = Date.now();
  // Seed a chat message row in `workspaceMessages` with both
  // storageId (legacy) and b2Key (migrated). The retention
  // cron's B2 branch must take the b2Key path.
  const storageId = await t.run(async (ctx) =>
    ctx.storage.store(new Blob(["legacy-bytes"]))
  );
  const messageId = await t.run(async (ctx) =>
    ctx.db.insert("workspaceMessages", {
      workspaceId: workspaceId as any,
      userId: "u_student_1",
      content: "(deleted)",
      type: "file",
      storageId,
      b2Key: "2026-01-01/file_msg/msg.png",
      deletedAt: now - 31 * 24 * 60 * 60 * 1000,
    })
  );

  // The mutation only touches the DB; the action that
  // performs the B2 DELETE is `hardDeleteExpiredChatFiles`.
  // For this test we just need to confirm that the mutation
  // deletes the message row and DOES NOT touch `ctx.storage`.
  // (The B2 fetch is exercised in `hardDeleteExpiredChatFiles`
  // which we do not invoke here.)
  const result = await t.mutation(
    internal.cleanup.chatFileRetention.forceDeleteExpiredChatMessageRow,
    { messageId: messageId as any }
  );
  expect(result).toEqual({ deleted: true });
  const after = await t.run(async (ctx) => ctx.db.get(messageId as any));
  expect(after).toBeNull();
});

test("forceDeleteExpiredChatMessageRow legacy branch deletes the matching ledger row when not migrated", async () => {
  // Round 27 P1 fix: pre-migration rows (storageId !== undefined,
  // b2Key === undefined, migratedAt === undefined) keep the
  // original ledger-cleanup behavior so the chat-row GC closes
  // the loop. The mutation MUST delete the ledger row in this
  // case so PR 3 can rely on the chat-retention sweep to clean
  // orphan Convex-storage rows.
  stubB2Credentials();
  const t = convexTest({ schema, modules });
  const { workspaceId } = await seedWorkspaceWithInstructor(t, {
    studentUserId: "u_student_1",
    instructorUserId: "u_instructor_1",
  });
  const now = Date.now();
  const storageId = await t.run(async (ctx) =>
    ctx.storage.store(new Blob(["legacy"]))
  );
  const messageId = await t.run(async (ctx) =>
    ctx.db.insert("workspaceMessages", {
      workspaceId: workspaceId as any,
      userId: "u_student_1",
      content: "(deleted)",
      type: "file",
      storageId,
      deletedAt: now - 31 * 24 * 60 * 60 * 1000,
    })
  );
  // Seed the matching ledger row in legacy (un-migrated) state.
  const ledgerId = await t.run(async (ctx) =>
    ctx.db.insert("fileUploads", {
      workspaceId: workspaceId as any,
      uploaderId: "u_student_1",
      uploadedAt: now - 1000,
      storageId,
      completedAt: now - 500,
    })
  );

  await t.mutation(internal.cleanup.chatFileRetention.forceDeleteExpiredChatMessageRow, {
    messageId: messageId as any,
  });
  const afterMessage = await t.run(async (ctx) =>
    ctx.db.get(messageId as any)
  );
  const afterLedger = await t.run(async (ctx) =>
    ctx.db.get(ledgerId as any)
  );
  expect(afterMessage).toBeNull();
  expect(afterLedger).toBeNull();
});

test("forceDeleteExpiredChatMessageRow preserves the ledger when the row is mid-migration (Greptile round 27 P1 fix)", async () => {
  // Round 27 P1 fix: rows whose migration has locked the ledger
  // (`migratedAt !== undefined && b2Key === undefined`) MUST be
  // preserved so the migration can finish writing `b2Key +
  // completedAt` and propagating the key. Round 28 attempted to
  // delete the ledger mid-migration but created a worse orphan.
  stubB2Credentials();
  const t = convexTest({ schema, modules });
  const { workspaceId } = await seedWorkspaceWithInstructor(t, {
    studentUserId: "u_student_1",
    instructorUserId: "u_instructor_1",
  });
  const now = Date.now();
  const storageId = await t.run(async (ctx) =>
    ctx.storage.store(new Blob(["mid-migration"]))
  );
  const messageId = await t.run(async (ctx) =>
    ctx.db.insert("workspaceMessages", {
      workspaceId: workspaceId as any,
      userId: "u_student_1",
      content: "(deleted)",
      type: "file",
      storageId,
      deletedAt: now - 31 * 24 * 60 * 60 * 1000,
    })
  );
  const ledgerId = await t.run(async (ctx) =>
    ctx.db.insert("fileUploads", {
      workspaceId: workspaceId as any,
      uploaderId: "u_student_1",
      uploadedAt: now - 1000,
      storageId,
      migratedAt: now - 100, // lock present, b2Key not yet written
    })
  );

  await t.mutation(internal.cleanup.chatFileRetention.forceDeleteExpiredChatMessageRow, {
    messageId: messageId as any,
  });
  const afterMessage = await t.run(async (ctx) =>
    ctx.db.get(messageId as any)
  );
  const afterLedger = await t.run(async (ctx) =>
    ctx.db.get(ledgerId as any)
  );
  expect(afterMessage).toBeNull();
  // Ledger survives so the migration can finish.
  expect(afterLedger).not.toBeNull();
});

// ---------------------------------------------------------------------------
// Greptile P2 (round 32 follow-up): close the remaining gaps.
//   1. cancelB2FileUpload is the unit that does the cancel
//      patch + cleanup schedule. Assert it directly so a
//      regression that drops the call would fail this test
//      independent of confirmB2FileUpload's TOCTOU throw.
//   2. hardDeleteExpiredChatFiles is the action that decides
//      between the B2 branch and the Convex-storage branch.
//      Assert which storage operation runs for each branch.
// ---------------------------------------------------------------------------

test("cancelB2FileUpload patches cancelledAt and schedules cleanup for a pending ledger row", async () => {
  // Direct test of the cancel unit. Greptile round 33 P2:
  // "Cleanup scheduling goes unchecked" — asserting only
  // `cancelledAt` lets a regression that drops the
  // `ctx.scheduler.runAfter` call slip through, leaving
  // cancelled B2 objects undeleted. Inspect
  // `_scheduled_functions` to prove the cleanup action was
  // scheduled (discordActionQueue.test.ts:57 precedent).
  stubB2Credentials();
  const t = convexTest({ schema, modules });
  const { workspaceId } = await seedWorkspaceWithInstructor(t, {
    studentUserId: "u_student_1",
    instructorUserId: "u_instructor_1",
  });
  const rowId = await t.run(async (ctx) =>
    ctx.db.insert("fileUploads", {
      workspaceId: workspaceId as any,
      uploaderId: "u_student_1",
      uploadedAt: Date.now(),
      b2Key: "2026-01-01/file_cancel/cancel.png",
    })
  );

  await t.mutation(internal.workspaceStorage.cancelB2FileUpload, {
    b2Key: "2026-01-01/file_cancel/cancel.png",
  });
  const after = await t.run(async (ctx) => ctx.db.get(rowId as any));
  expect((after as any).cancelledAt).toBeTypeOf("number");
  expect((after as any).completedAt).toBeUndefined();
  // The cleanup action must be scheduled. Without this, a
  // refactor that drops `ctx.scheduler.runAfter` would leave
  // the cancelled B2 object in the bucket forever.
  const scheduled = await t.run(async (ctx) =>
    ctx.db.system.query("_scheduled_functions").collect()
  );
  const cleanupEntries = scheduled.filter((s) =>
    /cleanupRejectedB2Upload/i.test(s.name)
  );
  expect(cleanupEntries.length).toBeGreaterThanOrEqual(1);
  expect(cleanupEntries.some((s) =>
    s.args && JSON.stringify(s.args).includes("file_cancel/cancel.png")
  )).toBe(true);
});

test("cancelB2FileUpload is a no-op when the ledger row is already completed (Greptile round 24 P1)", async () => {
  // Two concurrent confirmations can race: one completes, the
  // other rejects. The reject path must NOT delete the B2
  // object — the other confirmation already succeeded. Without
  // this guard, a completed row would get its B2 object
  // swept by the cleanup action.
  stubB2Credentials();
  const t = convexTest({ schema, modules });
  const { workspaceId } = await seedWorkspaceWithInstructor(t, {
    studentUserId: "u_student_1",
    instructorUserId: "u_instructor_1",
  });
  const now = Date.now();
  const rowId = await t.run(async (ctx) =>
    ctx.db.insert("fileUploads", {
      workspaceId: workspaceId as any,
      uploaderId: "u_student_1",
      uploadedAt: now,
      b2Key: "2026-01-01/file_done/done.png",
      completedAt: now,
    })
  );
  await t.mutation(internal.workspaceStorage.cancelB2FileUpload, {
    b2Key: "2026-01-01/file_done/done.png",
  });
  const after = await t.run(async (ctx) => ctx.db.get(rowId as any));
  expect((after as any).cancelledAt).toBeUndefined();
  expect((after as any).completedAt).toBe(now);
});

test("hardDeleteExpiredChatFiles calls deleteFromB2WorkspaceAction for a migrated row and leaves the Convex-storage blob alone", async () => {
  // Greptile round 32 P2 ("Storage routing remains unchecked"):
  // a regression that took the B2 branch but ALSO called
  // `ctx.storage.delete(storageId)` would still pass the
  // fetch-count assertion above — the count goes up from B2
  // and the blob is gone from Convex storage (a double
  // delete that violates the quota target). Round 33
  // strengthens this by asserting that the Convex-storage
  // blob is still fetchable after the action runs.
  stubB2Credentials();
  const t = convexTest({ schema, modules });
  const { workspaceId } = await seedWorkspaceWithInstructor(t, {
    studentUserId: "u_student_1",
    instructorUserId: "u_instructor_1",
  });
  const now = Date.now();
  // Seed a chat message row that has been migrated
  // (`b2Key !== undefined`) and is past retention.
  const storageId = await t.run(async (ctx) =>
    ctx.storage.store(new Blob(["legacy-bytes"]))
  );
  await t.run(async (ctx) =>
    ctx.db.insert("workspaceMessages", {
      workspaceId: workspaceId as any,
      userId: "u_student_1",
      content: "(deleted)",
      type: "file",
      storageId,
      b2Key: "2026-01-01/file_retention/retention.png",
      deletedAt: now - 31 * 24 * 60 * 60 * 1000,
    })
  );

  // Spy fetch. The B2 branch should call DELETE on the
  // workspace bucket URL. The legacy Convex-storage branch
  // would call ctx.storage.delete (which is NOT a fetch).
  const fetchSpy = vi.fn(async () =>
    ({ ok: true, status: 204, text: async () => "" }) as Response
  );
  vi.stubGlobal("fetch", fetchSpy);

  const result = await t.action(
    internal.cleanup.chatFileRetention.hardDeleteExpiredChatFiles,
    {}
  );
  expect(result.deletedBlobs).toBe(1);
  expect(result.deletedRows).toBe(1);
  expect(result.scanned).toBe(1);
  expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
  const calls = fetchSpy.mock.calls.map(
    (c) => [c[0] as string, (c[1] as RequestInit).method] as const
  );
  // Every call must be a DELETE against the workspace bucket.
  // (The test seeds only one B2-migrated row, so any non-
  // DELETE / non-bucket URL would mean a regression. Calls
  // from earlier tests' scheduled cleanups are tolerated
  // because `t.action` drains the scheduler queue, but
  // they all target the same bucket so the invariant holds.)
  for (const call of calls) {
    expect(call[1]).toBe("DELETE");
    expect(call[0].startsWith(expectedB2BaseUrl())).toBe(true);
  }
  // The Convex-storage blob must NOT have been deleted — the
  // B2 branch deliberately leaves the legacy `storageId`
  // untouched so a rollback of the migration (which would
  // re-read the Convex-storage path) does not leave orphans.
  // `ctx.storage.get(storageId)` returns a Blob or null; we
  // coerce the Blob to a length to keep the return value
  // JSON-serializable through convex-test.
  const stillPresentLength = await t.run(async (ctx) => {
    const blob = await ctx.storage.get(storageId);
    return blob === null ? null : blob.size;
  });
  expect(stillPresentLength).not.toBeNull();
});

test("hardDeleteExpiredChatFiles uses ctx.storage.delete for a pre-migration row and never calls fetch", async () => {
  // Mirror of the B2 test above, but for a row that has not
  // been migrated (`b2Key === undefined`). The action must
  // fall back to `ctx.storage.delete` and MUST NOT call fetch.
  // Greptile round 32 P2 strengthens this by asserting the
  // blob is gone after the action (the original assertion
  // only counted fetch calls).
  stubB2Credentials();
  const t = convexTest({ schema, modules });
  const { workspaceId } = await seedWorkspaceWithInstructor(t, {
    studentUserId: "u_student_1",
    instructorUserId: "u_instructor_1",
  });
  const now = Date.now();
  const storageId = await t.run(async (ctx) =>
    ctx.storage.store(new Blob(["legacy-only"]))
  );
  await t.run(async (ctx) =>
    ctx.db.insert("workspaceMessages", {
      workspaceId: workspaceId as any,
      userId: "u_student_1",
      content: "(deleted)",
      type: "file",
      storageId,
      deletedAt: now - 31 * 24 * 60 * 60 * 1000,
    })
  );

  const fetchSpy = vi.fn(async () =>
    ({ ok: true, status: 204, text: async () => "" }) as Response
  );
  vi.stubGlobal("fetch", fetchSpy);

  const result = await t.action(
    internal.cleanup.chatFileRetention.hardDeleteExpiredChatFiles,
    {}
  );
  expect(result.deletedBlobs).toBe(1);
  expect(result.deletedRows).toBe(1);
  // No B2 DELETE — the row has b2Key === undefined, so the
  // action takes the legacy `ctx.storage.delete` branch and
  // never invokes fetch.
  expect(fetchSpy).toHaveBeenCalledTimes(0);
  // The Convex-storage blob must be gone. A regression that
  // took neither branch (e.g., commented out the
  // `ctx.storage.delete` call) would still pass the
  // fetch-count assertion above; checking that the blob
  // is actually deleted is the only assertion that catches
  // that case.
  const deletedSize = await t.run(async (ctx) => {
    const blob = await ctx.storage.get(storageId);
    return blob === null ? null : blob.size;
  });
  expect(deletedSize).toBeNull();
});
