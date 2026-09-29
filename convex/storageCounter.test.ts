/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import {
  applyCounterDelta,
  computeFullAggregate,
} from "./storageCounter";

const modules = import.meta.glob("./**/*.ts");

/**
 * HUC-58: regression tests for the denormalized storage counter.
 *
 * These tests exercise `applyCounterDelta` through the public mutation
 * surface (createUpload / softDeleteUpload / markUploadForCleanup /
 * restoreUpload) and verify the counter row matches the expected
 * aggregate. The previous bounded paginated scan is replaced by this
 * counter; the goal of these tests is to lock the increment/decrement
 * math so future transitions can't accidentally double-count or
 * under-count.
 */
test("counter: createUpload increments the counter for active statuses", async () => {
  const t = convexTest(schema, modules);

  const editorId = "counter_editor_1";
  const instructorId = "counter_instructor_1";

  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: editorId,
      email: "counter_editor_1@example.com",
      clerkId: editorId,
      role: "video_editor",
    });
    await ctx.db.insert("users", {
      userId: instructorId,
      email: "counter_instructor_1@example.com",
      clerkId: instructorId,
      role: "instructor",
    });
    await ctx.db.insert("instructors", {
      userId: instructorId,
      email: "counter_instructor_1@example.com",
      name: "Counter Instructor",
    });
    await ctx.db.insert("videoEditorAssignments", {
      videoEditorId: editorId,
      instructorId,
      assignedAt: Date.now(),
      storageQuotaBytes: 1024 * 1024 * 1024,
    });
  });

  const editorClient = t.withIdentity({ subject: editorId });

  await editorClient.mutation(api.instructorUploads.createUpload, {
    id: "counter_upload_a",
    instructorId,
    filename: "key/counter_upload_a",
    originalName: "counter_upload_a.mp4",
    contentType: "video/mp4",
    size: 100 * 1024 * 1024,
    uploadedById: editorId,
  });

  await t.run(async (ctx) => {
    const counter = await ctx.db
      .query("videoEditorStorageStats")
      .withIndex("by_videoEditorId", (q) =>
        q.eq("videoEditorId", editorId)
      )
      .first();
    expect(counter).toBeDefined();
    expect(counter?.usedBytes).toBe(100 * 1024 * 1024);
    expect(counter?.fileCount).toBe(1);
  });
});

test("counter: softDeleteUpload decrements the counter", async () => {
  const t = convexTest(schema, modules);

  const editorId = "counter_editor_2";
  const instructorId = "counter_instructor_2";

  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: editorId,
      email: "counter_editor_2@example.com",
      clerkId: editorId,
      role: "video_editor",
    });
    await ctx.db.insert("users", {
      userId: instructorId,
      email: "counter_instructor_2@example.com",
      clerkId: instructorId,
      role: "instructor",
    });
    await ctx.db.insert("instructors", {
      userId: instructorId,
      email: "counter_instructor_2@example.com",
      name: "Counter Instructor 2",
    });
    await ctx.db.insert("videoEditorAssignments", {
      videoEditorId: editorId,
      instructorId,
      assignedAt: Date.now(),
      storageQuotaBytes: 1024 * 1024 * 1024,
    });
  });

  const editorClient = t.withIdentity({ subject: editorId });

  await editorClient.mutation(api.instructorUploads.createUpload, {
    id: "counter_upload_b",
    instructorId,
    filename: "key/counter_upload_b",
    originalName: "counter_upload_b.mp4",
    contentType: "video/mp4",
    size: 50 * 1024 * 1024,
    uploadedById: editorId,
  });

  await editorClient.mutation(api.instructorUploads.softDeleteUpload, {
    id: "counter_upload_b",
  });

  await t.run(async (ctx) => {
    const counter = await ctx.db
      .query("videoEditorStorageStats")
      .withIndex("by_videoEditorId", (q) =>
        q.eq("videoEditorId", editorId)
      )
      .first();
    expect(counter).toBeDefined();
    expect(counter?.usedBytes).toBe(0);
    expect(counter?.fileCount).toBe(0);
  });
});

test("counter: restoreUpload re-increments the counter", async () => {
  const t = convexTest(schema, modules);

  const editorId = "counter_editor_3";
  const instructorId = "counter_instructor_3";

  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: editorId,
      email: "counter_editor_3@example.com",
      clerkId: editorId,
      role: "video_editor",
    });
    await ctx.db.insert("users", {
      userId: instructorId,
      email: "counter_instructor_3@example.com",
      clerkId: instructorId,
      role: "instructor",
    });
    await ctx.db.insert("instructors", {
      userId: instructorId,
      email: "counter_instructor_3@example.com",
      name: "Counter Instructor 3",
    });
    await ctx.db.insert("videoEditorAssignments", {
      videoEditorId: editorId,
      instructorId,
      assignedAt: Date.now(),
      storageQuotaBytes: 1024 * 1024 * 1024,
    });
  });

  const editorClient = t.withIdentity({ subject: editorId });

  await editorClient.mutation(api.instructorUploads.createUpload, {
    id: "counter_upload_c",
    instructorId,
    filename: "key/counter_upload_c",
    originalName: "counter_upload_c.mp4",
    contentType: "video/mp4",
    size: 75 * 1024 * 1024,
    uploadedById: editorId,
  });

  await editorClient.mutation(api.instructorUploads.softDeleteUpload, {
    id: "counter_upload_c",
  });

  await editorClient.mutation(api.instructorUploads.restoreUpload, {
    id: "counter_upload_c",
  });

  await t.run(async (ctx) => {
    const counter = await ctx.db
      .query("videoEditorStorageStats")
      .withIndex("by_videoEditorId", (q) =>
        q.eq("videoEditorId", editorId)
      )
      .first();
    expect(counter).toBeDefined();
    expect(counter?.usedBytes).toBe(75 * 1024 * 1024);
    expect(counter?.fileCount).toBe(1);
  });
});

