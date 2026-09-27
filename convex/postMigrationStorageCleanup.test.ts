/// <reference types="vite/client" />
import type { Id } from "./_generated/dataModel";
/**
 * PR workspace-storage-3a (post-migration Convex-storage cleanup):
 * convex-test cases for the daily
 * `cleanupMigratedConvexStorageBlobs` cron.
 *
 * Scope:
 *   - Candidate query (listCleanupCandidates): grace window,
 *     migratedAt threshold, carve-outs for cancelled rows /
 *     already-cleaned rows / missing B2 copy / missing
 *     Convex Storage blob.
 *   - Live-ref query (findLiveStorageReferencesForCleanup):
 *     each of the four referencing tables
 *     (workspaceImages / instructorResources /
 *     workspaceMessages / workspaceNoteComments) keeps the
 *     blob alive when the row is non-deleted.
 *   - Orchestrator (cleanupMigratedConvexStorageBlobs):
 *     deletes blob + stamps ledger when no live refs;
 *     skips when live refs exist; idempotent across
 *     consecutive runs; bounded pagination drains a batch.
 *
 * Convex-test cannot reach B2, so we never call `ctx.storage`
 * for the B2 PUT/DELETE path here — only the Convex Storage
 * side. B2 integration is exercised by the staging sweep +
 * the existing `workspaceStorage.test.ts` B2 coverage.
 */
import { convexTest } from "convex-test";
import { expect, test, vi, afterEach } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const BACKFILL_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

afterEach(() => {
  vi.unstubAllGlobals();
});

async function seedWorkspace(
  t: ReturnType<typeof convexTest>,
  args: { ownerId: string; endedAt?: number; deletedAt?: number }
): Promise<string> {
  let id = "";
  await t.run(async (ctx) => {
    id = await ctx.db.insert("workspaces", {
      name: "Test Workspace",
      ownerId: args.ownerId,
      isPublic: false,
      studentImageCount: 0,
      instructorImageCount: 0,
      endedAt: args.endedAt,
      deletedAt: args.deletedAt,
    });
  });
  return id;
}

async function seedMigratedRow(
  t: ReturnType<typeof convexTest>,
  args: {
    workspaceId: string;
    uploaderId: string;
    uploadedAt: number;
    migratedAt: number;
    b2Key: string;
    seedBlobBytes?: string;
    cancelledAt?: number;
    convexStorageBlobsDeletedAt?: number;
    completedAt?: number;
  }
): Promise<{ rowId: string; storageId: Id<"_storage"> }> {
  const storageId = await t.action(async (ctx) =>
    ctx.storage.store(new Blob([args.seedBlobBytes ?? "seed-bytes"]))
  );
  const rowId = await t.run(async (ctx) =>
    ctx.db.insert("fileUploads", {
      workspaceId: args.workspaceId as any,
      uploaderId: args.uploaderId,
      uploadedAt: args.uploadedAt,
      storageId,
      b2Key: args.b2Key,
      migratedAt: args.migratedAt,
      cancelledAt: args.cancelledAt,
      completedAt: args.completedAt ?? args.migratedAt,
      convexStorageBlobsDeletedAt: args.convexStorageBlobsDeletedAt,
    })
  );
  return { rowId, storageId };
}

test("listCleanupCandidates drops rows inside the grace window", async () => {
  const t = convexTest({ schema, modules });
  const now = Date.now();
  const workspaceId = await seedWorkspace(t, { ownerId: "u_owner_1" });
  const oldRow = await seedMigratedRow(t, {
    workspaceId,
    uploaderId: "u_uploader_1",
    uploadedAt: now - 30 * 24 * 60 * 60 * 1000,
    migratedAt: now - 10 * 24 * 60 * 60 * 1000,
    b2Key: "2026-01-01/file_old/old.png",
  });
  const recentRow = await seedMigratedRow(t, {
    workspaceId,
    uploaderId: "u_uploader_1",
    uploadedAt: now - 30 * 24 * 60 * 60 * 1000,
    migratedAt: now - 1 * 24 * 60 * 60 * 1000,
    b2Key: "2026-01-01/file_recent/recent.png",
  });
  const result = await t.query(
    internal.cleanup.postMigrationStorageCleanup.listCleanupCandidates,
    {
      threshold: now - BACKFILL_GRACE_MS,
      limit: 50,
      cursor: null,
    }
  );
  const ids = result.rows.map((r) => r._id);
  expect(ids).toContain(oldRow.rowId);
  expect(ids).not.toContain(recentRow.rowId);
});

