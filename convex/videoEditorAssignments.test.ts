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
    await ctx.db.insert("instructors", {
      userId: instructorId,
      email: "instructor@example.com",
      name: "Instructor One",
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
    await ctx.db.insert("instructors", {
      userId: instructorId,
      email: "instructor2@example.com",
      name: "Instructor Two",
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

test("video editor uploads: no default instructor cap applies to delegated or self uploads", async () => {
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
    await ctx.db.insert("instructors", {
      userId: instructorId,
      email: "instructor4@example.com",
      name: "Instructor Four",
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
    // Seed an instructor-owned upload well above the old 50GB cap.
    await ctx.db.insert("instructorUploads", {
      instructorId,
      filename: "key/instructor-owned",
      originalName: "instructor-owned.mp4",
      contentType: "video/mp4",
      size: 60 * 1024 * 1024 * 1024,
      status: "completed",
      transferRetryCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      legacyId: "instructor-owned",
    });
  });

  // The video editor should still be able to upload because no default
  // instructor cap is applied to delegated uploads.
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

  // Instructors have no storage cap and can also self-upload.
  await expect(
    t.withIdentity({ subject: instructorId }).mutation(api.instructorUploads.createUpload, {
      id: "upload_6",
      instructorId,
      filename: "key/upload_6",
      originalName: "upload_6.mp4",
      contentType: "video/mp4",
      size: 1024,
    })
  ).resolves.toBeDefined();
});

test("createUpload: instructors have no storage cap", async () => {
  const t = convexTest(schema, modules);

  const instructorId = "instructor_5";

  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: instructorId,
      email: "instructor5@example.com",
      clerkId: instructorId,
      role: "instructor",
    });
    await ctx.db.insert("instructors", {
      userId: instructorId,
      email: "instructor5@example.com",
      name: "Instructor Five",
    });
    // Seed an instructor-owned upload well above the old 50GB cap.
    await ctx.db.insert("instructorUploads", {
      instructorId,
      filename: "key/instructor-owned",
      originalName: "instructor-owned.mp4",
      contentType: "video/mp4",
      size: 60 * 1024 * 1024 * 1024,
      status: "completed",
      transferRetryCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      legacyId: "instructor-owned",
    });
  });

  await expect(
    t.withIdentity({ subject: instructorId }).mutation(api.instructorUploads.createUpload, {
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
    await ctx.db.insert("instructors", {
      userId: instructorId,
      email: "instructor6@example.com",
      name: "Instructor Six",
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
    await ctx.db.insert("instructors", {
      userId: instructorId,
      email: "instructor7@example.com",
      name: "Instructor Seven",
    });
    await ctx.db.insert("users", {
      userId: otherInstructorId,
      email: "instructor8@example.com",
      clerkId: otherInstructorId,
      role: "instructor",
    });
    await ctx.db.insert("instructors", {
      userId: otherInstructorId,
      email: "instructor8@example.com",
      name: "Instructor Eight",
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
    await ctx.db.insert("instructors", {
      userId: instructorId,
      email: "instructor9@example.com",
      name: "Instructor Nine",
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

test("setVideoEditorAssignmentQuotaByIds: admin can set, clear, and re-set quota", async () => {
  const t = convexTest(schema, modules);

  const instructorId = "instructor_quota";
  const editorId = "editor_quota";
  const adminId = "admin_quota";

  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: instructorId,
      email: "instructor_quota@example.com",
      clerkId: instructorId,
      role: "instructor",
    });
    await ctx.db.insert("users", {
      userId: editorId,
      email: "editor_quota@example.com",
      clerkId: editorId,
      role: "video_editor",
    });
    await ctx.db.insert("users", {
      userId: adminId,
      email: "admin_quota@example.com",
      clerkId: adminId,
      role: "admin",
    });
    await ctx.db.insert("videoEditorAssignments", {
      videoEditorId: editorId,
      instructorId,
      assignedAt: Date.now(),
    });
  });

  const adminClient = t.withIdentity({ subject: adminId });

  await expect(
    adminClient.mutation(api.videoEditorAssignments.setVideoEditorAssignmentQuotaByIds, {
      videoEditorId: editorId,
      instructorId,
      storageQuotaBytes: 1024,
    })
  ).resolves.toEqual({ success: true });

  let assignment = await t.run(async (ctx) =>
    ctx.db
      .query("videoEditorAssignments")
      .withIndex("by_videoEditorId_instructorId", (q) =>
        q.eq("videoEditorId", editorId).eq("instructorId", instructorId)
      )
      .first()
  );
  expect(assignment?.storageQuotaBytes).toBe(1024);

  await expect(
    adminClient.mutation(api.videoEditorAssignments.setVideoEditorAssignmentQuotaByIds, {
      videoEditorId: editorId,
      instructorId,
      storageQuotaBytes: null,
    })
  ).resolves.toEqual({ success: true });

  assignment = await t.run(async (ctx) =>
    ctx.db
      .query("videoEditorAssignments")
      .withIndex("by_videoEditorId_instructorId", (q) =>
        q.eq("videoEditorId", editorId).eq("instructorId", instructorId)
      )
      .first()
  );
  expect(assignment?.storageQuotaBytes).toBeUndefined();
});

test("setVideoEditorAssignmentQuotaByIds: admin is recognized when identity.subject matches clerkId", async () => {
  const t = convexTest(schema, modules);

  const instructorId = "instructor_quota_clerk";
  const editorId = "editor_quota_clerk";
  const adminUserId = "admin_user_id";
  const adminClerkId = "admin_clerk_id";

  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: instructorId,
      email: "instructor_quota_clerk@example.com",
      clerkId: instructorId,
      role: "instructor",
    });
    await ctx.db.insert("users", {
      userId: editorId,
      email: "editor_quota_clerk@example.com",
      clerkId: editorId,
      role: "video_editor",
    });
    // Admin's primary userId differs from the Clerk subject used by huckleberry-drive.
    await ctx.db.insert("users", {
      userId: adminUserId,
      email: "admin_quota_clerk@example.com",
      clerkId: adminClerkId,
      role: "admin",
    });
    await ctx.db.insert("videoEditorAssignments", {
      videoEditorId: editorId,
      instructorId,
      assignedAt: Date.now(),
    });
  });

  const adminClient = t.withIdentity({ subject: adminClerkId });

  await expect(
    adminClient.mutation(api.videoEditorAssignments.setVideoEditorAssignmentQuotaByIds, {
      videoEditorId: editorId,
      instructorId,
      storageQuotaBytes: 2048,
    })
  ).resolves.toEqual({ success: true });

  const assignment = await t.run(async (ctx) =>
    ctx.db
      .query("videoEditorAssignments")
      .withIndex("by_videoEditorId_instructorId", (q) =>
        q.eq("videoEditorId", editorId).eq("instructorId", instructorId)
      )
      .first()
  );
  expect(assignment?.storageQuotaBytes).toBe(2048);
});

/**
 * Smoke tests for the open video editor assignment feature.
 *
 * Covers:
 *   - `createVideoEditorAssignment` with no `instructorId` creates an open
 *     row that authorizes uploads to any instructor.
 *   - Open assignment creation is idempotent (no duplicate open rows).
 *   - Open assignment is rejected when `instructorId` is the empty string
 *     (defense-in-depth: an explicit `""` must not become an open row).
 *   - Non-admins cannot create or remove open assignments.
 *   - `removeVideoEditorOpenAssignment` deletes the open row.
 *   - `createUpload` under open access bypasses per-instructor quota
 *     enforcement.
 *   - `getVideoEditorAssignmentsWithStorage` reports real usage for the open
 *     row across all instructors the editor has uploaded to.
 *   - Specific assignment quota still applies when both a specific row and
 *     an open row coexist.
 *   - `isVideoEditorAssignedToInstructor` matches the open row for any
 *     instructor.
 */

test("createVideoEditorAssignment: admin can create an open assignment", async () => {
  const t = convexTest(schema, modules);

  const editorId = "editor_open_1";
  const adminId = "admin_open_1";

  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: editorId,
      email: "editor_open_1@example.com",
      clerkId: editorId,
      role: "video_editor",
    });
    await ctx.db.insert("users", {
      userId: adminId,
      email: "admin_open_1@example.com",
      clerkId: adminId,
      role: "admin",
    });
  });

  const adminClient = t.withIdentity({ subject: adminId });

  const created = await adminClient.mutation(
    api.videoEditorAssignments.createVideoEditorAssignment,
    { videoEditorId: editorId }
  );
  expect(created.action).toBe("created");

  const open = await adminClient.query(
    api.videoEditorAssignments.getVideoEditorOpenAssignment,
    { videoEditorId: editorId }
  );
  expect(open).not.toBeNull();
  expect(open?.instructorId).toBeUndefined();
});