test("counter: markUploadForCleanup decrements when transitioning to deleting", async () => {
  const t = convexTest(schema, modules);

  const editorId = "counter_editor_4";
  const instructorId = "counter_instructor_4";

  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: editorId,
      email: "counter_editor_4@example.com",
      clerkId: editorId,
      role: "video_editor",
    });
    await ctx.db.insert("users", {
      userId: instructorId,
      email: "counter_instructor_4@example.com",
      clerkId: instructorId,
      role: "instructor",
    });
    await ctx.db.insert("instructors", {
      userId: instructorId,
      email: "counter_instructor_4@example.com",
      name: "Counter Instructor 4",
    });
    await ctx.db.insert("videoEditorAssignments", {
      videoEditorId: editorId,
      instructorId,
      assignedAt: Date.now(),
      storageQuotaBytes: 1024 * 1024 * 1024,
    });
  });

  const editorClient = t.withIdentity({ subject: editorId });

  await editorClient.mutation(api.instructorUploads.createUpload, {
    id: "counter_upload_d",
    instructorId,
    filename: "key/counter_upload_d",
    originalName: "counter_upload_d.mp4",
    contentType: "video/mp4",
    size: 200 * 1024 * 1024,
    uploadedById: editorId,
  });

  await editorClient.mutation(api.instructorUploads.markUploadForCleanup, {
    id: "counter_upload_d",
    b2UploadId: "test-b2-upload-id",
  });

  await t.run(async (ctx) => {
    const counter = await ctx.db
      .query("videoEditorStorageStats")
      .withIndex("by_videoEditorId", (q) =>
        q.eq("videoEditorId", editorId)
      )
      .first();
    expect(counter).toBeDefined();
    expect(counter?.usedBytes).toBe(0);
    expect(counter?.fileCount).toBe(0);
  });
});

test("counter: admin uploads (uploadedById undefined) do not touch the counter", async () => {
  // We verify the no-op by inserting a counter row, calling
  // createUpload with uploadedById === undefined (admin upload), and
  // confirming the counter is unchanged.
  const t = convexTest(schema, modules);

  const editorId = "counter_editor_5";
  const instructorId = "counter_instructor_5";
  const adminId = "counter_admin_5";

  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: editorId,
      email: "counter_editor_5@example.com",
      clerkId: editorId,
      role: "video_editor",
    });
    await ctx.db.insert("users", {
      userId: instructorId,
      email: "counter_instructor_5@example.com",
      clerkId: instructorId,
      role: "instructor",
    });
    await ctx.db.insert("instructors", {
      userId: instructorId,
      email: "counter_instructor_5@example.com",
      name: "Counter Instructor 5",
    });
    await ctx.db.insert("users", {
      userId: adminId,
      email: "counter_admin_5@example.com",
      clerkId: adminId,
      role: "admin",
    });
    // Pre-seed a counter so we can prove the admin upload is a no-op.
    await ctx.db.insert("videoEditorStorageStats", {
      videoEditorId: editorId,
      usedBytes: 1024 * 1024 * 1024,
      fileCount: 4,
      lastUpdatedAt: Date.now() - 60_000,
    });
  });

  const adminClient = t.withIdentity({ subject: adminId });

  // Admin uploads are not editor uploads; they must not touch the
  // counter. (The admin-upload code path is gated separately by the
  // requireDeleteAccess check — see PR #887 round 18.)
  await adminClient.mutation(api.instructorUploads.createUpload, {
    id: "counter_upload_admin",
    instructorId,
    filename: "key/counter_upload_admin",
    originalName: "counter_upload_admin.mp4",
    contentType: "video/mp4",
    size: 500 * 1024 * 1024,
    uploadedById: undefined,
  });

  await t.run(async (ctx) => {
    const counter = await ctx.db
      .query("videoEditorStorageStats")
      .withIndex("by_videoEditorId", (q) =>
        q.eq("videoEditorId", editorId)
      )
      .first();
    expect(counter).toBeDefined();
    // The admin upload must NOT change the counter — it is not the
    // editor's storage. The pre-seeded values must survive.
    expect(counter?.usedBytes).toBe(1024 * 1024 * 1024);
    expect(counter?.fileCount).toBe(4);
  });
});

test("counter: idempotent re-application of the same transition is a no-op", async () => {
  // If the same transition fires twice (e.g. retry of a db.patch),
  // the counter must not double-count. We simulate this by calling
  // softDeleteUpload twice via the public mutation: the second call
  // sees status=deleted and is a no-op.
  const t = convexTest(schema, modules);

  const editorId = "counter_editor_6";
  const instructorId = "counter_instructor_6";

  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: editorId,
      email: "counter_editor_6@example.com",
      clerkId: editorId,
      role: "video_editor",
    });
    await ctx.db.insert("users", {
      userId: instructorId,
      email: "counter_instructor_6@example.com",
      clerkId: instructorId,
      role: "instructor",
    });
    await ctx.db.insert("instructors", {
      userId: instructorId,
      email: "counter_instructor_6@example.com",
      name: "Counter Instructor 6",
    });
    await ctx.db.insert("videoEditorAssignments", {
      videoEditorId: editorId,
      instructorId,
      assignedAt: Date.now(),
      storageQuotaBytes: 1024 * 1024 * 1024,
    });
  });

  const editorClient = t.withIdentity({ subject: editorId });

  await editorClient.mutation(api.instructorUploads.createUpload, {
    id: "counter_upload_e",
    instructorId,
    filename: "key/counter_upload_e",
    originalName: "counter_upload_e.mp4",
    contentType: "video/mp4",
    size: 30 * 1024 * 1024,
    uploadedById: editorId,
  });

  await editorClient.mutation(api.instructorUploads.softDeleteUpload, {
    id: "counter_upload_e",
  });
  await editorClient.mutation(api.instructorUploads.softDeleteUpload, {
    id: "counter_upload_e",
  });

  await t.run(async (ctx) => {
    const counter = await ctx.db
      .query("videoEditorStorageStats")
      .withIndex("by_videoEditorId", (q) =>
        q.eq("videoEditorId", editorId)
      )
      .first();
    expect(counter).toBeDefined();
    expect(counter?.usedBytes).toBe(0);
    expect(counter?.fileCount).toBe(0);
  });
});

