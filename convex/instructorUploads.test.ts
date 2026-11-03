/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function seedUser(ctx: any, userId: string, role: string, clerkId = userId) {
  await ctx.db.insert("users", {
    userId,
    clerkId,
    email: `${userId}@example.com`,
    role,
  });
}

async function seedInstructor(ctx: any, userId: string) {
  await ctx.db.insert("instructors", {
    userId,
    email: `${userId}@example.com`,
    name: userId,
  });
}

async function seedUpload(
  ctx: any,
  id: string,
  instructorId: string,
  uploadedById?: string,
  status = "completed"
) {
  await ctx.db.insert("instructorUploads", {
    instructorId,
    filename: `key/${id}`,
    originalName: `${id}.mp4`,
    contentType: "video/mp4",
    size: 1024,
    status,
    transferRetryCount: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    legacyId: id,
    uploadedById,
  });
}

test("softDeleteUpload: instructor owner can soft delete", async () => {
  const t = convexTest(schema, modules);
  const instructorId = "inst_owner";
  const uploadId = "upload_owner";

  await t.run(async (ctx) => {
    await seedUser(ctx, instructorId, "instructor");
    await seedInstructor(ctx, instructorId);
    await seedUpload(ctx, uploadId, instructorId);
  });

  await expect(
    t.withIdentity({ subject: instructorId }).mutation(api.instructorUploads.softDeleteUpload, {
      id: uploadId,
    })
  ).resolves.toMatchObject({ status: "deleted" });
});

test("softDeleteUpload: video editor with active assignment can delete their upload", async () => {
  const t = convexTest(schema, modules);
  const instructorId = "inst_editor";
  const editorId = "editor_active";
  const uploadId = "upload_editor";

  await t.run(async (ctx) => {
    await seedUser(ctx, instructorId, "instructor");
    await seedInstructor(ctx, instructorId);
    await seedUser(ctx, editorId, "video_editor");
    await seedUpload(ctx, uploadId, instructorId, editorId);
    await ctx.db.insert("videoEditorAssignments", {
      videoEditorId: editorId,
      instructorId,
      assignedAt: Date.now(),
    });
  });

  await expect(
    t.withIdentity({ subject: editorId }).mutation(api.instructorUploads.softDeleteUpload, {
      id: uploadId,
    })
  ).resolves.toMatchObject({ status: "deleted" });
});

test("softDeleteUpload: revoked video editor cannot delete their old upload", async () => {
  const t = convexTest(schema, modules);
  const instructorId = "inst_revoked";
  const editorId = "editor_revoked";
  const uploadId = "upload_revoked";

  await t.run(async (ctx) => {
    await seedUser(ctx, instructorId, "instructor");
    await seedInstructor(ctx, instructorId);
    await seedUser(ctx, editorId, "video_editor");
    await seedUpload(ctx, uploadId, instructorId, editorId);
    // No current assignment for this editor/instructor.
  });

  await expect(
    t.withIdentity({ subject: editorId }).mutation(api.instructorUploads.softDeleteUpload, {
      id: uploadId,
    })
  ).rejects.toThrow("Forbidden");
});

test("markUploadForCleanup: requires delete access", async () => {
  const t = convexTest(schema, modules);
  const instructorId = "inst_cleanup";
  const editorId = "editor_cleanup";
  const otherEditorId = "other_editor_cleanup";
  const uploadId = "upload_cleanup";

  await t.run(async (ctx) => {
    await seedUser(ctx, instructorId, "instructor");
    await seedInstructor(ctx, instructorId);
    await seedUser(ctx, editorId, "video_editor");
    await seedUser(ctx, otherEditorId, "video_editor");
    await seedUpload(ctx, uploadId, instructorId, editorId, "uploading");
    await ctx.db.insert("videoEditorAssignments", {
      videoEditorId: editorId,
      instructorId,
      assignedAt: Date.now(),
    });
  });

  await expect(
    t.withIdentity({ subject: otherEditorId }).mutation(api.instructorUploads.markUploadForCleanup, {
      id: uploadId,
      b2UploadId: "b2_upload_id",
    })
  ).rejects.toThrow("Forbidden");

  await expect(
    t.withIdentity({ subject: editorId }).mutation(api.instructorUploads.markUploadForCleanup, {
      id: uploadId,
      b2UploadId: "b2_upload_id",
    })
  ).resolves.toMatchObject({ status: "deleting" });
});