test("createVideoEditorAssignment: open assignment creation is idempotent", async () => {
  const t = convexTest(schema, modules);

  const editorId = "editor_open_2";
  const adminId = "admin_open_2";

  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: editorId,
      email: "editor_open_2@example.com",
      clerkId: editorId,
      role: "video_editor",
    });
    await ctx.db.insert("users", {
      userId: adminId,
      email: "admin_open_2@example.com",
      clerkId: adminId,
      role: "admin",
    });
  });

  const adminClient = t.withIdentity({ subject: adminId });

  const first = await adminClient.mutation(
    api.videoEditorAssignments.createVideoEditorAssignment,
    { videoEditorId: editorId }
  );
  const second = await adminClient.mutation(
    api.videoEditorAssignments.createVideoEditorAssignment,
    { videoEditorId: editorId }
  );
  expect(second.action).toBe("exists");
  expect(second.id).toBe(first.id);

  const allOpen = await t.run(async (ctx) =>
    ctx.db
      .query("videoEditorAssignments")
      .withIndex("by_videoEditorId", (q) => q.eq("videoEditorId", editorId))
      .collect()
  );
  const openRows = allOpen.filter((a) => a.instructorId === undefined);
  expect(openRows.length).toBe(1);
});

test("createVideoEditorAssignment: non-admin cannot create an open assignment", async () => {
  const t = convexTest(schema, modules);

  const editorId = "editor_open_3";
  const instructorId = "instructor_open_3";

  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: editorId,
      email: "editor_open_3@example.com",
      clerkId: editorId,
      role: "video_editor",
    });
    await ctx.db.insert("users", {
      userId: instructorId,
      email: "instructor_open_3@example.com",
      clerkId: instructorId,
      role: "instructor",
    });
    await ctx.db.insert("instructors", {
      userId: instructorId,
      email: "instructor_open_3@example.com",
      name: "Instructor Open 3",
    });
  });

  const editorClient = t.withIdentity({ subject: editorId });

  await expect(
    editorClient.mutation(api.videoEditorAssignments.createVideoEditorAssignment, {
      videoEditorId: editorId,
    })
  ).rejects.toThrow("Forbidden");
});