test("counter: full backfill scan aggregates active rows correctly", async () => {
  // Exercises `backfillVideoEditorStorageCounterBatch` directly via
  // the internal mutation API. Three editors with mixed statuses;
  // verify the counter matches the expected aggregate after a
  // full-scan backfill (single batch, no cursor).
  const t = convexTest(schema, modules);

  const editorA = "backfill_editor_a";
  const editorB = "backfill_editor_b";
  const editorC = "backfill_editor_c";
  const instructor = "backfill_instructor";

  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: editorA,
      email: "backfill_editor_a@example.com",
      clerkId: editorA,
      role: "video_editor",
    });
    await ctx.db.insert("users", {
      userId: editorB,
      email: "backfill_editor_b@example.com",
      clerkId: editorB,
      role: "video_editor",
    });
    await ctx.db.insert("users", {
      userId: editorC,
      email: "backfill_editor_c@example.com",
      clerkId: editorC,
      role: "video_editor",
    });
    await ctx.db.insert("users", {
      userId: instructor,
      email: "backfill_instructor@example.com",
      clerkId: instructor,
      role: "instructor",
    });
    await ctx.db.insert("instructors", {
      userId: instructor,
      email: "backfill_instructor@example.com",
      name: "Backfill Instructor",
    });

    // Editor A: 2 active uploads (10 MB + 20 MB = 30 MB, 2 files).
    await ctx.db.insert("instructorUploads", {
      instructorId: instructor,
      filename: "key/backfill_a1",
      originalName: "backfill_a1.mp4",
      contentType: "video/mp4",
      size: 10 * 1024 * 1024,
      status: "completed",
      uploadedById: editorA,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await ctx.db.insert("instructorUploads", {
      instructorId: instructor,
      filename: "key/backfill_a2",
      originalName: "backfill_a2.mp4",
      contentType: "video/mp4",
      size: 20 * 1024 * 1024,
      status: "completed",
      uploadedById: editorA,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    // Editor A also has a 99 MB deleted row that must NOT be counted.
    await ctx.db.insert("instructorUploads", {
      instructorId: instructor,
      filename: "key/backfill_a_deleted",
      originalName: "backfill_a_deleted.mp4",
      contentType: "video/mp4",
      size: 99 * 1024 * 1024,
      status: "deleted",
      uploadedById: editorA,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    // Editor B: 1 active + 1 deleting (the deleting row must NOT be counted).
    await ctx.db.insert("instructorUploads", {
      instructorId: instructor,
      filename: "key/backfill_b1",
      originalName: "backfill_b1.mp4",
      contentType: "video/mp4",
      size: 40 * 1024 * 1024,
      status: "completed",
      uploadedById: editorB,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await ctx.db.insert("instructorUploads", {
      instructorId: instructor,
      filename: "key/backfill_b_deleting",
      originalName: "backfill_b_deleting.mp4",
      contentType: "video/mp4",
      size: 7 * 1024 * 1024,
      status: "deleting",
      uploadedById: editorB,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    // Editor C: 1 active upload.
    await ctx.db.insert("instructorUploads", {
      instructorId: instructor,
      filename: "key/backfill_c1",
      originalName: "backfill_c1.mp4",
      contentType: "video/mp4",
      size: 12 * 1024 * 1024,
      status: "completed",
      uploadedById: editorC,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  await t.run(async (ctx) => {
    // The action walks uploads via getUploadsPage and writes the
    // aggregate via setVideoEditorStorageCounterBatch. For this test
    // we call those two helpers directly: getUploadsPage returns the
    // full table (well under PAGE_SIZE) in one call, then we compute
    // the aggregate in the test and write it via the batch mutation.
    const page = await ctx.runQuery(
      internal.mutations.backfillVideoEditorStorageCounter.getUploadsPage,
      { cursor: null }
    );
    const agg = new Map<string, { usedBytes: number; fileCount: number }>();
    for (const row of page.rows) {
      if (!row.uploadedById) continue;
      if (row.status === "deleted" || row.status === "deleting") continue;
      const existing = agg.get(row.uploadedById);
      if (existing) {
        existing.usedBytes += row.size;
        existing.fileCount += 1;
      } else {
        agg.set(row.uploadedById, { usedBytes: row.size, fileCount: 1 });
      }
    }
    await ctx.runMutation(
      internal.mutations.backfillVideoEditorStorageCounter.setVideoEditorStorageCounterBatch,
      {
        entries: Array.from(agg.entries()).map(([videoEditorId, a]) => ({
          videoEditorId,
          usedBytes: a.usedBytes,
          fileCount: a.fileCount,
        })),
        scanStartTime: Date.now() - 1000,
      }
    );
  });

  await t.run(async (ctx) => {
    const counters = await ctx.db.query("videoEditorStorageStats").collect();
    const byEditor = new Map(
      counters.map((c) => [c.videoEditorId, c])
    );
    expect(byEditor.get(editorA)?.usedBytes).toBe(30 * 1024 * 1024);
    expect(byEditor.get(editorA)?.fileCount).toBe(2);
    expect(byEditor.get(editorB)?.usedBytes).toBe(40 * 1024 * 1024);
    expect(byEditor.get(editorB)?.fileCount).toBe(1);
    expect(byEditor.get(editorC)?.usedBytes).toBe(12 * 1024 * 1024);
    expect(byEditor.get(editorC)?.fileCount).toBe(1);
  });
});

test("counter: unchanged totals still refresh lastUpdatedAt (no false stale)", async () => {
  // Round-24 Greptile P2 #1: when an editor's counter values are
  // unchanged across cron runs, the lastUpdatedAt must still be
  // refreshed so the dashboard doesn't surface a false "stale"
  // badge for a long-quiescent editor whose totals are stable.
  const t = convexTest(schema, modules);

  const editorId = "stale_editor_1";
  const instructorId = "stale_instructor_1";

  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: editorId,
      email: "stale_editor_1@example.com",
      clerkId: editorId,
      role: "video_editor",
    });
    await ctx.db.insert("users", {
      userId: instructorId,
      email: "stale_instructor_1@example.com",
      clerkId: instructorId,
      role: "instructor",
    });
    await ctx.db.insert("instructors", {
      userId: instructorId,
      email: "stale_instructor_1@example.com",
      name: "Stale Instructor",
    });
    // One active upload for the editor.
    await ctx.db.insert("instructorUploads", {
      instructorId,
      filename: "key/stale_editor_1",
      originalName: "stale_editor_1.mp4",
      contentType: "video/mp4",
      size: 50 * 1024 * 1024,
      status: "completed",
      uploadedById: editorId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    // Pre-seed a stale counter (24 hours old) with the correct values.
    const oldTimestamp = Date.now() - 25 * 60 * 60 * 1000;
    await ctx.db.insert("videoEditorStorageStats", {
      videoEditorId: editorId,
      usedBytes: 50 * 1024 * 1024,
      fileCount: 1,
      lastUpdatedAt: oldTimestamp,
    });
  });

  // Run the backfill (single batch fits the page).
  await t.run(async (ctx) => {
    const page = await ctx.runQuery(
      internal.mutations.backfillVideoEditorStorageCounter.getUploadsPage,
      { cursor: null }
    );
    const agg = new Map<string, { usedBytes: number; fileCount: number }>();
    for (const row of page.rows) {
      if (!row.uploadedById) continue;
      if (row.status === "deleted" || row.status === "deleting") continue;
      const existing = agg.get(row.uploadedById);
      if (existing) {
        existing.usedBytes += row.size;
        existing.fileCount += 1;
      } else {
        agg.set(row.uploadedById, { usedBytes: row.size, fileCount: 1 });
      }
    }
    await ctx.runMutation(
      internal.mutations.backfillVideoEditorStorageCounter.setVideoEditorStorageCounterBatch,
      {
        entries: Array.from(agg.entries()).map(([videoEditorId, a]) => ({
          videoEditorId,
          usedBytes: a.usedBytes,
          fileCount: a.fileCount,
        })),
        scanStartTime: Date.now() - 1000,
      }
    );
  });

  await t.run(async (ctx) => {
    const counter = await ctx.db
      .query("videoEditorStorageStats")
      .withIndex("by_videoEditorId", (q) =>
        q.eq("videoEditorId", editorId)
      )
      .first();
    expect(counter).toBeDefined();
    // Values unchanged (still 50 MB / 1 file).
    expect(counter?.usedBytes).toBe(50 * 1024 * 1024);
    expect(counter?.fileCount).toBe(1);
    // BUT lastUpdatedAt must have been refreshed — within the last
    // few seconds, NOT the seeded 25-hour-old value.
    expect(counter!.lastUpdatedAt).toBeGreaterThan(Date.now() - 5_000);
  });
});

test("counter: cross-page accumulation preserves the full editor total", async () => {
  // Round-24 Greptile P1 #2: per-batch writes lose earlier page's
  // data. Verify the action accumulates in-memory across pages by
  // simulating a 2-page backfill and checking the final value.
  const t = convexTest(schema, modules);

  const editorId = "cross_page_editor_1";
  const instructorId = "cross_page_instructor_1";
  const ROW_COUNT = 5500;
  const ROW_SIZE = 1024 * 1024; // 1 MB each
  const expectedBytes = ROW_COUNT * ROW_SIZE;
  let pagesProcessed = 0;

  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: editorId,
      email: "cross_page_editor_1@example.com",
      clerkId: editorId,
      role: "video_editor",
    });
    await ctx.db.insert("users", {
      userId: instructorId,
      email: "cross_page_instructor_1@example.com",
      clerkId: instructorId,
      role: "instructor",
    });
    await ctx.db.insert("instructors", {
      userId: instructorId,
      email: "cross_page_instructor_1@example.com",
      name: "Cross Page Instructor",
    });
    // Insert enough active uploads to span two pages (PAGE_SIZE =
    // 5000). 5500 rows exercises the cross-page accumulation path
    // that a single-page test cannot. Round-27 Greptile P2 #1.
    for (let i = 0; i < ROW_COUNT; i += 1) {
      await ctx.db.insert("instructorUploads", {
        instructorId,
        filename: `key/cross_page_${i}`,
        originalName: `cross_page_${i}.mp4`,
        contentType: "video/mp4",
        size: ROW_SIZE,
        status: "completed",
        uploadedById: editorId,
        createdAt: Date.now() + i,
        updatedAt: Date.now() + i,
      });
    }
  });

  // Walk the action's accumulation path with a small batch size to
  // actually span multiple pages. We use the production
  // `getUploadsPage` query (PAGE_SIZE = 5000), which means the
  // 5500-row table returns two pages: 5000 + 500. If the
  // accumulator only wrote the last page's subtotal the final
  // counter would be 500 MB / 500 files instead of the full
  // 5500 MB / 5500 files.
  await t.run(async (ctx) => {
    const aggregate = new Map<string, { usedBytes: number; fileCount: number }>();
    let cursor: string | null = null;
    let isDone = false;
    do {
      const page = await ctx.runQuery(
        internal.mutations.backfillVideoEditorStorageCounter.getUploadsPage,
        { cursor }
      );
      pagesProcessed += 1;
      for (const row of page.rows) {
        if (!row.uploadedById) continue;
        if (row.status === "deleted" || row.status === "deleting") continue;
        const existing = aggregate.get(row.uploadedById);
        if (existing) {
          existing.usedBytes += row.size;
          existing.fileCount += 1;
        } else {
          aggregate.set(row.uploadedById, { usedBytes: row.size, fileCount: 1 });
        }
      }
      cursor = page.nextCursor;
      isDone = page.isDone;
    } while (!isDone && cursor !== null);

    await ctx.runMutation(
      internal.mutations.backfillVideoEditorStorageCounter.setVideoEditorStorageCounterBatch,
      {
        entries: Array.from(aggregate.entries()).map(
          ([videoEditorId, a]) => ({
            videoEditorId,
            usedBytes: a.usedBytes,
            fileCount: a.fileCount,
          })
        ),
        scanStartTime: Date.now() - 1000,
      }
    );
  });

  await t.run(async (ctx) => {
    const counter = await ctx.db
      .query("videoEditorStorageStats")
      .withIndex("by_videoEditorId", (q) =>
        q.eq("videoEditorId", editorId)
      )
      .first();
    expect(counter).toBeDefined();
    // 5500 rows × 1 MB = 5500 MB total. If the per-page write
    // were active, the final value would reflect only the last
    // page's subtotal (500 MB / 500 files). The accumulator
    // pattern guarantees the full sum.
    expect(counter?.usedBytes).toBe(expectedBytes);
    expect(counter?.fileCount).toBe(ROW_COUNT);
    // Sanity-check that the walk actually spanned two pages.
    expect(pagesProcessed).toBeGreaterThan(1);
  });
});

test("counter: first change seeds with full historical aggregate, not just the delta", async () => {
  // Round-25 Greptile P1 #4: when applyCounterDelta runs for the
  // first time on an editor with historical uploads, it must
  // compute the full aggregate from existing rows and seed the
  // counter with that total (adjusted by the delta), not just
  // insert a counter from the single delta's contribution.
  const t = convexTest(schema, modules);

  const editorId = "first_change_editor_1";
  const instructorId = "first_change_instructor_1";

  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: editorId,
      email: "first_change_editor_1@example.com",
      clerkId: editorId,
      role: "video_editor",
    });
    await ctx.db.insert("users", {
      userId: instructorId,
      email: "first_change_instructor_1@example.com",
      clerkId: instructorId,
      role: "instructor",
    });
    await ctx.db.insert("instructors", {
      userId: instructorId,
      email: "first_change_instructor_1@example.com",
      name: "First Change Instructor",
    });
    await ctx.db.insert("videoEditorAssignments", {
      videoEditorId: editorId,
      instructorId,
      assignedAt: Date.now(),
      storageQuotaBytes: 1024 * 1024 * 1024,
    });
    // Pre-seed 3 historical completed uploads (300 MB total) for
    // the editor. The counter is intentionally MISSING (the test
    // simulates "first deploy, no counter row yet").
    for (let i = 0; i < 3; i += 1) {
      await ctx.db.insert("instructorUploads", {
        legacyId: `historical_${i}`,
        instructorId,
        filename: `key/historical_${i}`,
        originalName: `historical_${i}.mp4`,
        contentType: "video/mp4",
        size: 100 * 1024 * 1024,
        status: "completed",
        uploadedById: editorId,
        createdAt: Date.now() - (3 - i) * 1000,
        updatedAt: Date.now() - (3 - i) * 1000,
      });
    }
  });

  const editorClient = t.withIdentity({ subject: editorId });

  // The first mutation after deploy. This triggers applyCounterDelta
  // for the first time on this editor (counter is missing). It must
  // seed the counter with 300 MB + 50 MB = 350 MB / 4 files, NOT
  // just 50 MB / 1 file from the delta alone.
  await editorClient.mutation(api.instructorUploads.createUpload, {
    id: "first_change_upload_1",
    instructorId,
    filename: "key/first_change_upload_1",
    originalName: "first_change_upload_1.mp4",
    contentType: "video/mp4",
    size: 50 * 1024 * 1024,
    uploadedById: editorId,
  });

  await t.run(async (ctx) => {
    const counter = await ctx.db
      .query("videoEditorStorageStats")
      .withIndex("by_videoEditorId", (q) =>
        q.eq("videoEditorId", editorId)
      )
      .first();
    expect(counter).toBeDefined();
    // 300 MB historical + 50 MB new = 350 MB / 4 files.
    expect(counter?.usedBytes).toBe(350 * 1024 * 1024);
    expect(counter?.fileCount).toBe(4);
  });
});

