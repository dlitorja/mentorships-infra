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

async function seedShare(
  ctx: any,
  token: string,
  uploadId: string,
  createdByUserId: string,
  opts: { revokedAt?: number; expiresAt?: number } = {}
) {
  const upload = await ctx.db
    .query("instructorUploads")
    .withIndex("by_legacyId", (q) => q.eq("legacyId", uploadId))
    .first();
  if (!upload) throw new Error(`seedShare: upload ${uploadId} not found`);
  await ctx.db.insert("hdShareLinks", {
    uploadId: upload._id,
    token,
    createdByUserId,
    createdAt: Date.now(),
    expiresAt: opts.expiresAt,
    revokedAt: opts.revokedAt,
    label: undefined,
  });
}

test("createShareLink: instructor can create share link", async () => {
  const t = convexTest(schema, modules);
  const instructorId = "inst_share";
  const uploadId = "upload_share";

  await t.run(async (ctx) => {
    await seedUser(ctx, instructorId, "instructor");
    await seedInstructor(ctx, instructorId);
    await seedUpload(ctx, uploadId, instructorId);
  });

  const result = await t.withIdentity({ subject: instructorId }).mutation(
    api.hdShareLinks.createShareLink,
    {
      uploadLegacyId: uploadId,
      token: "test-token-123456789",
      label: "Test label",
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
    }
  );

  expect(result.token).toBe("test-token-123456789");
  expect(result.shareId).toBeDefined();
});

test("createShareLink: video editor can create share link for assigned instructor", async () => {
  const t = convexTest(schema, modules);
  const instructorId = "inst_share_editor";
  const editorId = "editor_share";
  const uploadId = "upload_share_editor";

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

  const result = await t.withIdentity({ subject: editorId }).mutation(
    api.hdShareLinks.createShareLink,
    {
      uploadLegacyId: uploadId,
      token: "test-token-editor-123456789",
      label: undefined,
      expiresAt: undefined,
    }
  );

  expect(result.token).toBe("test-token-editor-123456789");
  expect(result.shareId).toBeDefined();
});

test("createShareLink: rejects non-instructor/admin/editor", async () => {
  const t = convexTest(schema, modules);
  const userId = "student_share";
  const uploadId = "upload_student_share";

  await t.run(async (ctx) => {
    await seedUser(ctx, userId, "student");
    await seedUpload(ctx, uploadId, userId);
  });

  await expect(
    t.withIdentity({ subject: userId }).mutation(api.hdShareLinks.createShareLink, {
      uploadLegacyId: uploadId,
      token: "test-token-student",
    })
  ).rejects.toThrow("Forbidden");
});

test("createShareLink: falls back to clerkId when identity subject is not userId", async () => {
  const t = convexTest(schema, modules);
  const legacyUserId = "inst_share_legacy";
  const clerkId = "clerk_inst_share_legacy";
  const uploadId = "upload_share_legacy";

  await t.run(async (ctx) => {
    await seedUser(ctx, legacyUserId, "instructor", clerkId);
    await seedInstructor(ctx, legacyUserId);
    await seedUpload(ctx, uploadId, legacyUserId);
  });

  const result = await t.withIdentity({ subject: clerkId }).mutation(
    api.hdShareLinks.createShareLink,
    {
      uploadLegacyId: uploadId,
      token: "test-token-legacy-123456789",
    }
  );

  expect(result.token).toBe("test-token-legacy-123456789");
  expect(result.shareId).toBeDefined();
});

test("createShareLink: rejects deleted upload", async () => {
  const t = convexTest(schema, modules);
  const instructorId = "inst_share_deleted";
  const uploadId = "upload_share_deleted";

  await t.run(async (ctx) => {
    await seedUser(ctx, instructorId, "instructor");
    await seedInstructor(ctx, instructorId);
    await seedUpload(ctx, uploadId, instructorId, undefined, "deleted");
  });

  await expect(
    t.withIdentity({ subject: instructorId }).mutation(api.hdShareLinks.createShareLink, {
      uploadLegacyId: uploadId,
      token: "test-token-deleted",
    })
  ).rejects.toThrow("Cannot share a deleted file");
});

