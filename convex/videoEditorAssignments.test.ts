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

  const editorClient = t.withIdentity({ subject: editorId });

  // Seed an existing upload that consumes 500 MB.
  await editorClient.mutation(api.instructorUploads.createUpload, {
    id: "upload_1",
    instructorId,
    filename: "key/upload_1",
    originalName: "upload_1.mp4",
    contentType: "video/mp4",
    size: 500 * 1024 * 1024,
    uploadedById: editorId,
  });

  const withStorage = await editorClient.query(
    api.videoEditorAssignments.getVideoEditorAssignmentWithStorage,
    { videoEditorId: editorId, instructorId }
  );
  expect(withStorage?.usedBytes).toBe(500 * 1024 * 1024);
  expect(withStorage?.assignment.storageQuotaBytes).toBe(quota);

  // A 600 MB upload should exceed the remaining 500 MB quota.
  await expect(
    editorClient.mutation(api.instructorUploads.createUpload, {
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
    editorClient.mutation(api.instructorUploads.createUpload, {
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

test("createVideoEditorAssignment: admin can create and idempotently re-create", async () => {
  const t = convexTest(schema, modules);

  const instructorId = "instructor_3";
  const editorId = "editor_3";
  const adminId = "admin_3";

  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: instructorId,
      email: "instructor3@example.com",
      clerkId: instructorId,
      role: "instructor",
    });
    await ctx.db.insert("instructors", {
      userId: instructorId,
      email: "instructor3@example.com",
      name: "Instructor Three",
    });
    await ctx.db.insert("users", {
      userId: editorId,
      email: "editor3@example.com",
      clerkId: editorId,
      role: "video_editor",
    });
    await ctx.db.insert("users", {
      userId: adminId,
      email: "admin3@example.com",
      clerkId: adminId,
      role: "admin",
    });
  });

  const adminClient = t.withIdentity({ subject: adminId });

  const created = await adminClient.mutation(
    api.videoEditorAssignments.createVideoEditorAssignment,
    { videoEditorId: editorId, instructorId }
  );
  expect(created.action).toBe("created");

  const existing = await adminClient.mutation(
    api.videoEditorAssignments.createVideoEditorAssignment,
    { videoEditorId: editorId, instructorId }
  );
  expect(existing.action).toBe("exists");
  expect(existing.id).toBe(created.id);

  await expect(
    t.withIdentity({ subject: editorId }).mutation(
      api.videoEditorAssignments.createVideoEditorAssignment,
      { videoEditorId: editorId, instructorId: "other_instructor" }
    )
  ).rejects.toThrow("Forbidden");
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
    t.withIdentity({ subject: editorId }).mutation(api.instructorUploads.createUpload, {
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

test("video editor uploads: bypass the 50GB default instructor cap when no quota is set", async () => {
  const t = convexTest(schema, modules);

  const instructorId = "instructor_4";
  const editorId = "editor_4";

  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: instructorId,
      email: "instructor4@example.com",
      clerkId: instructorId,
      role: "instructor",
    });
    await ctx.db.insert("users", {
      userId: editorId,
      email: "editor4@example.com",
      clerkId: editorId,
      role: "video_editor",
    });
    await ctx.db.insert("videoEditorAssignments", {
      videoEditorId: editorId,
      instructorId,
      assignedAt: Date.now(),
    });
    // Seed an instructor-owned upload that already consumes the full 50GB cap.
    await ctx.db.insert("instructorUploads", {
      instructorId,
      filename: "key/instructor-owned",
      originalName: "instructor-owned.mp4",
      contentType: "video/mp4",
      size: 50 * 1024 * 1024 * 1024,
      status: "completed",
      transferRetryCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      legacyId: "instructor-owned",
    });
  });

  // The video editor should still be able to upload because the default
  // instructor cap is not applied to delegated uploads.
  await expect(
    t.withIdentity({ subject: editorId }).mutation(api.instructorUploads.createUpload, {
      id: "upload_5",
      instructorId,
      filename: "key/upload_5",
      originalName: "upload_5.mp4",
      contentType: "video/mp4",
      size: 1024 * 1024 * 1024,
      uploadedById: editorId,
    })
  ).resolves.toBeDefined();

  // An instructor self-upload would still be blocked by the same cap.
  await expect(
    t.withIdentity({ subject: instructorId }).mutation(api.instructorUploads.createUpload, {
      id: "upload_6",
      instructorId,
      filename: "key/upload_6",
      originalName: "upload_6.mp4",
      contentType: "video/mp4",
      size: 1024,
    })
  ).rejects.toThrow("Storage limit exceeded");
});

test("createUpload: admin bypasses the 50GB instructor cap", async () => {
  const t = convexTest(schema, modules);

  const instructorId = "instructor_5";
  const adminId = "admin_5";

  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: instructorId,
      email: "instructor5@example.com",
      clerkId: instructorId,
      role: "instructor",
    });
    await ctx.db.insert("users", {
      userId: adminId,
      email: "admin5@example.com",
      clerkId: adminId,
      role: "admin",
    });
    // Fill the instructor's storage to the 50GB cap.
    await ctx.db.insert("instructorUploads", {
      instructorId,
      filename: "key/instructor-owned",
      originalName: "instructor-owned.mp4",
      contentType: "video/mp4",
      size: 50 * 1024 * 1024 * 1024,
      status: "completed",
      transferRetryCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      legacyId: "instructor-owned",
    });
  });

  await expect(
    t.withIdentity({ subject: adminId }).mutation(api.instructorUploads.createUpload, {
      id: "upload_7",
      instructorId,
      filename: "key/upload_7",
      originalName: "upload_7.mp4",
      contentType: "video/mp4",
      size: 1024 * 1024 * 1024,
    })
  ).resolves.toBeDefined();
});