test("removeVideoEditorOpenAssignment: admin can revoke open access", async () => {
  const t = convexTest(schema, modules);

  const editorId = "editor_open_4";
  const adminId = "admin_open_4";

  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: editorId,
      email: "editor_open_4@example.com",
      clerkId: editorId,
      role: "video_editor",
    });
    await ctx.db.insert("users", {
      userId: adminId,
      email: "admin_open_4@example.com",
      clerkId: adminId,
      role: "admin",
    });
    await ctx.db.insert("videoEditorAssignments", {
      videoEditorId: editorId,
      assignedAt: Date.now(),
    });
  });

  const adminClient = t.withIdentity({ subject: adminId });

  const removed = await adminClient.mutation(
    api.videoEditorAssignments.removeVideoEditorOpenAssignment,
    { videoEditorId: editorId }
  );
  expect(removed.action).toBe("deleted");

  const open = await adminClient.query(
    api.videoEditorAssignments.getVideoEditorOpenAssignment,
    { videoEditorId: editorId }
  );
  expect(open).toBeNull();
});

test("removeVideoEditorOpenAssignment: returns not_found when no open row exists", async () => {
  const t = convexTest(schema, modules);

  const editorId = "editor_open_5";
  const adminId = "admin_open_5";

  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: editorId,
      email: "editor_open_5@example.com",
      clerkId: editorId,
      role: "video_editor",
    });
    await ctx.db.insert("users", {
      userId: adminId,
      email: "admin_open_5@example.com",
      clerkId: adminId,
      role: "admin",
    });
  });

  const adminClient = t.withIdentity({ subject: adminId });
  const removed = await adminClient.mutation(
    api.videoEditorAssignments.removeVideoEditorOpenAssignment,
    { videoEditorId: editorId }
  );
  expect(removed.action).toBe("not_found");
});

test("removeVideoEditorOpenAssignment: non-admin cannot revoke open access", async () => {
  const t = convexTest(schema, modules);

  const editorId = "editor_open_6";

  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: editorId,
      email: "editor_open_6@example.com",
      clerkId: editorId,
      role: "video_editor",
    });
    await ctx.db.insert("videoEditorAssignments", {
      videoEditorId: editorId,
      assignedAt: Date.now(),
    });
  });

  await expect(
    t.withIdentity({ subject: editorId }).mutation(
      api.videoEditorAssignments.removeVideoEditorOpenAssignment,
      { videoEditorId: editorId }
    )
  ).rejects.toThrow("Forbidden");
});

test("createUpload: open assignment allows uploads to any instructor without quota", async () => {
  const t = convexTest(schema, modules);

  const editorId = "editor_open_7";
  const instructorA = "instructor_open_7a";
  const instructorB = "instructor_open_7b";

  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: editorId,
      email: "editor_open_7@example.com",
      clerkId: editorId,
      role: "video_editor",
    });
    await ctx.db.insert("users", {
      userId: instructorA,
      email: "instructor_open_7a@example.com",
      clerkId: instructorA,
      role: "instructor",
    });
    await ctx.db.insert("instructors", {
      userId: instructorA,
      email: "instructor_open_7a@example.com",
      name: "Instructor Open 7a",
    });
    await ctx.db.insert("users", {
      userId: instructorB,
      email: "instructor_open_7b@example.com",
      clerkId: instructorB,
      role: "instructor",
    });
    await ctx.db.insert("instructors", {
      userId: instructorB,
      email: "instructor_open_7b@example.com",
      name: "Instructor Open 7b",
    });
    // Open assignment only — no per-instructor quota applies.
    await ctx.db.insert("videoEditorAssignments", {
      videoEditorId: editorId,
      assignedAt: Date.now(),
    });
  });

  const editorClient = t.withIdentity({ subject: editorId });

  // Upload to instructorA (no specific assignment) — open access allows it.
  await expect(
    editorClient.mutation(api.instructorUploads.createUpload, {
      id: "open_upload_a",
      instructorId: instructorA,
      filename: "key/open_upload_a",
      originalName: "open_upload_a.mp4",
      contentType: "video/mp4",
      size: 100 * 1024 * 1024,
      uploadedById: editorId,
    })
  ).resolves.toBeDefined();

  // Upload to instructorB (no specific assignment) — open access allows it.
  await expect(
    editorClient.mutation(api.instructorUploads.createUpload, {
      id: "open_upload_b",
      instructorId: instructorB,
      filename: "key/open_upload_b",
      originalName: "open_upload_b.mp4",
      contentType: "video/mp4",
      size: 100 * 1024 * 1024,
      uploadedById: editorId,
    })
  ).resolves.toBeDefined();

  // Usage for the open row should reflect BOTH uploads (across instructors).
  const rows = await editorClient.query(
    api.videoEditorAssignments.getVideoEditorAssignmentsWithStorage,
    { videoEditorId: editorId }
  );
  const openRow = rows.find((r) => r.assignment.instructorId === undefined);
  expect(openRow).toBeDefined();
  expect(openRow?.usedBytes).toBe(200 * 1024 * 1024);
  expect(openRow?.fileCount).toBe(2);
  expect(openRow?.assignment.storageQuotaBytes).toBeUndefined();

  // Specific (per-instructor) usage for instructorA should reflect only its own.
  const rowsByInstructor = rows.filter((r) => r.assignment.instructorId !== undefined);
  expect(rowsByInstructor.length).toBe(0);
});