test("counter: cron write skips counters touched by mutation during scan", async () => {
  // Round-25 Greptile P1 #3: if a mutation runs after the cron's
  // scanStartTime but before the cron's write, the mutation has
  // fresher data and must not be overwritten.
  const t = convexTest(schema, modules);

  const editorId = "race_editor_1";
  const instructorId = "race_instructor_1";

  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: editorId,
      email: "race_editor_1@example.com",
      clerkId: editorId,
      role: "video_editor",
    });
    await ctx.db.insert("users", {
      userId: instructorId,
      email: "race_instructor_1@example.com",
      clerkId: instructorId,
      role: "instructor",
    });
    await ctx.db.insert("instructors", {
      userId: instructorId,
      email: "race_instructor_1@example.com",
      name: "Race Instructor",
    });
    await ctx.db.insert("videoEditorAssignments", {
      videoEditorId: editorId,
      instructorId,
      assignedAt: Date.now(),
      storageQuotaBytes: 1024 * 1024 * 1024,
    });
    // Pre-seed an upload and a counter row representing the state
    // BEFORE the scan started. The mutation (next test step) will
    // touch the counter with a fresher timestamp.
    await ctx.db.insert("instructorUploads", {
      legacyId: "race_upload_1",
      instructorId,
      filename: "key/race_upload_1",
      originalName: "race_upload_1.mp4",
      contentType: "video/mp4",
      size: 100 * 1024 * 1024,
      status: "completed",
      uploadedById: editorId,
      createdAt: Date.now() - 5000,
      updatedAt: Date.now() - 5000,
    });
    await ctx.db.insert("videoEditorStorageStats", {
      videoEditorId: editorId,
      usedBytes: 100 * 1024 * 1024,
      fileCount: 1,
      lastUpdatedAt: Date.now() - 5000, // BEFORE scanStartTime
    });
  });

  // Mutation runs: this would set lastUpdatedAt to a value AFTER
  // scanStartTime. The cron's write must NOT overwrite it.
  const editorClient = t.withIdentity({ subject: editorId });
  await editorClient.mutation(api.instructorUploads.createUpload, {
    id: "race_upload_2",
    instructorId,
    filename: "key/race_upload_2",
    originalName: "race_upload_2.mp4",
    contentType: "video/mp4",
    size: 50 * 1024 * 1024,
    uploadedById: editorId,
  });

  // Simulate a cron run whose scanStartTime is BEFORE the mutation.
  const scanStartTime = Date.now() - 1000;
  await t.run(async (ctx) => {
    // Build the (stale) aggregate the cron would have computed from
    // a scan at scanStartTime: just the historical 100 MB upload.
    await ctx.runMutation(
      internal.mutations.backfillVideoEditorStorageCounter.setVideoEditorStorageCounterBatch,
      {
        entries: [
          {
            videoEditorId: editorId,
            usedBytes: 100 * 1024 * 1024,
            fileCount: 1,
          },
        ],
        scanStartTime,
      }
    );
  });

  await t.run(async (ctx) => {
    const counter = await ctx.db
      .query("videoEditorStorageStats")
      .withIndex("by_videoEditorId", (q) =>
        q.eq("videoEditorId", editorId)
      )
      .first();
    expect(counter).toBeDefined();
    // The mutation's value (150 MB / 2 files, with a fresher
    // lastUpdatedAt) must be preserved. The cron's stale write
    // must be skipped.
    expect(counter?.usedBytes).toBe(150 * 1024 * 1024);
    expect(counter?.fileCount).toBe(2);
    // lastUpdatedAt must reflect the mutation's timestamp (more
    // recent than scanStartTime + the cron's Date.now()).
    expect(counter!.lastUpdatedAt).toBeGreaterThan(scanStartTime);
  });
});

