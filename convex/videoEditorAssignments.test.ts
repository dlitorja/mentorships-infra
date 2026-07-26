/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

/**
 * Smoke tests for per-video-editor per-instructor storage quotas.
 *
 * Covers:
 *   - `getVideoEditorAssignmentWithStorage` returns used bytes.
 *   - `createUpload` rejects uploads that would exceed the editor quota.
 *   - `createUpload` allows uploads within the editor quota.
 */

test("video editor quotas: enforce per-assignment cap in createUpload", async () => {
  const t = convexTest(schema, modules);

  const instructorId = "instructor_1";
  const editorId = "editor_1";
  const quota = 1024 * 1024 * 1024; // 1 GB

  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: instructorId,
      email: "instructor@example.com",
      clerkId: instructorId,
      role: "instructor",
    });
    await ctx.db.insert("users", {
      userId: editorId,
      email: "editor@example.com",
      clerkId: editorId,
      role: "video_editor",
    });
    await ctx.db.insert("videoEditorAssignments", {
      videoEditorId: editorId,
      instructorId,
      assignedAt: Date.now(),
      storageQuotaBytes: quota,
    });
  });

  // Seed an existing upload that consumes 500 MB.
  await t.mutation(api.instructorUploads.createUpload, {
    id: "upload_1",
    instructorId,
    filename: "key/upload_1",
    originalName: "upload_1.mp4",
    contentType: "video/mp4",
    size: 500 * 1024 * 1024,
    uploadedById: editorId,
  });

  const withStorage = await t.query(
    api.videoEditorAssignments.getVideoEditorAssignmentWithStorage,
    { videoEditorId: editorId, instructorId }
  );
  expect(withStorage?.usedBytes).toBe(500 * 1024 * 1024);
  expect(withStorage?.assignment.storageQuotaBytes).toBe(quota);

  // A 600 MB upload should exceed the remaining 500 MB quota.
  await expect(
    t.mutation(api.instructorUploads.createUpload, {
      id: "upload_2",
      instructorId,
      filename: "key/upload_2",
      originalName: "upload_2.mp4",
      contentType: "video/mp4",
      size: 600 * 1024 * 1024,
      uploadedById: editorId,
    })
  ).rejects.toThrow("Video editor storage quota exceeded");

  // A 100 MB upload should fit.
  await expect(
    t.mutation(api.instructorUploads.createUpload, {
      id: "upload_3",
      instructorId,
      filename: "key/upload_3",
      originalName: "upload_3.mp4",
      contentType: "video/mp4",
      size: 100 * 1024 * 1024,
      uploadedById: editorId,
    })
  ).resolves.toBeDefined();
});

test("video editor quotas: no quota means no extra restriction", async () => {
  const t = convexTest(schema, modules);

  const instructorId = "instructor_2";
  const editorId = "editor_2";

  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: instructorId,
      email: "instructor2@example.com",
      clerkId: instructorId,
      role: "instructor",
    });
    await ctx.db.insert("users", {
      userId: editorId,
      email: "editor2@example.com",
      clerkId: editorId,
      role: "video_editor",
    });
    await ctx.db.insert("videoEditorAssignments", {
      videoEditorId: editorId,
      instructorId,
      assignedAt: Date.now(),
    });
  });

  await expect(
    t.mutation(api.instructorUploads.createUpload, {
      id: "upload_4",
      instructorId,
      filename: "key/upload_4",
      originalName: "upload_4.mp4",
      contentType: "video/mp4",
      size: 100 * 1024 * 1024,
      uploadedById: editorId,
    })
  ).resolves.toBeDefined();
});