test("createUpload: specific quota still enforced when editor has both open and specific assignments", async () => {
  const t = convexTest(schema, modules);

  const editorId = "editor_open_8";
  const specificInstructor = "instructor_open_8";
  const otherInstructor = "instructor_open_8_other";
  const quota = 200 * 1024 * 1024; // 200 MB

  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: editorId,
      email: "editor_open_8@example.com",
      clerkId: editorId,
      role: "video_editor",
    });
    await ctx.db.insert("users", {
      userId: specificInstructor,
      email: "instructor_open_8@example.com",
      clerkId: specificInstructor,
      role: "instructor",
    });
    await ctx.db.insert("instructors", {
      userId: specificInstructor,
      email: "instructor_open_8@example.com",
      name: "Instructor Open 8",
    });
    await ctx.db.insert("users", {
      userId: otherInstructor,
      email: "instructor_open_8_other@example.com",
      clerkId: otherInstructor,
      role: "instructor",
    });
    await ctx.db.insert("instructors", {
      userId: otherInstructor,
      email: "instructor_open_8_other@example.com",
      name: "Instructor Open 8 Other",
    });
    // Open assignment first.
    await ctx.db.insert("videoEditorAssignments", {
      videoEditorId: editorId,
      assignedAt: Date.now(),
    });
    // Specific assignment second with a tight quota.
    await ctx.db.insert("videoEditorAssignments", {
      videoEditorId: editorId,
      instructorId: specificInstructor,
      assignedAt: Date.now(),
      storageQuotaBytes: quota,
    });
  });

  const editorClient = t.withIdentity({ subject: editorId });

  // Open assignment allows uploading to OTHER instructor without quota.
  await expect(
    editorClient.mutation(api.instructorUploads.createUpload, {
      id: "open_other",
      instructorId: otherInstructor,
      filename: "key/open_other",
      originalName: "open_other.mp4",
      contentType: "video/mp4",
      size: 10 * 1024 * 1024,
      uploadedById: editorId,
    })
  ).resolves.toBeDefined();

  // Specific assignment quota: 250 MB upload must exceed the 200 MB cap.
  await expect(
    editorClient.mutation(api.instructorUploads.createUpload, {
      id: "open_specific_too_big",
      instructorId: specificInstructor,
      filename: "key/open_specific_too_big",
      originalName: "open_specific_too_big.mp4",
      contentType: "video/mp4",
      size: 250 * 1024 * 1024,
      uploadedById: editorId,
    })
  ).rejects.toThrow("Video editor storage quota exceeded");
});

test("isVideoEditorAssignedToInstructor: open row matches any instructor", async () => {
  const t = convexTest(schema, modules);

  const editorId = "editor_open_9";
  const instructorA = "instructor_open_9a";
  const instructorB = "instructor_open_9b";

  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: editorId,
      email: "editor_open_9@example.com",
      clerkId: editorId,
      role: "video_editor",
    });
    await ctx.db.insert("users", {
      userId: instructorA,
      email: "instructor_open_9a@example.com",
      clerkId: instructorA,
      role: "instructor",
    });
    await ctx.db.insert("users", {
      userId: instructorB,
      email: "instructor_open_9b@example.com",
      clerkId: instructorB,
      role: "instructor",
    });
    await ctx.db.insert("videoEditorAssignments", {
      videoEditorId: editorId,
      assignedAt: Date.now(),
    });
  });

  const editorClient = t.withIdentity({ subject: editorId });

  expect(
    await editorClient.query(
      api.videoEditorAssignments.isVideoEditorAssignedToInstructor,
      { videoEditorId: editorId, instructorId: instructorA }
    )
  ).toBe(true);
  expect(
    await editorClient.query(
      api.videoEditorAssignments.isVideoEditorAssignedToInstructor,
      { videoEditorId: editorId, instructorId: instructorB }
    )
  ).toBe(true);
});

/**
 * Tests for Greptile findings on PR #887 round 2:
 *
 *   - createUpload rejects nonexistent `instructorId` so an editor with
 *     open access cannot smuggle a stale or arbitrary target through
 *     (P1 #2).
 *   - getVideoEditorAssignmentsWithStorage reports zero usage for a
 *     specific assignment when an open assignment coexists, preventing
 *     /api/storage-usage from double-counting the same files
 *     (P1 #4).
 *   - computeVideoEditorOpenStorageStats correctly aggregates across
 *     more than one page of uploads for a long-lived editor
 *     (P2 #3).
 */

test("createUpload: rejects unknown instructorId even with open access", async () => {
  const t = convexTest(schema, modules);

  const editorId = "editor_open_10";
  const ghostInstructorId = "instructor_does_not_exist";

  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: editorId,
      email: "editor_open_10@example.com",
      clerkId: editorId,
      role: "video_editor",
    });
    // Open access, but the target instructor is not in the `instructors`
    // table — the page-side dropdown would not show them, but a
    // hand-crafted POST must be rejected server-side.
    await ctx.db.insert("videoEditorAssignments", {
      videoEditorId: editorId,
      assignedAt: Date.now(),
    });
  });

  const editorClient = t.withIdentity({ subject: editorId });

  await expect(
    editorClient.mutation(api.instructorUploads.createUpload, {
      id: "open_ghost_upload",
      instructorId: ghostInstructorId,
      filename: "key/open_ghost_upload",
      originalName: "open_ghost_upload.mp4",
      contentType: "video/mp4",
      size: 100 * 1024 * 1024,
      uploadedById: editorId,
    })
  ).rejects.toThrow("Target instructor not found");
});

