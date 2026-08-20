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