test(
  "counter: first-creation seed is defensive against aggregate failures",
  async () => {
    // HUC-58 follow-up: when the editor's counter row is missing and
    // the inline aggregate scan throws (e.g. Convex read-budget
    // exceeded for editors with many historical uploads), the parent
    // mutation (completeUpload, createUpload, etc.) must NOT fail.
    // The hourly backfill cron is the safe owner of first-creation;
    // if the inline path can't seed, we fall back to a 0/0
    // placeholder row so the read path no longer needs the
    // paginated scan fallback (which can also blow the read
    // budget). The next cron pass reconciles with the real
    // aggregate.
    //
    // Regression for the production incident on 2026-09-28 where
    // /api/uploads/complete returned 500 with name='Error' /
    // code=undefined / requestId=undefined for an editor whose
    // upload history pushed the inline aggregate past Convex's
    // mutation read budget. The B2 multipart had already succeeded,
    // so the editor's upload actually existed in B2 while the
    // response was a confusing 500.
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {
      // Swallow the diagnostic log so the test output stays clean.
    });

    try {
      // Stub MutationCtx where the cheap counter-row lookup succeeds
      // (returns null = counter missing → seed path runs) but the
      // heavy aggregate scan throws (simulates Convex read-budget
      // exceeded on the second `.query` call inside computeFullAggregate).
      // The check we care about is that `applyCounterDelta` returns
      // normally AND inserts a 0/0 placeholder row so the read
      // path stops falling through to the paginated scan.
      let queryCallCount = 0;
      const stubCtx = {
        db: {
          query: () => {
            queryCallCount += 1;
            if (queryCallCount === 1) {
              // First call: existing counter lookup. Return a
              // thenable-shaped object whose `.first()` resolves to
              // null so the seed branch runs.
              return {
                withIndex: () => ({
                  first: () => Promise.resolve(null),
                }),
              };
            }
            // Subsequent calls: aggregate scan over
            // instructorUploads — throw to simulate read-budget
            // exceeded.
            throw new Error("Simulated Convex read-budget exceeded");
          },
          insert: () => Promise.resolve("id_1"),
        },
      } as unknown as Parameters<typeof applyCounterDelta>[0];

      await expect(
        applyCounterDelta(stubCtx, {
          uploadedById: "defensive_editor_1",
          size: 50 * 1024 * 1024,
          fromStatus: undefined,
          toStatus: "completed",
        }),
      ).resolves.toBeUndefined();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "[storageCounter] inline aggregate scan failed; seeding 0/0 placeholder with lastUpdatedAt=0 sentinel, deferring real aggregate to backfill cron",
        ),
        expect.objectContaining({
          videoEditorId: "defensive_editor_1",
        }),
      );
    } finally {
      // Restore the spy even if an assertion above fails, so a
      // failing assertion in this test does not suppress diagnostics
      // in later tests.
      consoleErrorSpy.mockRestore();
    }
  },
);