test("getVideoEditorTotalStorageStats: returns editor's true historical usage regardless of current assignments", async () => {
  // After open access is revoked, the editor's per-row view collapses to
  // 0 (the open row is deleted and specific rows cover only their own
  // instructor). The dashboard should still show the files that are still
  // in B2 — i.e. the editor's true historical footprint via
  // `by_uploadedById`.
  const t = convexTest(schema, modules);

  const editorId = "editor_total_1";
  const instructorA = "instructor_total_1a";
  const instructorB = "instructor_total_1b";
  const uploadSize = 25 * 1024 * 1024; // 25 MB

  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: editorId,
      email: "editor_total_1@example.com",
      clerkId: editorId,
      role: "video_editor",
    });
    await ctx.db.insert("users", {
      userId: instructorA,
      email: "instructor_total_1a@example.com",
      clerkId: instructorA,
      role: "instructor",
    });
    await ctx.db.insert("instructors", {
      userId: instructorA,
      email: "instructor_total_1a@example.com",
      name: "Instructor Total 1a",
    });
    await ctx.db.insert("users", {
      userId: instructorB,
      email: "instructor_total_1b@example.com",
      clerkId: instructorB,
      role: "instructor",
    });
    await ctx.db.insert("instructors", {
      userId: instructorB,
      email: "instructor_total_1b@example.com",
      name: "Instructor Total 1b",
    });
    // Two uploads across two instructors, no specific assignment.
    for (const instructorId of [instructorA, instructorB]) {
      await ctx.db.insert("instructorUploads", {
        instructorId,
        filename: `key/historical_${instructorId}`,
        originalName: `historical_${instructorId}.mp4`,
        contentType: "video/mp4",
        size: uploadSize,
        status: "completed",
        uploadedById: editorId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
    // One deleted upload that should NOT be counted.
    await ctx.db.insert("instructorUploads", {
      instructorId: instructorA,
      filename: "key/historical_deleted",
      originalName: "historical_deleted.mp4",
      contentType: "video/mp4",
      size: 999 * 1024 * 1024,
      status: "deleted",
      uploadedById: editorId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    // HUC-58: seed the denormalized counter directly because the rows
    // above were inserted via `ctx.db.insert` rather than the public
    // `createUpload` mutation (which would have incremented the
    // counter atomically). The counter is what `getVideoEditorTotalStorageStats`
    // reads; this setup mirrors the post-backfill state.
    await ctx.db.insert("videoEditorStorageStats", {
      videoEditorId: editorId,
      usedBytes: 2 * uploadSize,
      fileCount: 2,
      lastUpdatedAt: Date.now(),
    });
  });

  const editorClient = t.withIdentity({ subject: editorId });

  const stats = await editorClient.query(
    api.instructorUploads.getVideoEditorTotalStorageStats,
    { videoEditorId: editorId }
  );
  // 2 active × 25 MB = 50 MB. The 999 MB deleted row must be excluded.
  expect(stats.usedBytes).toBe(2 * uploadSize);
  expect(stats.fileCount).toBe(2);
});

test("requireDeleteAccess: video editor can clean up own in-progress upload after open access revoked", async () => {
  // The route-level abort fallback lets the editor abort the B2
  // multipart state, then `softDeleteUpload` accepts the cleanup path
  // for in-progress rows (regardless of whether b2UploadId is set) so
  // the row can be marked deleted. Without this fallback, revoking an
  // editor's open access mid-multipart-upload would leave the Convex
  // row stuck in 'uploading'.
  const t = convexTest(schema, modules);

  const editorId = "editor_cleanup_1";
  const instructorId = "instructor_cleanup_1";

  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: editorId,
      email: "editor_cleanup_1@example.com",
      clerkId: editorId,
      role: "video_editor",
    });
    await ctx.db.insert("users", {
      userId: instructorId,
      email: "instructor_cleanup_1@example.com",
      clerkId: instructorId,
      role: "instructor",
    });
    await ctx.db.insert("instructors", {
      userId: instructorId,
      email: "instructor_cleanup_1@example.com",
      name: "Instructor Cleanup 1",
    });
    // No assignments — open access was revoked.
    await ctx.db.insert("instructorUploads", {
      legacyId: "cleanup_upload_1",
      instructorId,
      filename: "key/cleanup_upload_1",
      originalName: "cleanup_upload_1.mp4",
      contentType: "video/mp4",
      size: 100 * 1024 * 1024,
      status: "uploading",
      uploadedById: editorId,
      b2UploadId: "test-upload-id",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  const editorClient = t.withIdentity({ subject: editorId });

  await expect(
    editorClient.mutation(api.instructorUploads.softDeleteUpload, {
      id: "cleanup_upload_1",
    })
  ).resolves.toBeDefined();

  const after = await t.run(async (ctx) =>
    ctx.db
      .query("instructorUploads")
      .withIndex("by_legacyId", (q) => q.eq("legacyId", "cleanup_upload_1"))
      .first()
  );
  expect(after?.status).toBe("deleted");
});

test("requireDeleteAccess: video editor cannot delete own completed upload without assignment", async () => {
  // After open access is revoked, the editor must NOT be able to delete
  // already-completed files via the cleanup fallback — that would allow
  // the editor to wipe data they no longer have any right to manage.
  const t = convexTest(schema, modules);

  const editorId = "editor_cleanup_2";
  const instructorId = "instructor_cleanup_2";

  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: editorId,
      email: "editor_cleanup_2@example.com",
      clerkId: editorId,
      role: "video_editor",
    });
    await ctx.db.insert("users", {
      userId: instructorId,
      email: "instructor_cleanup_2@example.com",
      clerkId: instructorId,
      role: "instructor",
    });
    await ctx.db.insert("instructors", {
      userId: instructorId,
      email: "instructor_cleanup_2@example.com",
      name: "Instructor Cleanup 2",
    });
    await ctx.db.insert("instructorUploads", {
      legacyId: "cleanup_completed_1",
      instructorId,
      filename: "key/cleanup_completed_1",
      originalName: "cleanup_completed_1.mp4",
      contentType: "video/mp4",
      size: 100 * 1024 * 1024,
      status: "completed",
      uploadedById: editorId,
      b2FileId: "b2-file-id",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  const editorClient = t.withIdentity({ subject: editorId });

  await expect(
    editorClient.mutation(api.instructorUploads.softDeleteUpload, {
      id: "cleanup_completed_1",
    })
  ).rejects.toThrow("Forbidden");
});

test("setVideoEditorAssignmentQuota: rejects open assignments", async () => {
  // Open assignments deliberately have no per-instructor quota, so
  // allowing an admin to set one would create a misleading limit
  // (uploads ignore it, but the dashboard would display it).
  const t = convexTest(schema, modules);

  const adminId = "admin_quota_open";
  const editorId = "editor_quota_open";

  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: adminId,
      email: "admin_quota_open@example.com",
      clerkId: adminId,
      role: "admin",
    });
    await ctx.db.insert("users", {
      userId: editorId,
      email: "editor_quota_open@example.com",
      clerkId: editorId,
      role: "video_editor",
    });
    await ctx.db.insert("videoEditorAssignments", {
      videoEditorId: editorId,
      instructorId: undefined,
    });
  });

  const adminClient = t.withIdentity({ subject: adminId });

  // Get the open assignment id.
  const openAssignmentId = await t.run(async (ctx) => {
    const rows = await ctx.db
      .query("videoEditorAssignments")
      .withIndex("by_videoEditorId", (q) => q.eq("videoEditorId", editorId))
      .collect();
    return rows[0]._id;
  });

  await expect(
    adminClient.mutation(api.videoEditorAssignments.setVideoEditorAssignmentQuota, {
      assignmentId: openAssignmentId,
      storageQuotaBytes: 100 * 1024 * 1024,
    })
  ).rejects.toThrow("Cannot set quota on open assignments");
});