test("resolveShareByToken: owning instructor can resolve a share created by an admin", async () => {
  const t = convexTest(schema, modules);
  const instructorId = "inst_resolve_owner";
  const adminId = "admin_resolve";
  const uploadId = "upload_resolve_owner";
  const token = "test-token-resolve-owner-1234567890";

  await t.run(async (ctx) => {
    await seedUser(ctx, instructorId, "instructor");
    await seedInstructor(ctx, instructorId);
    await seedUser(ctx, adminId, "admin");
    await seedUpload(ctx, uploadId, instructorId);
    await seedShare(ctx, token, uploadId, adminId);
  });

  const result = await t
    .withIdentity({ subject: instructorId })
    .query(api.hdShareLinks.resolveShareByToken, { token });

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") throw new Error("expected ok");
  expect(result.upload.id).toBeDefined();
  expect(result.upload.originalName).toBe(`${uploadId}.mp4`);
  expect(result.share.createdByUserId).toBe(adminId);
});

test("resolveShareByToken: non-owning instructor is forbidden", async () => {
  const t = convexTest(schema, modules);
  const ownerInstructorId = "inst_resolve_owner2";
  const otherInstructorId = "inst_resolve_other";
  const adminId = "admin_resolve2";
  const uploadId = "upload_resolve_owner2";
  const token = "test-token-resolve-other-1234567890";

  await t.run(async (ctx) => {
    await seedUser(ctx, ownerInstructorId, "instructor");
    await seedInstructor(ctx, ownerInstructorId);
    await seedUser(ctx, otherInstructorId, "instructor");
    await seedInstructor(ctx, otherInstructorId);
    await seedUser(ctx, adminId, "admin");
    await seedUpload(ctx, uploadId, ownerInstructorId);
    await seedShare(ctx, token, uploadId, adminId);
  });

  const result = await t
    .withIdentity({ subject: otherInstructorId })
    .query(api.hdShareLinks.resolveShareByToken, { token });

  expect(result.kind).toBe("forbidden");
});

test("resolveShareByToken: video editor can resolve", async () => {
  const t = convexTest(schema, modules);
  const instructorId = "inst_resolve_editor";
  const editorId = "editor_resolve";
  const uploadId = "upload_resolve_editor";
  const token = "test-token-resolve-editor-123456789";

  await t.run(async (ctx) => {
    await seedUser(ctx, instructorId, "instructor");
    await seedInstructor(ctx, instructorId);
    await seedUser(ctx, editorId, "video_editor");
    await seedUpload(ctx, uploadId, instructorId, editorId);
    await seedShare(ctx, token, uploadId, editorId);
  });

  const result = await t
    .withIdentity({ subject: editorId })
    .query(api.hdShareLinks.resolveShareByToken, { token });

  expect(result.kind).toBe("ok");
});

test("resolveShareByToken: admin can resolve", async () => {
  const t = convexTest(schema, modules);
  const instructorId = "inst_resolve_admin";
  const adminId = "admin_resolve3";
  const uploadId = "upload_resolve_admin";
  const token = "test-token-resolve-admin-1234567890";

  await t.run(async (ctx) => {
    await seedUser(ctx, instructorId, "instructor");
    await seedInstructor(ctx, instructorId);
    await seedUser(ctx, adminId, "admin");
    await seedUpload(ctx, uploadId, instructorId);
    await seedShare(ctx, token, uploadId, adminId);
  });

  const result = await t
    .withIdentity({ subject: adminId })
    .query(api.hdShareLinks.resolveShareByToken, { token });

  expect(result.kind).toBe("ok");
});

test("resolveShareByToken: student is forbidden", async () => {
  const t = convexTest(schema, modules);
  const instructorId = "inst_resolve_student";
  const studentId = "student_resolve";
  const adminId = "admin_resolve4";
  const uploadId = "upload_resolve_student";
  const token = "test-token-resolve-student-12345678";

  await t.run(async (ctx) => {
    await seedUser(ctx, instructorId, "instructor");
    await seedInstructor(ctx, instructorId);
    await seedUser(ctx, studentId, "student");
    await seedUser(ctx, adminId, "admin");
    await seedUpload(ctx, uploadId, instructorId);
    await seedShare(ctx, token, uploadId, adminId);
  });

  const result = await t
    .withIdentity({ subject: studentId })
    .query(api.hdShareLinks.resolveShareByToken, { token });

  expect(result.kind).toBe("forbidden");
});