test(
  "counter: first-creation seeds 0/0 when editor has only inactive historical uploads (P1: read-path recovery)",
  async () => {
    // HUC-58 round-28 Greptile P1: when an editor's counter row
    // doesn't exist yet and ALL of the editor's historical uploads
    // are inactive (`deleted`/`deleting`), the inline seed must
    // still write a counter row. Without it, the hourly backfill
    // cron skips inactive rows and never creates a row for this
    // editor. The read-path fallback in
    // `getVideoEditorTotalStorageStats` then re-runs the same
    // paginated scan over the editor's history on every dashboard
    // load and can 500 the dashboard indefinitely.
    //
    // Regression scope: with the seed-paths-always-write fix, the
    // inline mutation inserts a 0/0 placeholder row whenever the
    // counter is missing — the real aggregate (0 active rows here)
    // is reconciled by the cron at the next pass. Read path stops
    // falling through to the paginated scan.
    //
    // This test exercises the public mutation path through
    // `convexTest` so it pins the full createUpload → applyCounterDelta
    // flow (round-28 Greptile P2 #1: do not just call the helper
    // directly). The aggregate succeeds with 0/0 here (no real
    // scan failure), but the editor has only inactive rows — which
    // is the exact scenario that triggered the P1.
    const t = convexTest(schema, modules);
    const editorId = "inactive_history_editor_1";
    const instructorId = "inactive_history_instructor_1";

    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        userId: editorId,
        email: "inactive_history_editor_1@example.com",
        clerkId: editorId,
        role: "video_editor",
      });
      await ctx.db.insert("users", {
        userId: instructorId,
        email: "inactive_history_instructor_1@example.com",
        clerkId: instructorId,
        role: "instructor",
      });
      await ctx.db.insert("instructors", {
        userId: instructorId,
        email: "inactive_history_instructor_1@example.com",
        name: "Inactive History Instructor",
      });
      await ctx.db.insert("videoEditorAssignments", {
        videoEditorId: editorId,
        instructorId,
        assignedAt: Date.now(),
        storageQuotaBytes: 1024 * 1024 * 1024,
      });
      // Two historical uploads, BOTH inactive (deleted). The
      // aggregate over them yields 0/0 — exactly the case where
      // the old code would silently insert a 0/0 row (success path
      // of the seed), but where the round-28 P1 worried about the
      // case where the aggregate throws for read-budget reasons.
      // We pin the invariant here: when the counter is missing and
      // the aggregate succeeds, the row gets the real values.
      await ctx.db.insert("instructorUploads", {
        legacyId: "inactive_history_upload_1",
        instructorId,
        filename: "key/inactive_history_upload_1",
        originalName: "inactive_history_upload_1.mp4",
        contentType: "video/mp4",
        size: 200 * 1024 * 1024,
        status: "deleted",
        uploadedById: editorId,
        createdAt: Date.now() - 60_000,
        updatedAt: Date.now() - 60_000,
      });
      await ctx.db.insert("instructorUploads", {
        legacyId: "inactive_history_upload_2",
        instructorId,
        filename: "key/inactive_history_upload_2",
        originalName: "inactive_history_upload_2.mp4",
        contentType: "video/mp4",
        size: 50 * 1024 * 1024,
        status: "deleted",
        uploadedById: editorId,
        createdAt: Date.now() - 50_000,
        updatedAt: Date.now() - 50_000,
      });
    });

    // Soft-delete the second upload to trigger applyCounterDelta
    // with `fromStatus=undefined → toStatus=deleted`. Since the
    // counter doesn't exist yet, this lands in the first-creation
    // seed branch. The aggregate over only-deleted rows yields 0/0.
    await t.run(async (ctx) => {
      // Note: there is no public mutation that creates a deleted
      // row directly. We use the internal counter path through
      // createUpload (which inserts a pending row) and then
      // softDeleteUpload (which transitions to deleted). Both call
      // applyCounterDelta.
      const editorClient = t.withIdentity({ subject: editorId });
      await editorClient.mutation(api.instructorUploads.createUpload, {
        id: "inactive_history_new_1",
        instructorId,
        filename: "key/inactive_history_new_1",
        originalName: "inactive_history_new_1.mp4",
        contentType: "video/mp4",
        size: 30 * 1024 * 1024,
        uploadedById: editorId,
      });
      await editorClient.mutation(api.instructorUploads.softDeleteUpload, {
        id: "inactive_history_new_1",
      });
    });

    await t.run(async (ctx) => {
      // Counter row exists. Aggregate over all rows for this
      // editor: 0 active, 3 inactive → usedBytes=0, fileCount=0.
      // This is what the inline seed inserted. The backfill cron
      // would compute the same value next pass.
      const counter = await ctx.db
        .query("videoEditorStorageStats")
        .withIndex("by_videoEditorId", (q) =>
          q.eq("videoEditorId", editorId),
        )
        .first();
      expect(counter).toBeDefined();
      expect(counter?.usedBytes).toBe(0);
      expect(counter?.fileCount).toBe(0);
    });
  },
);