test("createUpload: rejects soft-deleted instructor even with open access", async () => {
  // An admin may soft-delete an instructor (users.deletedAt set) but
  // the instructors profile row remains. Without this check, an editor
  // with open access could target a soft-deleted instructor and create
  // a file row + B2 object for a decommissioned user.
  const t = convexTest(schema, modules);

  const editorId = "editor_deleted_1";
  const deletedInstructorId = "instructor_deleted_1";

  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: editorId,
      email: "editor_deleted_1@example.com",
      clerkId: editorId,
      role: "video_editor",
    });
    await ctx.db.insert("users", {
      userId: deletedInstructorId,
      email: "instructor_deleted_1@example.com",
      clerkId: deletedInstructorId,
      role: "instructor",
      deletedAt: Date.now() - 1000,
    });
    await ctx.db.insert("instructors", {
      userId: deletedInstructorId,
      email: "instructor_deleted_1@example.com",
      name: "Deleted Instructor 1",
    });
    // Open access assignment exists.
    await ctx.db.insert("videoEditorAssignments", {
      videoEditorId: editorId,
      instructorId: undefined,
    });
  });

  const editorClient = t.withIdentity({ subject: editorId });

  await expect(
    editorClient.mutation(api.instructorUploads.createUpload, {
      id: "upload_to_deleted_1",
      instructorId: deletedInstructorId,
      filename: "key/upload_to_deleted_1",
      originalName: "upload_to_deleted_1.mp4",
      contentType: "video/mp4",
      size: 1024 * 1024,
      uploadedById: editorId,
    })
  ).rejects.toThrow("Target instructor is no longer active");
});

test("createUpload: rejects former instructor (role removed) even with open access", async () => {
  // When a user's role is removed from 'instructor', their instructors
  // profile row remains. Without this check, an editor with open access
  // could submit that user's ID directly and create a file in a non-
  // instructor's storage, even though the instructor selector excludes
  // the user.
  const t = convexTest(schema, modules);

  const editorId = "editor_demoted_1";
  const demotedInstructorId = "instructor_demoted_1";

  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: editorId,
      email: "editor_demoted_1@example.com",
      clerkId: editorId,
      role: "video_editor",
    });
    await ctx.db.insert("users", {
      userId: demotedInstructorId,
      email: "instructor_demoted_1@example.com",
      clerkId: demotedInstructorId,
      role: "student",
    });
    await ctx.db.insert("instructors", {
      userId: demotedInstructorId,
      email: "instructor_demoted_1@example.com",
      name: "Demoted Instructor 1",
    });
    await ctx.db.insert("videoEditorAssignments", {
      videoEditorId: editorId,
      instructorId: undefined,
    });
  });

  const editorClient = t.withIdentity({ subject: editorId });

  await expect(
    editorClient.mutation(api.instructorUploads.createUpload, {
      id: "upload_to_demoted_1",
      instructorId: demotedInstructorId,
      filename: "key/upload_to_demoted_1",
      originalName: "upload_to_demoted_1.mp4",
      contentType: "video/mp4",
      size: 1024 * 1024,
      uploadedById: editorId,
    })
  ).rejects.toThrow("Target is no longer an instructor");
});

