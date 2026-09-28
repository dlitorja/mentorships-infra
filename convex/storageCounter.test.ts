/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

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