test("createUpload: video editor cannot spoof uploadedById to bypass quotas", async () => {
  const t = convexTest(schema, modules);

  const instructorId = "instructor_6";
  const editorId = "editor_6";
  const otherEditorId = "editor_7";

  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: instructorId,
      email: "instructor6@example.com",
      clerkId: instructorId,
      role: "instructor",
    });
    await ctx.db.insert("users", {
      userId: editorId,
      email: "editor6@example.com",
      clerkId: editorId,
      role: "video_editor",
    });
    await ctx.db.insert("users", {
      userId: otherEditorId,
      email: "editor7@example.com",
      clerkId: otherEditorId,
      role: "video_editor",
    });
    await ctx.db.insert("videoEditorAssignments", {
      videoEditorId: editorId,
      instructorId,
      assignedAt: Date.now(),
    });
  });

  await expect(
    t.withIdentity({ subject: editorId }).mutation(api.instructorUploads.createUpload, {
      id: "upload_8",
      instructorId,
      filename: "key/upload_8",
      originalName: "upload_8.mp4",
      contentType: "video/mp4",
      size: 1024,
      uploadedById: otherEditorId,
    })
  ).rejects.toThrow("Video editor uploads must be performed under their own identity");
});

test("createUpload: instructor cannot upload to another instructor's storage", async () => {
  const t = convexTest(schema, modules);

  const instructorId = "instructor_7";
  const otherInstructorId = "instructor_8";

  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: instructorId,
      email: "instructor7@example.com",
      clerkId: instructorId,
      role: "instructor",
    });
    await ctx.db.insert("users", {
      userId: otherInstructorId,
      email: "instructor8@example.com",
      clerkId: otherInstructorId,
      role: "instructor",
    });
  });

  await expect(
    t.withIdentity({ subject: instructorId }).mutation(api.instructorUploads.createUpload, {
      id: "upload_9",
      instructorId: otherInstructorId,
      filename: "key/upload_9",
      originalName: "upload_9.mp4",
      contentType: "video/mp4",
      size: 1024,
    })
  ).rejects.toThrow("Instructors can only upload to their own storage");
});

test("createUpload: video editor cannot upload to an unassigned instructor", async () => {
  const t = convexTest(schema, modules);

  const instructorId = "instructor_9";
  const editorId = "editor_9";

  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: instructorId,
      email: "instructor9@example.com",
      clerkId: instructorId,
      role: "instructor",
    });
    await ctx.db.insert("users", {
      userId: editorId,
      email: "editor9@example.com",
      clerkId: editorId,
      role: "video_editor",
    });
  });

  await expect(
    t.withIdentity({ subject: editorId }).mutation(api.instructorUploads.createUpload, {
      id: "upload_10",
      instructorId,
      filename: "key/upload_10",
      originalName: "upload_10.mp4",
      contentType: "video/mp4",
      size: 1024,
      uploadedById: editorId,
    })
  ).rejects.toThrow("You are not assigned to this instructor");
});