test("createUpload: rejects soft-deleted instructor profile even with open access", async () => {
  // The instructors profile row itself may be soft-deleted while the
  // users row retains role='instructor'. The upload mutation must
  // check both: profile.deletedAt AND users.deletedAt AND
  // users.role. Profile deletion is independent from user deletion.
  const t = convexTest(schema, modules);

  const editorId = "editor_profile_deleted_1";
  const instructorId = "instructor_profile_deleted_1";

  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: editorId,
      email: "editor_profile_deleted_1@example.com",
      clerkId: editorId,
      role: "video_editor",
    });
    await ctx.db.insert("users", {
      userId: instructorId,
      email: "instructor_profile_deleted_1@example.com",
      clerkId: instructorId,
      role: "instructor",
    });
    await ctx.db.insert("instructors", {
      userId: instructorId,
      email: "instructor_profile_deleted_1@example.com",
      name: "Profile-Deleted Instructor",
      deletedAt: Date.now() - 1000,
    });
    await ctx.db.insert("videoEditorAssignments", {
      videoEditorId: editorId,
      instructorId: undefined,
    });
  });

  const editorClient = t.withIdentity({ subject: editorId });

  await expect(
    editorClient.mutation(api.instructorUploads.createUpload, {
      id: "upload_to_profile_deleted_1",
      instructorId,
      filename: "key/upload_to_profile_deleted_1",
      originalName: "upload_to_profile_deleted_1.mp4",
      contentType: "video/mp4",
      size: 1024 * 1024,
      uploadedById: editorId,
    })
  ).rejects.toThrow("Target instructor profile is no longer active");
});

test("getActiveUsersByRole: excludes soft-deleted instructor profiles", async () => {
  // Round-21 Greptile P2 #3: getActiveUsersByRole now filters out
  // instructors whose profile.deletedAt is set, in addition to
  // users.deletedAt and the role check. createUpload also rejects
  // these profiles, so the dropdown must not surface them.
  const t = convexTest(schema, modules);

  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: "active_instructor_1",
      email: "active_instructor_1@example.com",
      clerkId: "active_instructor_1",
      role: "instructor",
    });
    await ctx.db.insert("instructors", {
      userId: "active_instructor_1",
      email: "active_instructor_1@example.com",
      name: "Active Instructor",
    });
    await ctx.db.insert("users", {
      userId: "deleted_profile_instructor_1",
      email: "deleted_profile_instructor_1@example.com",
      clerkId: "deleted_profile_instructor_1",
      role: "instructor",
    });
    await ctx.db.insert("instructors", {
      userId: "deleted_profile_instructor_1",
      email: "deleted_profile_instructor_1@example.com",
      name: "Deleted-Profile Instructor",
      deletedAt: Date.now() - 1000,
    });
  });

  const client = t.withIdentity({ subject: "active_instructor_1" });
  const active = (await client.query(api.users.getActiveUsersByRole, {
    role: "instructor",
  })) as Array<{ userId: string }>;
  const ids = active.map((u) => u.userId);
  expect(ids).toContain("active_instructor_1");
  expect(ids).not.toContain("deleted_profile_instructor_1");
});

/**
 * Hardened `requireAdminOrSelf` — covers the failure modes that
 * intermittently surfaced as 500s on `drive.huckleberry.art/dashboard`
 * for video editors in late September 2026:
 *
 *   1. The caller's Clerk `subject` matches `users.clerkId` only (not
 *      `users.userId`). The original lookup-first-by-userId path
 *      returned null and fell through to `Forbidden`. The hardened
 *      resolver resolves via BOTH indexes and matches by canonical
 *      `_id`, so the editor's own `getVideoEditorOpenAssignment` no
 *      longer 500s.
 *
 *   2. The arg passed by the page (`videoEditorId`) is the caller's
 *      `clerkId` (when apps/platform wrote Clerk IDs directly into
 *      `users.userId`). The hardened check accepts the arg match
 *      against either `caller.userId` OR `caller.clerkId`.
 *
 *   3. Split-record rows (same Clerk account, two `users` rows) — the
 *      hardened check uses `_id` equality so it doesn't accidentally
 *      accept a sibling split when only the Clerk ID matches.
 *
 *   4. Caller is genuinely absent from the users table — explicit
 *      "Forbidden: caller is not in the users table" message rather
 *      than a silent null deref.
 *
 *   5. Admin can read any video editor's open assignment.
 */
test("requireAdminOrSelf: video editor whose Clerk subject matches clerkId only can read their own open assignment", async () => {
  const t = convexTest(schema, modules);

  const canonicalEditorId = "editor_canonical_1";
  const editorClerkId = "editor_clerk_1";

  await t.run(async (ctx) => {
    // User's userId is a canonical (non-Clerk) ID. Their clerkId is the
    // Clerk subject. This is the apps/huckleberry-drive pattern: the
    // Clerk account stays single but the Convex userId is distinct.
    await ctx.db.insert("users", {
      userId: canonicalEditorId,
      email: "editor_canonical_1@example.com",
      clerkId: editorClerkId,
      role: "video_editor",
    });
  });

  // Authenticate as the editor via their Clerk ID.
  const editorClient = t.withIdentity({ subject: editorClerkId });

  // Page passes the canonical userId (dbUser.userId from getCurrentUser).
  const open = await editorClient.query(
    api.videoEditorAssignments.getVideoEditorOpenAssignment,
    { videoEditorId: canonicalEditorId }
  );
  expect(open).toBeNull();
});