test("resolveShareByToken: revoked share returns revoked", async () => {
  const t = convexTest(schema, modules);
  const instructorId = "inst_resolve_revoked";
  const editorId = "editor_resolve_revoked";
  const uploadId = "upload_resolve_revoked";
  const token = "test-token-resolve-revoked-12345678";

  await t.run(async (ctx) => {
    await seedUser(ctx, instructorId, "instructor");
    await seedInstructor(ctx, instructorId);
    await seedUser(ctx, editorId, "video_editor");
    await seedUpload(ctx, uploadId, instructorId, editorId);
    await seedShare(ctx, token, uploadId, editorId, { revokedAt: Date.now() });
  });

  const result = await t
    .withIdentity({ subject: editorId })
    .query(api.hdShareLinks.resolveShareByToken, { token });

  expect(result.kind).toBe("revoked");
});

test("resolveShareByToken: expired share returns expired", async () => {
  const t = convexTest(schema, modules);
  const instructorId = "inst_resolve_expired";
  const editorId = "editor_resolve_expired";
  const uploadId = "upload_resolve_expired";
  const token = "test-token-resolve-expired-12345678";

  await t.run(async (ctx) => {
    await seedUser(ctx, instructorId, "instructor");
    await seedInstructor(ctx, instructorId);
    await seedUser(ctx, editorId, "video_editor");
    await seedUpload(ctx, uploadId, instructorId, editorId);
    await seedShare(ctx, token, uploadId, editorId, {
      expiresAt: Date.now() - 1000,
    });
  });

  const result = await t
    .withIdentity({ subject: editorId })
    .query(api.hdShareLinks.resolveShareByToken, { token });

  expect(result.kind).toBe("expired");
});

test("resolveShareByToken: revoked share wins over deleted file for owning instructor", async () => {
  const t = convexTest(schema, modules);
  const instructorId = "inst_resolve_revoked_deleted";
  const editorId = "editor_resolve_revoked_deleted";
  const uploadId = "upload_resolve_revoked_deleted";
  const token = "test-token-resolve-rd-1234567890";

  await t.run(async (ctx) => {
    await seedUser(ctx, instructorId, "instructor");
    await seedInstructor(ctx, instructorId);
    await seedUser(ctx, editorId, "video_editor");
    await seedUpload(ctx, uploadId, instructorId, editorId, "deleted");
    await seedShare(ctx, token, uploadId, editorId, { revokedAt: Date.now() });
  });

  // Owning instructor can still receive the more-specific revoked
  // response even though the underlying upload has been deleted.
  const result = await t
    .withIdentity({ subject: instructorId })
    .query(api.hdShareLinks.resolveShareByToken, { token });

  expect(result.kind).toBe("revoked");
});

test("resolveShareByToken: unauthorized instructor gets forbidden even when file is deleted", async () => {
  const t = convexTest(schema, modules);
  const ownerInstructorId = "inst_resolve_orphan_owner";
  const otherInstructorId = "inst_resolve_orphan_other";
  const adminId = "admin_resolve_orphan";
  const uploadId = "upload_resolve_orphan";
  const token = "test-token-resolve-orphan-123456789";

  await t.run(async (ctx) => {
    await seedUser(ctx, ownerInstructorId, "instructor");
    await seedInstructor(ctx, ownerInstructorId);
    await seedUser(ctx, otherInstructorId, "instructor");
    await seedInstructor(ctx, otherInstructorId);
    await seedUser(ctx, adminId, "admin");
    await seedUpload(ctx, uploadId, ownerInstructorId, undefined, "deleted");
    await seedShare(ctx, token, uploadId, adminId);
  });

  // Unauthorized instructor must see `forbidden`, NOT `file_missing`,
  // so the file's deletion state is not disclosed to callers outside
  // the share audience (Greptile P2).
  const result = await t
    .withIdentity({ subject: otherInstructorId })
    .query(api.hdShareLinks.resolveShareByToken, { token });

  expect(result.kind).toBe("forbidden");
});

test("resolveShareByToken: owning instructor sees file_missing when file is deleted", async () => {
  const t = convexTest(schema, modules);
  const instructorId = "inst_resolve_deleted_owner";
  const editorId = "editor_resolve_deleted_owner";
  const uploadId = "upload_resolve_deleted_owner";
  const token = "test-token-resolve-deleted-1234567890";

  await t.run(async (ctx) => {
    await seedUser(ctx, instructorId, "instructor");
    await seedInstructor(ctx, instructorId);
    await seedUser(ctx, editorId, "video_editor");
    await seedUpload(ctx, uploadId, instructorId, editorId, "deleted");
    await seedShare(ctx, token, uploadId, editorId);
  });

  const result = await t
    .withIdentity({ subject: instructorId })
    .query(api.hdShareLinks.resolveShareByToken, { token });

  expect(result.kind).toBe("file_missing");
});