test("deleteUpload: hard delete is admin-only", async () => {
  const t = convexTest(schema, modules);
  const instructorId = "inst_hard";
  const editorId = "editor_hard";
  const adminId = "admin_hard";
  const uploadId = "upload_hard";

  await t.run(async (ctx) => {
    await seedUser(ctx, instructorId, "instructor");
    await seedInstructor(ctx, instructorId);
    await seedUser(ctx, editorId, "video_editor");
    await seedUser(ctx, adminId, "admin");
    await seedUpload(ctx, uploadId, instructorId);
    await ctx.db.insert("videoEditorAssignments", {
      videoEditorId: editorId,
      instructorId,
      assignedAt: Date.now(),
    });
  });

  await expect(
    t.withIdentity({ subject: instructorId }).mutation(api.instructorUploads.hardDeleteUpload, {
      id: uploadId,
    })
  ).rejects.toThrow("only admins can permanently delete");

  await expect(
    t.withIdentity({ subject: editorId }).mutation(api.instructorUploads.hardDeleteUpload, {
      id: uploadId,
    })
  ).rejects.toThrow("only admins can permanently delete");

  await expect(
    t.withIdentity({ subject: adminId }).mutation(api.instructorUploads.hardDeleteUpload, {
      id: uploadId,
    })
  ).resolves.toMatchObject({ success: true, status: "deleting" });
});

/**
 * Unassigned uploads. `instructorId` is optional on `instructorUploads`;
 * `undefined` means an admin or video editor uploaded a file before an
 * instructor was chosen. Access is limited to admins + the uploader
 * until `assignUploadInstructor` runs.
 */

test("createUpload: video editor with an assignment can upload unassigned", async () => {
  const t = convexTest(schema, modules);
  const instructorId = "inst_unassigned_editor";
  const editorId = "editor_unassigned_editor";

  await t.run(async (ctx) => {
    await seedUser(ctx, instructorId, "instructor");
    await seedInstructor(ctx, instructorId);
    await seedUser(ctx, editorId, "video_editor");
    await ctx.db.insert("videoEditorAssignments", {
      videoEditorId: editorId,
      instructorId,
      assignedAt: Date.now(),
    });
  });

  const upload = await t
    .withIdentity({ subject: editorId })
    .mutation(api.instructorUploads.createUpload, {
      id: "upload_unassigned_editor",
      filename: "key/upload_unassigned_editor",
      originalName: "clip.mp4",
      contentType: "video/mp4",
      size: 1024,
      uploadedById: editorId,
    });

  expect(upload?.instructorId).toBeUndefined();
  expect(upload?.uploadedById).toBe(editorId);
});

test("createUpload: video editor without any assignment cannot upload unassigned", async () => {
  const t = convexTest(schema, modules);
  const editorId = "editor_no_assignment";

  await t.run(async (ctx) => {
    await seedUser(ctx, editorId, "video_editor");
  });

  await expect(
    t.withIdentity({ subject: editorId }).mutation(api.instructorUploads.createUpload, {
      id: "upload_no_assignment",
      filename: "key/upload_no_assignment",
      originalName: "clip.mp4",
      contentType: "video/mp4",
      size: 1024,
      uploadedById: editorId,
    })
  ).rejects.toThrow("You are not assigned to any instructor");
});

test("createUpload: instructor cannot upload unassigned", async () => {
  const t = convexTest(schema, modules);
  const instructorId = "inst_cannot_unassign";

  await t.run(async (ctx) => {
    await seedUser(ctx, instructorId, "instructor");
    await seedInstructor(ctx, instructorId);
  });

  await expect(
    t.withIdentity({ subject: instructorId }).mutation(api.instructorUploads.createUpload, {
      id: "upload_instructor_unassigned",
      filename: "key/upload_instructor_unassigned",
      originalName: "clip.mp4",
      contentType: "video/mp4",
      size: 1024,
    })
  ).rejects.toThrow("Instructors can only upload to their own storage");
});

