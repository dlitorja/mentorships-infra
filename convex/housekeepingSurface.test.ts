/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import * as workspaces from "./workspaces";
import * as mutationHttp from "./mutations/http";

const modules = import.meta.glob("./**/*.ts");

const ADMIN = "user_admin_housekeeping";
const RECIPIENT = "user_recipient_housekeeping";
const OTHER = "user_other_housekeeping";
const UPLOADER = "user_uploader_housekeeping";
const SELF_INSTRUCTOR = "user_self_instructor_housekeeping";

async function seedHousekeeping(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: ADMIN,
      clerkId: ADMIN,
      email: "housekeeping-admin@example.com",
      role: "admin",
    });
    for (const [userId, role] of [
      [RECIPIENT, "student"],
      [OTHER, "student"],
      [UPLOADER, "instructor"],
      [SELF_INSTRUCTOR, "instructor"],
    ] as const) {
      await ctx.db.insert("users", {
        userId,
        clerkId: userId,
        email: `${userId}@example.com`,
        role,
      });
    }
    const workspaceId = await ctx.db.insert("workspaces", {
      name: "Housekeeping Workspace",
      ownerId: RECIPIENT,
      isPublic: false,
      studentImageCount: 0,
      instructorImageCount: 0,
    });
    const notificationId = await ctx.db.insert(
      "workspaceRetentionNotifications",
      {
        workspaceId,
        userId: RECIPIENT,
        notificationType: "expiry_warning",
        sentAt: Date.now(),
      }
    );
    const otherNotificationId = await ctx.db.insert(
      "workspaceRetentionNotifications",
      {
        workspaceId,
        userId: OTHER,
        notificationType: "deleted",
        sentAt: Date.now(),
      }
    );
    const uploadId = await ctx.db.insert("instructorUploads", {
      instructorId: "instructor_housekeeping",
      filename: "housekeeping/file.mp4",
      originalName: "file.mp4",
      contentType: "video/mp4",
      size: 1024,
      status: "pending",
      legacyId: "upload_housekeeping",
      uploadedById: UPLOADER,
    });
    await ctx.db.insert("instructorUploads", {
      instructorId: SELF_INSTRUCTOR,
      filename: "housekeeping/self.mp4",
      originalName: "self.mp4",
      contentType: "video/mp4",
      size: 1024,
      status: "pending",
      legacyId: "upload_self",
    });
    return { workspaceId, notificationId, otherNotificationId, uploadId };
  });
}

test("housekeeping writers are internal or auth-gated", () => {
  const retention = mutationHttp.createRetentionNotification as {
    isInternal?: boolean;
    isPublic?: boolean;
  };
  const exportStatus = mutationHttp.updateWorkspaceExportStatus as {
    isInternal?: boolean;
    isPublic?: boolean;
  };
  expect(retention.isInternal).toBe(true);
  expect(retention.isPublic).not.toBe(true);
  expect(exportStatus.isInternal).toBe(true);
  expect(exportStatus.isPublic).not.toBe(true);
  expect("createRetentionNotification" in workspaces).toBe(false);
});

test("workspace audit requires an admin and records the derived actor", async () => {
  const t = convexTest(schema, modules);
  const { workspaceId } = await seedHousekeeping(t);

  await expect(
    t.mutation(api.workspaces.logViewWorkspaceAudit, { workspaceId })
  ).rejects.toThrow("Unauthorized");

  await expect(
    t
      .withIdentity({ subject: OTHER })
      .mutation(api.workspaces.logViewWorkspaceAudit, { workspaceId })
  ).rejects.toThrow("Forbidden");

  await t
    .withIdentity({ subject: ADMIN })
    .mutation(api.workspaces.logViewWorkspaceAudit, { workspaceId });

  const logs = await t.run(async (ctx) => {
    return await ctx.db
      .query("workspaceAuditLogs")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", workspaceId))
      .collect();
  });
  expect(logs).toHaveLength(1);
  expect(logs[0].adminId).toBe(ADMIN);
});

test("acknowledgeNotification is recipient or admin only", async () => {
  const t = convexTest(schema, modules);
  const { notificationId, otherNotificationId } = await seedHousekeeping(t);

  await expect(
    t.mutation(api.workspaces.acknowledgeNotification, { id: notificationId })
  ).rejects.toThrow("Unauthorized");

  await expect(
    t
      .withIdentity({ subject: OTHER })
      .mutation(api.workspaces.acknowledgeNotification, { id: notificationId })
  ).rejects.toThrow("Forbidden");

  await t
    .withIdentity({ subject: RECIPIENT })
    .mutation(api.workspaces.acknowledgeNotification, { id: notificationId });
  const recipientRow = await t.run((ctx) => ctx.db.get(notificationId));
  expect(recipientRow?.acknowledgedAt).toBeDefined();

  await t
    .withIdentity({ subject: ADMIN })
    .mutation(api.workspaces.acknowledgeNotification, { id: otherNotificationId });
  const adminRow = await t.run((ctx) => ctx.db.get(otherNotificationId));
  expect(adminRow?.acknowledgedAt).toBeDefined();
});

test("instructor upload status writes require the uploader or admin", async () => {
  const t = convexTest(schema, modules);
  await seedHousekeeping(t);

  await expect(
    t.mutation(api.instructorUploads.updateUploadStarted, {
      id: "upload_housekeeping",
      b2UploadId: "b2_anon",
    })
  ).rejects.toThrow("Unauthorized");

  await expect(
    t
      .withIdentity({ subject: OTHER })
      .mutation(api.instructorUploads.updateUploadStarted, {
        id: "upload_housekeeping",
        b2UploadId: "b2_other",
      })
  ).rejects.toThrow("Forbidden");

  await t
    .withIdentity({ subject: UPLOADER })
    .mutation(api.instructorUploads.updateUploadStarted, {
      id: "upload_housekeeping",
      b2UploadId: "b2_uploader",
    });

  const started = await t.run(async (ctx) =>
    ctx.db
      .query("instructorUploads")
      .withIndex("by_legacyId", (q) => q.eq("legacyId", "upload_housekeeping"))
      .first()
  );
  expect(started?.status).toBe("uploading");

  await t
    .withIdentity({ subject: UPLOADER })
    .mutation(api.instructorUploads.completeUpload, {
      id: "upload_housekeeping",
      b2FileId: "b2_file",
    });

  const completed = await t.run(async (ctx) =>
    ctx.db
      .query("instructorUploads")
      .withIndex("by_legacyId", (q) => q.eq("legacyId", "upload_housekeeping"))
      .first()
  );
  expect(completed?.status).toBe("completed");

  // Instructor self-uploads omit uploadedById; the instructorId is the owner.
  await t
    .withIdentity({ subject: SELF_INSTRUCTOR })
    .mutation(api.instructorUploads.updateUploadStarted, {
      id: "upload_self",
      b2UploadId: "b2_self",
    });
  await t
    .withIdentity({ subject: SELF_INSTRUCTOR })
    .mutation(api.instructorUploads.completeUpload, {
      id: "upload_self",
      b2FileId: "b2_self_file",
    });
  const selfRow = await t.run(async (ctx) =>
    ctx.db
      .query("instructorUploads")
      .withIndex("by_legacyId", (q) => q.eq("legacyId", "upload_self"))
      .first()
  );
  expect(selfRow?.status).toBe("completed");
});