test("listCleanupCandidates drops rows without a B2 copy", async () => {
  const t = convexTest({ schema, modules });
  const now = Date.now();
  const workspaceId = await seedWorkspace(t, { ownerId: "u_owner_1" });
  // Seed a row whose storageId is set but b2Key is not — the
  // migration action hasn't finalized yet, so the post-filter
  // must exclude it (Greptile P2: candidate scope).
  const storageId = await t.action(async (ctx) =>
    ctx.storage.store(new Blob(["unfinalized"]))
  );
  const unmigratedRowId = await t.run(async (ctx) =>
    ctx.db.insert("fileUploads", {
      workspaceId: workspaceId as any,
      uploaderId: "u_uploader_1",
      uploadedAt: now - 30 * 24 * 60 * 60 * 1000,
      storageId,
      migratedAt: now - 10 * 24 * 60 * 60 * 1000,
      completedAt: now - 10 * 24 * 60 * 60 * 1000,
      // b2Key intentionally undefined
    })
  );
  const result = await t.query(
    internal.cleanup.postMigrationStorageCleanup.listCleanupCandidates,
    {
      threshold: now - BACKFILL_GRACE_MS,
      limit: 50,
      cursor: null,
    }
  );
  expect(result.rows.map((r) => r._id)).not.toContain(unmigratedRowId);
});

test("listCleanupCandidates drops cancelled rows", async () => {
  const t = convexTest({ schema, modules });
  const now = Date.now();
  const workspaceId = await seedWorkspace(t, { ownerId: "u_owner_1" });
  const cancelledRow = await seedMigratedRow(t, {
    workspaceId,
    uploaderId: "u_uploader_1",
    uploadedAt: now - 30 * 24 * 60 * 60 * 1000,
    migratedAt: now - 10 * 24 * 60 * 60 * 1000,
    b2Key: "2026-01-01/file_cancelled/cancelled.png",
    cancelledAt: now - 1 * 24 * 60 * 60 * 1000,
  });
  const result = await t.query(
    internal.cleanup.postMigrationStorageCleanup.listCleanupCandidates,
    {
      threshold: now - BACKFILL_GRACE_MS,
      limit: 50,
      cursor: null,
    }
  );
  expect(result.rows.map((r) => r._id)).not.toContain(cancelledRow.rowId);
});

test("listCleanupCandidates drops rows already marked deleted", async () => {
  const t = convexTest({ schema, modules });
  const now = Date.now();
  const workspaceId = await seedWorkspace(t, { ownerId: "u_owner_1" });
  const deletedRow = await seedMigratedRow(t, {
    workspaceId,
    uploaderId: "u_uploader_1",
    uploadedAt: now - 30 * 24 * 60 * 60 * 1000,
    migratedAt: now - 10 * 24 * 60 * 60 * 1000,
    b2Key: "2026-01-01/file_already/already.png",
    convexStorageBlobsDeletedAt: now - 1 * 24 * 60 * 60 * 1000,
  });
  const result = await t.query(
    internal.cleanup.postMigrationStorageCleanup.listCleanupCandidates,
    {
      threshold: now - BACKFILL_GRACE_MS,
      limit: 50,
      cursor: null,
    }
  );
  expect(result.rows.map((r) => r._id)).not.toContain(deletedRow.rowId);
});

test("listCleanupCandidates drops rows missing completedAt", async () => {
  const t = convexTest({ schema, modules });
  const now = Date.now();
  const workspaceId = await seedWorkspace(t, { ownerId: "u_owner_1" });
  const storageId = await t.action(async (ctx) =>
    ctx.storage.store(new Blob(["not-finalized"]))
  );
  const notFinalizedRowId = await t.run(async (ctx) =>
    ctx.db.insert("fileUploads", {
      workspaceId: workspaceId as any,
      uploaderId: "u_uploader_1",
      uploadedAt: now - 30 * 24 * 60 * 60 * 1000,
      storageId,
      migratedAt: now - 10 * 24 * 60 * 60 * 1000,
      b2Key: "2026-01-01/file_unfinalized/unfinalized.png",
      // completedAt intentionally undefined — migration has
      // the lock but the finalize step has not run yet.
    })
  );
  const result = await t.query(
    internal.cleanup.postMigrationStorageCleanup.listCleanupCandidates,
    {
      threshold: now - BACKFILL_GRACE_MS,
      limit: 50,
      cursor: null,
    }
  );
  expect(result.rows.map((r) => r._id)).not.toContain(notFinalizedRowId);
});