test("createUpload: admin can upload unassigned", async () => {
  const t = convexTest(schema, modules);
  const adminId = "admin_unassigned_upload";

  await t.run(async (ctx) => {
    await seedUser(ctx, adminId, "admin");
  });

  const upload = await t
    .withIdentity({ subject: adminId })
    .mutation(api.instructorUploads.createUpload, {
      id: "upload_admin_unassigned",
      filename: "key/upload_admin_unassigned",
      originalName: "clip.mp4",
      contentType: "video/mp4",
      size: 1024,
    });

  expect(upload?.instructorId).toBeUndefined();
  expect(upload?.uploadedById).toBeUndefined();
});

test("createUpload: unassigned editor uploads count against the union of specific quotas", async () => {
  const t = convexTest(schema, modules);
  const instructorId = "inst_unassigned_quota";
  const editorId = "editor_unassigned_quota";
  const quota = 1000;

  await t.run(async (ctx) => {
    await seedUser(ctx, instructorId, "instructor");
    await seedInstructor(ctx, instructorId);
    await seedUser(ctx, editorId, "video_editor");
    await ctx.db.insert("videoEditorAssignments", {
      videoEditorId: editorId,
      instructorId,
      assignedAt: Date.now(),
      storageQuotaBytes: quota,
    });
  });

  const editorClient = t.withIdentity({ subject: editorId });

  // Consume 500 bytes with an assigned upload so the counter exists.
  await editorClient.mutation(api.instructorUploads.createUpload, {
    id: "upload_quota_seed",
    instructorId,
    filename: "key/upload_quota_seed",
    originalName: "seed.mp4",
    contentType: "video/mp4",
    size: 500,
    uploadedById: editorId,
  });

  // 500 + 600 > 1000: rejected.
  await expect(
    editorClient.mutation(api.instructorUploads.createUpload, {
      id: "upload_quota_unassigned_over",
      filename: "key/upload_quota_unassigned_over",
      originalName: "over.mp4",
      contentType: "video/mp4",
      size: 600,
      uploadedById: editorId,
    })
  ).rejects.toThrow("storage quota exceeded");

  // 500 + 400 <= 1000: allowed.
  const allowed = await editorClient.mutation(api.instructorUploads.createUpload, {
    id: "upload_quota_unassigned_ok",
    filename: "key/upload_quota_unassigned_ok",
    originalName: "ok.mp4",
    contentType: "video/mp4",
    size: 400,
    uploadedById: editorId,
  });
  expect(allowed?.instructorId).toBeUndefined();
});

test("createUpload: unassigned editor uploads are unlimited with open access", async () => {
  const t = convexTest(schema, modules);
  const editorId = "editor_unassigned_open";

  await t.run(async (ctx) => {
    await seedUser(ctx, editorId, "video_editor");
    await ctx.db.insert("videoEditorAssignments", {
      videoEditorId: editorId,
      assignedAt: Date.now(),
    });
  });

  const upload = await t
    .withIdentity({ subject: editorId })
    .mutation(api.instructorUploads.createUpload, {
      id: "upload_open_unassigned",
      filename: "key/upload_open_unassigned",
      originalName: "clip.mp4",
      contentType: "video/mp4",
      size: 1024 * 1024 * 1024,
      uploadedById: editorId,
    });

  expect(upload?.instructorId).toBeUndefined();
});

async function seedUnassignedUpload(
  ctx: any,
  id: string,
  uploadedById?: string,
  status = "completed"
) {
  await ctx.db.insert("instructorUploads", {
    filename: `key/${id}`,
    originalName: `${id}.mp4`,
    contentType: "video/mp4",
    size: 1024,
    status,
    transferRetryCount: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    legacyId: id,
    uploadedById,
  });
}