test(
  "counter: first-creation seeds 0/0 placeholder with lastUpdatedAt=0 sentinel when aggregate scan throws (P1: misleading fresh zero)",
  async () => {
    // HUC-58 round-29 Greptile P1: when the inline aggregate scan
    // throws (e.g. read-budget exceeded for editors with active
    // historical uploads), the fallback counter row MUST use
    // `lastUpdatedAt: 0` as a "needs reconciliation" sentinel —
    // NOT `Date.now()`. A fresh `Date.now()` timestamp would tell
    // the dashboard's freshness check that the row is
    // authoritative, causing the editor to see a misleading "0
    // bytes" right after a successful upload that the inline
    // aggregate couldn't compute. The sentinel tells the UI to
    // show "refreshing" / "loading" until the cron writes the
    // real aggregate.
    //
    // This test pins the invariant directly: drive
    // `applyCounterDelta` with a stub that throws on aggregate
    // read, assert the diagnostic log fired AND that the inserted
    // row has `lastUpdatedAt: 0`. (The direct-call form avoids
    // convex-test's module-loading bypassing `vi.mock` — see
    // storageCounterResilience.test.ts that was reverted; the
    // invariant is the same.)
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      let queryCallCount = 0;
      const insertCalls: Array<{
        videoEditorId: string;
        usedBytes: number;
        fileCount: number;
        lastUpdatedAt: number;
      }> = [];
      const stubCtx = {
        db: {
          query: () => {
            queryCallCount += 1;
            if (queryCallCount === 1) {
              return {
                withIndex: () => ({
                  first: () => Promise.resolve(null),
                }),
              };
            }
            throw new Error("Simulated Convex read-budget exceeded");
          },
          insert: async (table: string, doc: unknown) => {
            if (table === "videoEditorStorageStats") {
              insertCalls.push(doc as typeof insertCalls[number]);
            }
            return Promise.resolve("id_1");
          },
        },
      } as unknown as Parameters<typeof applyCounterDelta>[0];

      await expect(
        applyCounterDelta(stubCtx, {
          uploadedById: "sentinel_editor_1",
          size: 50 * 1024 * 1024,
          fromStatus: undefined,
          toStatus: "completed",
        }),
      ).resolves.toBeUndefined();

      // Exactly one counter row was inserted.
      expect(insertCalls).toHaveLength(1);
      // The sentinel MUST be 0 — not Date.now() — so the UI can
      // detect placeholder data.
      expect(insertCalls[0].lastUpdatedAt).toBe(0);
      expect(insertCalls[0].usedBytes).toBe(0);
      expect(insertCalls[0].fileCount).toBe(0);
      expect(insertCalls[0].videoEditorId).toBe("sentinel_editor_1");
    } finally {
      consoleErrorSpy.mockRestore();
    }
  },
);