test("findLiveStorageReferencesForCleanup detects workspaceImages ref", async () => {
  const t = convexTest({ schema, modules });
  const workspaceId = await seedWorkspace(t, { ownerId: "u_owner_1" });
  const { storageId } = await seedMigratedRow(t, {
    workspaceId,
    uploaderId: "u_uploader_1",
    uploadedAt: Date.now() - 30 * 24 * 60 * 60 * 1000,
    migratedAt: Date.now() - 10 * 24 * 60 * 60 * 1000,
    b2Key: "2026-01-01/file_image/image.png",
  });
  await t.run(async (ctx) => {
    await ctx.db.insert("workspaceImages", {
      workspaceId: workspaceId as any,
      imageUrl: "data:image/png;base64,...",
      storageId,
      createdBy: "u_owner_1",
      b2Key: "2026-01-01/file_image/image.png",
    });
  });
  const refs = await t.query(
    internal.cleanup.postMigrationStorageCleanup
      .findLiveStorageReferencesForCleanup,
    { storageId }
  );
  expect(refs.imageId).not.toBeNull();
  expect(refs.resourceId).toBeNull();
  expect(refs.chatMessageId).toBeNull();
  expect(refs.noteCommentId).toBeNull();
});

test("findLiveStorageReferencesForCleanup detects instructorResources ref", async () => {
  const t = convexTest({ schema, modules });
  const workspaceId = await seedWorkspace(t, { ownerId: "u_owner_1" });
  const { storageId } = await seedMigratedRow(t, {
    workspaceId,
    uploaderId: "u_uploader_1",
    uploadedAt: Date.now() - 30 * 24 * 60 * 60 * 1000,
    migratedAt: Date.now() - 10 * 24 * 60 * 60 * 1000,
    b2Key: "2026-01-01/file_resource/resource.png",
  });
  let instructorId = "";
  await t.run(async (ctx) => {
    instructorId = await ctx.db.insert("instructors", { userId: "u_inst_1" });
    await ctx.db.insert("instructorResources", {
      instructorId: instructorId as any,
      workspaceId: workspaceId as any,
      storageId,
      fileName: "resource.png",
      contentType: "image/png",
      size: 12,
      type: "image",
      createdBy: "u_inst_1",
      createdAt: Date.now(),
    });
  });
  const refs = await t.query(
    internal.cleanup.postMigrationStorageCleanup
      .findLiveStorageReferencesForCleanup,
    { storageId }
  );
  expect(refs.resourceId).not.toBeNull();
  expect(refs.imageId).toBeNull();
  expect(refs.chatMessageId).toBeNull();
  expect(refs.noteCommentId).toBeNull();
});

test("findLiveStorageReferencesForCleanup detects workspaceMessages ref", async () => {
  const t = convexTest({ schema, modules });
  const workspaceId = await seedWorkspace(t, { ownerId: "u_owner_1" });
  const { storageId } = await seedMigratedRow(t, {
    workspaceId,
    uploaderId: "u_uploader_1",
    uploadedAt: Date.now() - 30 * 24 * 60 * 60 * 1000,
    migratedAt: Date.now() - 10 * 24 * 60 * 60 * 1000,
    b2Key: "2026-01-01/file_msg/msg.png",
  });
  await t.run(async (ctx) => {
    await ctx.db.insert("workspaceMessages", {
      workspaceId: workspaceId as any,
      userId: "u_owner_1",
      content: "shared an image",
      type: "image",
      storageId,
      b2Key: "2026-01-01/file_msg/msg.png",
    });
  });
  const refs = await t.query(
    internal.cleanup.postMigrationStorageCleanup
      .findLiveStorageReferencesForCleanup,
    { storageId }
  );
  expect(refs.chatMessageId).not.toBeNull();
  expect(refs.imageId).toBeNull();
  expect(refs.resourceId).toBeNull();
  expect(refs.noteCommentId).toBeNull();
});