test("assignUploadInstructor: admin assigns an unassigned upload", async () => {
  const t = convexTest(schema, modules);
  const adminId = "admin_assign_upload";
  const instructorId = "inst_assign_upload";
  const uploadId = "upload_assign_me";

  await t.run(async (ctx) => {
    await seedUser(ctx, adminId, "admin");
    await seedUser(ctx, instructorId, "instructor");
    await seedInstructor(ctx, instructorId);
    await seedUnassignedUpload(ctx, uploadId);
  });

  await expect(
    t.withIdentity({ subject: adminId }).mutation(
      api.instructorUploads.assignUploadInstructor,
      { id: uploadId, instructorId }
    )
  ).resolves.toEqual({ success: true, action: "assigned" });

  const updated = await t.run(async (ctx) =>
    ctx.db
      .query("instructorUploads")
      .withIndex("by_legacyId", (q) => q.eq("legacyId", uploadId))
      .first()
  );
  expect(updated?.instructorId).toBe(instructorId);
});

test("assignUploadInstructor: non-admins are rejected", async () => {
  const t = convexTest(schema, modules);
  const instructorId = "inst_assign_forbidden";
  const editorId = "editor_assign_forbidden";
  const uploadId = "upload_assign_forbidden";

  await t.run(async (ctx) => {
    await seedUser(ctx, instructorId, "instructor");
    await seedInstructor(ctx, instructorId);
    await seedUser(ctx, editorId, "video_editor");
    await ctx.db.insert("videoEditorAssignments", {
      videoEditorId: editorId,
      instructorId,
      assignedAt: Date.now(),
    });
    await seedUnassignedUpload(ctx, uploadId, editorId);
  });

  await expect(
    t.withIdentity({ subject: editorId }).mutation(
      api.instructorUploads.assignUploadInstructor,
      { id: uploadId, instructorId }
    )
  ).rejects.toThrow("only admins can assign an instructor");

  await expect(
    t.withIdentity({ subject: instructorId }).mutation(
      api.instructorUploads.assignUploadInstructor,
      { id: uploadId, instructorId }
    )
  ).rejects.toThrow("only admins can assign an instructor");
});

test("assignUploadInstructor: rejects an inactive instructor", async () => {
  const t = convexTest(schema, modules);
  const adminId = "admin_assign_inactive";
  const instructorId = "inst_assign_inactive";
  const uploadId = "upload_assign_inactive";

  await t.run(async (ctx) => {
    await seedUser(ctx, adminId, "admin");
    await seedUser(ctx, instructorId, "instructor");
    await seedInstructor(ctx, instructorId);
    await ctx.db.patch(
      (
        await ctx.db
          .query("instructors")
          .withIndex("by_userId", (q) => q.eq("userId", instructorId))
          .first()
      )!._id,
      { deletedAt: Date.now() }
    );
    await seedUnassignedUpload(ctx, uploadId);
  });

  await expect(
    t.withIdentity({ subject: adminId }).mutation(
      api.instructorUploads.assignUploadInstructor,
      { id: uploadId, instructorId }
    )
  ).rejects.toThrow("no longer active");
});

test("getAllUploads: unassigned filter returns only files with no instructor", async () => {
  const t = convexTest(schema, modules);
  const instructorId = "inst_list_unassigned";

  await t.run(async (ctx) => {
    await seedUser(ctx, instructorId, "instructor");
    await seedInstructor(ctx, instructorId);
    await seedUpload(ctx, "upload_assigned_list", instructorId);
    await seedUnassignedUpload(ctx, "upload_unassigned_list");
  });

  const result = await t.query(api.instructorUploads.getAllUploads, {
    unassigned: true,
  });

  expect(result.uploads.map((u) => u.legacyId)).toEqual([
    "upload_unassigned_list",
  ]);
});

test("assignUploadInstructor: enforces the target instructor's editor quota", async () => {
  const t = convexTest(schema, modules);
  const adminId = "admin_assign_quota";
  const instructorId = "inst_assign_quota";
  const editorId = "editor_assign_quota";
  const uploadId = "upload_assign_quota";

  await t.run(async (ctx) => {
    await seedUser(ctx, adminId, "admin");
    await seedUser(ctx, instructorId, "instructor");
    await seedInstructor(ctx, instructorId);
    await seedUser(ctx, editorId, "video_editor");
    await ctx.db.insert("videoEditorAssignments", {
      videoEditorId: editorId,
      instructorId,
      assignedAt: Date.now(),
      storageQuotaBytes: 1000,
    });
    await ctx.db.insert("instructorUploads", {
      filename: `key/${uploadId}`,
      originalName: "large.mp4",
      contentType: "video/mp4",
      size: 1200,
      status: "completed",
      transferRetryCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      legacyId: uploadId,
      uploadedById: editorId,
    });
  });

  await expect(
    t.withIdentity({ subject: adminId }).mutation(
      api.instructorUploads.assignUploadInstructor,
      { id: uploadId, instructorId }
    )
  ).rejects.toThrow("storage quota exceeded");
});