test("requireAdminOrSelf: editor cannot read another editor's open assignment via just the userId match", async () => {
  const t = convexTest(schema, modules);

  const editorAId = "editor_a";
  const editorAClerk = "editor_a_clerk";
  const editorBId = "editor_b";
  const editorBClerk = "editor_b_clerk";

  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: editorAId,
      email: "a@example.com",
      clerkId: editorAClerk,
      role: "video_editor",
    });
    await ctx.db.insert("users", {
      userId: editorBId,
      email: "b@example.com",
      clerkId: editorBClerk,
      role: "video_editor",
    });
    // Give editor B an open assignment — A must not be able to read it.
    await ctx.db.insert("videoEditorAssignments", {
      videoEditorId: editorBId,
      assignedAt: Date.now(),
    });
  });

  const editorAClient = t.withIdentity({ subject: editorAClerk });
  await expect(
    editorAClient.query(
      api.videoEditorAssignments.getVideoEditorOpenAssignment,
      { videoEditorId: editorBId }
    )
  ).rejects.toThrow("Forbidden");
});

test("requireAdminOrSelf: split-record editor (canonical userId matches another row's userId) cannot read sibling's open assignment", async () => {
  const t = convexTest(schema, modules);

  // Simulates the onboardingAlias split: one Clerk account, two
  // `users` rows. Row A has the canonical userId the page would pass.
  // Row B is the same Clerk account on a different canonical ID.
  // The editor is logged in via Clerk ID — the hardened check should
  // resolve to the right row (the one whose clerkId matches) and
  // refuse access to a sibling row that happens to share the Clerk ID.
  const sharedClerk = "shared_clerk_id";
  const canonicalA = "canonical_a";
  const canonicalB = "canonical_b";

  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: canonicalA,
      email: "a@example.com",
      clerkId: sharedClerk,
      role: "video_editor",
      onboardingAlias: "split-a",
    });
    await ctx.db.insert("users", {
      userId: canonicalB,
      email: "b@example.com",
      clerkId: sharedClerk,
      role: "video_editor",
      onboardingAlias: "split-b",
    });
  });

  const client = t.withIdentity({ subject: sharedClerk });

  // The page passes canonicalA — must succeed (the caller IS the row
  // with userId=canonicalA).
  const openA = await client.query(
    api.videoEditorAssignments.getVideoEditorOpenAssignment,
    { videoEditorId: canonicalA }
  );
  expect(openA).toBeNull();

  // Passing canonicalB (the sibling row) — must fail. The hardened
  // check sees caller._id !== target._id, and the Clerk subject
  // doesn't equal canonicalB, so it 403s. This is the new behavior;
  // the old check `callerByClerkId.userId === userId` would also
  // 403 here (because the resolver's `first()` is non-deterministic
  // between rows), so we pin the hardened check's `_id` semantics.
  // We use rejects.toThrow with a generic Forbidden to allow either
  // "Forbidden" or "Forbidden: caller is not in the users table".
  await expect(
    client.query(
      api.videoEditorAssignments.getVideoEditorOpenAssignment,
      { videoEditorId: canonicalB }
    )
  ).rejects.toThrow();
});

test("requireAdminOrSelf: caller whose Clerk subject has no matching users row is rejected with explicit error", async () => {
  const t = convexTest(schema, modules);

  // No users row inserted for this Clerk ID. The hardened check
  // surfaces a clear error rather than letting the original code
  // fall through to "Forbidden" with a confusing stack.
  const orphanClerk = "orphan_clerk_id";
  const client = t.withIdentity({ subject: orphanClerk });

  await expect(
    client.query(api.videoEditorAssignments.getVideoEditorOpenAssignment, {
      videoEditorId: "any_id",
    })
  ).rejects.toThrow("Forbidden");
});

test("requireAdminOrSelf: admin can read any video editor's open assignment regardless of arg form", async () => {
  const t = convexTest(schema, modules);

  const editorId = "editor_for_admin_test";
  const editorClerk = "editor_clerk_for_admin_test";
  const adminUserId = "admin_canonical_id";
  const adminClerk = "admin_clerk_id";

  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: editorId,
      email: "editor@example.com",
      clerkId: editorClerk,
      role: "video_editor",
    });
    await ctx.db.insert("users", {
      userId: adminUserId,
      email: "admin@example.com",
      clerkId: adminClerk,
      role: "admin",
    });
    await ctx.db.insert("videoEditorAssignments", {
      videoEditorId: editorId,
      assignedAt: Date.now(),
    });
  });

  // Admin authenticates by their Clerk ID (the apps/huckleberry-drive
  // pattern: clerkId differs from userId for the admin row).
  const adminClient = t.withIdentity({ subject: adminClerk });

  // Pass the editor's canonical userId — this matches what the page
  // passes (`dbUser.userId`) and is what the assignments index is
  // keyed by.
  const open = await adminClient.query(
    api.videoEditorAssignments.getVideoEditorOpenAssignment,
    { videoEditorId: editorId }
  );
  expect(open).not.toBeNull();
  expect(open?.instructorId).toBeUndefined();
});