test("findLiveStorageReferencesForCleanup detects workspaceNoteComments ref", async () => {
  const t = convexTest({ schema, modules });
  const workspaceId = await seedWorkspace(t, { ownerId: "u_owner_1" });
  const { storageId } = await seedMigratedRow(t, {
    workspaceId,
    uploaderId: "u_uploader_1",
    uploadedAt: Date.now() - 30 * 24 * 60 * 60 * 1000,
    migratedAt: Date.now() - 10 * 24 * 60 * 60 * 1000,
    b2Key: "2026-01-01/file_note/note.png",
  });
  let noteId = "";
  await t.run(async (ctx) => {
    noteId = await ctx.db.insert("workspaceNotes", {
      workspaceId: workspaceId as any,
      title: "Note",
      content: "",
      createdBy: "u_owner_1",
      updatedAt: Date.now(),
    });
    await ctx.db.insert("workspaceNoteComments", {
      noteId: noteId as any,
      content: "see attached",
      createdBy: "u_owner_1",
      createdAt: Date.now(),
      storageId: storageId as any,
      b2Key: "2026-01-01/file_note/note.png",
    });
  });
  const refs = await t.query(
    internal.cleanup.postMigrationStorageCleanup
      .findLiveStorageReferencesForCleanup,
    { storageId }
  );
  expect(refs.noteCommentId).not.toBeNull();
  expect(refs.imageId).toBeNull();
  expect(refs.resourceId).toBeNull();
  expect(refs.chatMessageId).toBeNull();
});

test("findLiveStorageReferencesForCleanup ignores soft-deleted rows", async () => {
  const t = convexTest({ schema, modules });
  const workspaceId = await seedWorkspace(t, { ownerId: "u_owner_1" });
  const { storageId } = await seedMigratedRow(t, {
    workspaceId,
    uploaderId: "u_uploader_1",
    uploadedAt: Date.now() - 30 * 24 * 60 * 60 * 1000,
    migratedAt: Date.now() - 10 * 24 * 60 * 60 * 1000,
    b2Key: "2026-01-01/file_deleted/deleted.png",
  });
  await t.run(async (ctx) => {
    await ctx.db.insert("workspaceImages", {
      workspaceId: workspaceId as any,
      imageUrl: "data:image/png;base64,...",
      storageId,
      createdBy: "u_owner_1",
      b2Key: "2026-01-01/file_deleted/deleted.png",
      deletedAt: Date.now() - 5 * 24 * 60 * 60 * 1000,
    });
  });
  const refs = await t.query(
    internal.cleanup.postMigrationStorageCleanup
      .findLiveStorageReferencesForCleanup,
    { storageId }
  );
  expect(refs.imageId).toBeNull();
});

test("cleanupMigratedConvexStorageBlobs deletes blob + stamps ledger when no refs", async () => {
  const t = convexTest({ schema, modules });
  const now = Date.now();
  const workspaceId = await seedWorkspace(t, { ownerId: "u_owner_1" });
  const { rowId, storageId } = await seedMigratedRow(t, {
    workspaceId,
    uploaderId: "u_uploader_1",
    uploadedAt: now - 30 * 24 * 60 * 60 * 1000,
    migratedAt: now - 10 * 24 * 60 * 60 * 1000,
    b2Key: "2026-01-01/file_orphan/orphan.png",
    seedBlobBytes: "to-be-deleted",
  });
  const result = await t.action(
    internal.cleanup.postMigrationStorageCleanup
      .cleanupMigratedConvexStorageBlobs,
    {}
  );
  expect(result.scanned).toBe(1);
  expect(result.deletedBlobs).toBe(1);
  expect(result.skippedLiveRefs).toBe(0);
  expect(result.errors).toEqual([]);
  const row = await t.run(async (ctx) => ctx.db.get(rowId as any));
  expect(row?.convexStorageBlobsDeletedAt).toBeTypeOf("number");
  const blobExists = await t.action(async (ctx) => (await ctx.storage.get(storageId as Id<"_storage">)) !== null);
  expect(blobExists).toBe(false);
});

test("cleanupMigratedConvexStorageBlobs skips when workspaceImages ref exists", async () => {
  const t = convexTest({ schema, modules });
  const now = Date.now();
  const workspaceId = await seedWorkspace(t, { ownerId: "u_owner_1" });
  const { rowId, storageId } = await seedMigratedRow(t, {
    workspaceId,
    uploaderId: "u_uploader_1",
    uploadedAt: now - 30 * 24 * 60 * 60 * 1000,
    migratedAt: now - 10 * 24 * 60 * 60 * 1000,
    b2Key: "2026-01-01/file_keep_image/keep.png",
  });
  await t.run(async (ctx) => {
    await ctx.db.insert("workspaceImages", {
      workspaceId: workspaceId as any,
      imageUrl: "data:image/png;base64,...",
      storageId,
      createdBy: "u_owner_1",
      b2Key: "2026-01-01/file_keep_image/keep.png",
    });
  });
  const result = await t.action(
    internal.cleanup.postMigrationStorageCleanup
      .cleanupMigratedConvexStorageBlobs,
    {}
  );
  expect(result.scanned).toBe(1);
  expect(result.deletedBlobs).toBe(0);
  expect(result.skippedLiveRefs).toBe(1);
  const row = await t.run(async (ctx) => ctx.db.get(rowId as any));
  expect(row?.convexStorageBlobsDeletedAt).toBeUndefined();
  const blobExists = await t.action(async (ctx) => (await ctx.storage.get(storageId as Id<"_storage">)) !== null);
  expect(blobExists).toBe(true);
});