test("createUpload: a stale assignment does not grant unassigned upload rights", async () => {
  const t = convexTest(schema, modules);
  const instructorId = "inst_stale_unassigned";
  const editorId = "editor_stale_unassigned";

  await t.run(async (ctx) => {
    await seedUser(ctx, instructorId, "instructor");
    await seedInstructor(ctx, instructorId);
    await seedUser(ctx, editorId, "video_editor");
    await ctx.db.insert("videoEditorAssignments", {
      videoEditorId: editorId,
      instructorId,
      assignedAt: Date.now(),
    });
    const profile = await ctx.db
      .query("instructors")
      .withIndex("by_userId", (q) => q.eq("userId", instructorId))
      .first();
    await ctx.db.patch(profile!._id, { deletedAt: Date.now() });
  });

  await expect(
    t.withIdentity({ subject: editorId }).mutation(api.instructorUploads.createUpload, {
      id: "upload_stale_unassigned",
      filename: "key/upload_stale_unassigned",
      originalName: "clip.mp4",
      contentType: "video/mp4",
      size: 1024,
      uploadedById: editorId,
    })
  ).rejects.toThrow("You are not assigned to any instructor");
});

test("createUpload: a stale quota-less assignment does not remove the active quota cap", async () => {
  const t = convexTest(schema, modules);
  const activeInstructorId = "inst_quota_active";
  const staleInstructorId = "inst_quota_stale";
  const editorId = "editor_quota_mixed";

  await t.run(async (ctx) => {
    await seedUser(ctx, activeInstructorId, "instructor");
    await seedInstructor(ctx, activeInstructorId);
    await seedUser(ctx, staleInstructorId, "instructor");
    await seedInstructor(ctx, staleInstructorId);
    await seedUser(ctx, editorId, "video_editor");

    await ctx.db.insert("videoEditorAssignments", {
      videoEditorId: editorId,
      instructorId: activeInstructorId,
      assignedAt: Date.now(),
      storageQuotaBytes: 1000,
    });
    // Stale row: no quota, instructor profile soft-deleted. Before the
    // fix this made the editor appear "unlimited".
    await ctx.db.insert("videoEditorAssignments", {
      videoEditorId: editorId,
      instructorId: staleInstructorId,
      assignedAt: Date.now(),
    });
    const staleProfile = await ctx.db
      .query("instructors")
      .withIndex("by_userId", (q) => q.eq("userId", staleInstructorId))
      .first();
    await ctx.db.patch(staleProfile!._id, { deletedAt: Date.now() });
  });

  await expect(
    t.withIdentity({ subject: editorId }).mutation(api.instructorUploads.createUpload, {
      id: "upload_quota_mixed",
      filename: "key/upload_quota_mixed",
      originalName: "over.mp4",
      contentType: "video/mp4",
      size: 1500,
      uploadedById: editorId,
    })
  ).rejects.toThrow("storage quota exceeded");
});

test("assignUploadInstructor: rejects an in-progress upload", async () => {
  const t = convexTest(schema, modules);
  const adminId = "admin_assign_in_progress";
  const instructorId = "inst_assign_in_progress";
  const uploadId = "upload_assign_in_progress";

  await t.run(async (ctx) => {
    await seedUser(ctx, adminId, "admin");
    await seedUser(ctx, instructorId, "instructor");
    await seedInstructor(ctx, instructorId);
    await seedUnassignedUpload(ctx, uploadId, undefined, "uploading");
  });

  await expect(
    t.withIdentity({ subject: adminId }).mutation(
      api.instructorUploads.assignUploadInstructor,
      { id: uploadId, instructorId }
    )
  ).rejects.toThrow("while the upload is in progress");
});