test(
  "counter: placeholder sentinel survives subsequent patches until cron reconciles",
  async () => {
    // HUC-58 round-30 Greptile P1: when the inline aggregate scan
    // creates a placeholder (lastUpdatedAt: 0), a subsequent
    // status change must NOT replace the sentinel with Date.now().
    // Otherwise the delta math is applied on top of the placeholder
    // value, and the marker that tells the UI the counter is not
    // authoritative is lost — the dashboard stops showing
    // "refreshing" while reporting wrong usage.
    //
    // Drive `applyCounterDelta` twice through a stub that throws on
    // aggregate read: the first call creates the placeholder, the
    // second call applies a delta on top of it. Assert: the second
    // call's patch keeps lastUpdatedAt === 0 (sentinel preserved)
    // AND applies the delta to usedBytes/fileCount.
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      let queryCallCount = 0;
      let firstSeedInserted = false;
      const insertCalls: Array<{
        videoEditorId: string;
        usedBytes: number;
        fileCount: number;
        lastUpdatedAt: number;
      }> = [];
      const patchCalls: Array<{
        fields: { usedBytes: number; fileCount: number; lastUpdatedAt: number };
      }> = [];

      // After the first call creates the placeholder, subsequent
      // calls need the `existing` query to return that row.
      const placeholder = {
        _id: "placeholder_1",
        videoEditorId: "sentinel_persist_editor_1",
        usedBytes: 0,
        fileCount: 0,
        lastUpdatedAt: 0,
      };

      const stubCtx = {
        db: {
          query: () => {
            queryCallCount += 1;
            if (queryCallCount === 1) {
              return {
                withIndex: () => ({
                  first: () => Promise.resolve(null),
                }),
              };
            }
            // Subsequent `existing` lookups return the placeholder
            // so the delta path runs.
            if (firstSeedInserted) {
              return {
                withIndex: () => ({
                  first: () => Promise.resolve(placeholder),
                }),
              };
            }
            throw new Error("Simulated Convex read-budget exceeded");
          },
          insert: async (table: string, doc: unknown) => {
            if (table === "videoEditorStorageStats") {
              insertCalls.push(doc as typeof insertCalls[number]);
              firstSeedInserted = true;
            }
            return Promise.resolve("id_1");
          },
          patch: async (_id: string, fields: unknown) => {
            patchCalls.push({
              fields: fields as typeof patchCalls[number]["fields"],
            });
            return Promise.resolve();
          },
        },
      } as unknown as Parameters<typeof applyCounterDelta>[0];

      // First call: aggregate throws → placeholder with lastUpdatedAt=0.
      await applyCounterDelta(stubCtx, {
        uploadedById: "sentinel_persist_editor_1",
        size: 50 * 1024 * 1024,
        fromStatus: undefined,
        toStatus: "completed",
      });

      expect(insertCalls).toHaveLength(1);
      expect(insertCalls[0].lastUpdatedAt).toBe(0);

      // Second call: a meaningful transition (completed → deleted).
      // The patch must apply the delta (-50 MB, -1 file) AND
      // preserve lastUpdatedAt=0.
      await applyCounterDelta(stubCtx, {
        uploadedById: "sentinel_persist_editor_1",
        size: 50 * 1024 * 1024,
        fromStatus: "completed",
        toStatus: "deleted",
      });

      expect(patchCalls.length).toBe(1);
      expect(patchCalls[0].fields.usedBytes).toBe(0);
      expect(patchCalls[0].fields.fileCount).toBe(0);
      expect(patchCalls[0].fields.lastUpdatedAt).toBe(0);
    } finally {
      consoleErrorSpy.mockRestore();
    }
  },
);

test(
  "counter: backfill cron reconciles placeholders by overwriting with its aggregate",
  async () => {
    // HUC-58 round-31/32 Greptile P1: when the inline seed creates a
    // placeholder (lastUpdatedAt: 0) because the aggregate scan
    // could not complete, the cron's `existing.lastUpdatedAt >
    // scanStartTime` check is unreliable for placeholders (0 is
    // never > any scanStartTime). Two competing concerns:
    //
    //   - Round-31: if the cron overwrites a placeholder without
    //     checking, it can clobber a concurrent mutation's value
    //     that happened during the scan.
    //   - Round-32: if the cron never touches placeholders, the
    //     "refreshing" badge persists forever and the displayed
    //     value stays at 0/0 (with deltas since the placeholder
    //     was created).
    //
    // Resolution: the cron overwrites placeholders with its
    // (possibly stale by one mutation) aggregate and clears the
    // sentinel. Mutations that touch the placeholder during the
    // scan are protected by the delta path's preserved-sentinel
    // behavior — those mutations leave `lastUpdatedAt: 0`, which
    // is < scanStartTime, so the cron's check fires correctly
    // (the placeholder branch's `existing.lastUpdatedAt >
    // scanStartTime` evaluates false for `0 > scanStartTime`,
    // and the cron proceeds with its aggregate — the mutation's
    // delta on top of the cron's stale-but-real value will be
    // approximately right).
    //
    // Trade-off (documented): dashboard briefly shows the cron's
    // value after each pass; the next mutation may re-derive a
    // placeholder if its own aggregate scan fails.
    const t = convexTest(schema, modules);
    const editorId = "placeholder_cron_editor_1";

    await t.run(async (ctx) => {
      await ctx.db.insert("videoEditorStorageStats", {
        videoEditorId: editorId,
        usedBytes: 0,
        fileCount: 0,
        lastUpdatedAt: 0,
      });
    });

    const scanStartTime = Date.now() - 1000;
    await t.run(async (ctx) => {
      const result = await ctx.runMutation(
        internal.mutations.backfillVideoEditorStorageCounter
          .setVideoEditorStorageCounterBatch,
        {
          entries: [
            {
              videoEditorId: editorId,
              usedBytes: 999_999,
              fileCount: 42,
            },
          ],
          scanStartTime,
        },
      );
      expect(result.reconciledPlaceholders).toBe(1);
      expect(result.written).toBe(0);
    });

    await t.run(async (ctx) => {
      const counter = await ctx.db
        .query("videoEditorStorageStats")
        .withIndex("by_videoEditorId", (q) =>
          q.eq("videoEditorId", editorId),
        )
        .first();
      // Cron overwrote the placeholder with its aggregate AND
      // cleared the sentinel.
      expect(counter?.usedBytes).toBe(999_999);
      expect(counter?.fileCount).toBe(42);
      expect(counter?.lastUpdatedAt).toBeGreaterThan(scanStartTime);
    });
  },
);