test("cleanupMigratedConvexStorageBlobs skips when workspaceNoteComments ref exists", async () => {
  const t = convexTest({ schema, modules });
  const now = Date.now();
  const workspaceId = await seedWorkspace(t, { ownerId: "u_owner_1" });
  const { rowId, storageId } = await seedMigratedRow(t, {
    workspaceId,
    uploaderId: "u_uploader_1",
    uploadedAt: now - 30 * 24 * 60 * 60 * 1000,
    migratedAt: now - 10 * 24 * 60 * 60 * 1000,
    b2Key: "2026-01-01/file_keep_note/keep.png",
  });
  let noteId = "";
  await t.run(async (ctx) => {
    noteId = await ctx.db.insert("workspaceNotes", {
      workspaceId: workspaceId as any,
      title: "Note",
      content: "",
      createdBy: "u_owner_1",
      updatedAt: Date.now(),
    });
    await ctx.db.insert("workspaceNoteComments", {
      noteId: noteId as any,
      content: "see attached",
      createdBy: "u_owner_1",
      createdAt: Date.now(),
      storageId: storageId as any,
      b2Key: "2026-01-01/file_keep_note/keep.png",
    });
  });
  const result = await t.action(
    internal.cleanup.postMigrationStorageCleanup
      .cleanupMigratedConvexStorageBlobs,
    {}
  );
  expect(result.scanned).toBe(1);
  expect(result.deletedBlobs).toBe(0);
  expect(result.skippedLiveRefs).toBe(1);
  const row = await t.run(async (ctx) => ctx.db.get(rowId as any));
  expect(row?.convexStorageBlobsDeletedAt).toBeUndefined();
  const blobExists = await t.action(async (ctx) => (await ctx.storage.get(storageId as Id<"_storage">)) !== null);
  expect(blobExists).toBe(true);
});

test("cleanupMigratedConvexStorageBlobs is idempotent across runs", async () => {
  const t = convexTest({ schema, modules });
  const now = Date.now();
  const workspaceId = await seedWorkspace(t, { ownerId: "u_owner_1" });
  await seedMigratedRow(t, {
    workspaceId,
    uploaderId: "u_uploader_1",
    uploadedAt: now - 30 * 24 * 60 * 60 * 1000,
    migratedAt: now - 10 * 24 * 60 * 60 * 1000,
    b2Key: "2026-01-01/file_idem/idem.png",
  });
  const first = await t.action(
    internal.cleanup.postMigrationStorageCleanup
      .cleanupMigratedConvexStorageBlobs,
    {}
  );
  expect(first.deletedBlobs).toBe(1);
  const second = await t.action(
    internal.cleanup.postMigrationStorageCleanup
      .cleanupMigratedConvexStorageBlobs,
    {}
  );
  expect(second.deletedBlobs).toBe(0);
  expect(second.scanned).toBe(0);
});

test("cleanupMigratedConvexStorageBlobs drains batches", async () => {
  const t = convexTest({ schema, modules });
  const now = Date.now();
  const workspaceId = await seedWorkspace(t, { ownerId: "u_owner_1" });
  // Seed 5 candidates. The default `BATCH_SIZE` (50) fits all
  // in a single page — we just verify the orchestrator returns
  // the expected counts.
  for (let i = 0; i < 5; i++) {
    await seedMigratedRow(t, {
      workspaceId,
      uploaderId: "u_uploader_1",
      uploadedAt: now - 30 * 24 * 60 * 60 * 1000,
      migratedAt: now - 10 * 24 * 60 * 60 * 1000,
      b2Key: `2026-01-01/file_batch_${i}/b${i}.png`,
    });
  }
  const result = await t.action(
    internal.cleanup.postMigrationStorageCleanup
      .cleanupMigratedConvexStorageBlobs,
    {}
  );
  expect(result.scanned).toBe(5);
  expect(result.deletedBlobs).toBe(5);
});
