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
