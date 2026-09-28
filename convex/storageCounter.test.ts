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
  // Exercises `backfillVideoEditorStorageCounterFull` directly via
  // the internal mutation API. Three editors with mixed statuses;
  // verify the counter matches the expected aggregate after a
  // full-scan backfill.
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
    await ctx.runMutation(
      internal.mutations.backfillVideoEditorStorageCounter.backfillVideoEditorStorageCounterFull,
      {}
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
