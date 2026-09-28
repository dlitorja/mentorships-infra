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

test("getVideoEditorAssignmentsWithStorage: mixed open + specific returns per-row stats (consumer de-duplicates)", async () => {
  const t = convexTest(schema, modules);

  const editorId = "editor_open_11";
  const specificInstructor = "instructor_open_11";
  const otherInstructor = "instructor_open_11_other";
  const uploadSize = 50 * 1024 * 1024; // 50 MB

  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: editorId,
      email: "editor_open_11@example.com",
      clerkId: editorId,
      role: "video_editor",
    });
    await ctx.db.insert("users", {
      userId: specificInstructor,
      email: "instructor_open_11@example.com",
      clerkId: specificInstructor,
      role: "instructor",
    });
    await ctx.db.insert("instructors", {
      userId: specificInstructor,
      email: "instructor_open_11@example.com",
      name: "Instructor Open 11",
    });
    await ctx.db.insert("users", {
      userId: otherInstructor,
      email: "instructor_open_11_other@example.com",
      clerkId: otherInstructor,
      role: "instructor",
    });
    await ctx.db.insert("instructors", {
      userId: otherInstructor,
      email: "instructor_open_11_other@example.com",
      name: "Instructor Open 11 Other",
    });
    // Open + specific coexist.
    await ctx.db.insert("videoEditorAssignments", {
      videoEditorId: editorId,
      assignedAt: Date.now(),
    });
    await ctx.db.insert("videoEditorAssignments", {
      videoEditorId: editorId,
      instructorId: specificInstructor,
      assignedAt: Date.now(),
      storageQuotaBytes: 100 * 1024 * 1024,
    });
    // Three uploads across two instructors.
    await ctx.db.insert("instructorUploads", {
      instructorId: specificInstructor,
      filename: "key/a",
      originalName: "a.mp4",
      contentType: "video/mp4",
      size: uploadSize,
      status: "completed",
      uploadedById: editorId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await ctx.db.insert("instructorUploads", {
      instructorId: otherInstructor,
      filename: "key/b",
      originalName: "b.mp4",
      contentType: "video/mp4",
      size: uploadSize,
      status: "completed",
      uploadedById: editorId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await ctx.db.insert("instructorUploads", {
      instructorId: specificInstructor,
      filename: "key/c",
      originalName: "c.mp4",
      contentType: "video/mp4",
      size: uploadSize,
      status: "completed",
      uploadedById: editorId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  const adminId = "admin_open_11";
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: adminId,
      email: "admin_open_11@example.com",
      clerkId: adminId,
      role: "admin",
    });
  });

  const adminClient = t.withIdentity({ subject: adminId });

  // The query returns per-row stats so the admin table can show
  // per-instructor usage even when an open row coexists. Aggregate
  // consumers (e.g. /api/storage-usage) are responsible for de-duplicating
  // when an open row is present.
  const rows = await adminClient.query(
    api.videoEditorAssignments.getVideoEditorAssignmentsWithStorage,
    { videoEditorId: editorId }
  );
  const openRow = rows.find((r) => r.assignment.instructorId === undefined);
  const specificRow = rows.find((r) => r.assignment.instructorId === specificInstructor);
  expect(openRow).toBeDefined();
  expect(specificRow).toBeDefined();

  // Open row: 3 uploads × 50 MB = 150 MB across two instructors.
  expect(openRow!.usedBytes).toBe(3 * uploadSize);
  expect(openRow!.fileCount).toBe(3);

  // Specific row: 2 uploads × 50 MB = 100 MB on specificInstructor.
  // This is the per-instructor figure admins need to review quotas. The
  // fact that the same 100 MB is also visible in the open row is fine —
  // /api/storage-usage skips specific rows when open is present.
  expect(specificRow!.usedBytes).toBe(2 * uploadSize);
  expect(specificRow!.fileCount).toBe(2);
});

test("computeVideoEditorOpenStorageStats: aggregates large upload history correctly", async () => {
  // Insert 250 uploads to verify the totals are correct even when the
  // editor has a long history (the active-upload filter is applied across
  // the full result set). Long-term scaling for editors with thousands
  // of rows is tracked as a follow-up (precomputed aggregate row).
  const t = convexTest(schema, modules);

  const editorId = "editor_open_12";
  const targetInstructor = "instructor_open_12";
  const uploadSize = 1024; // 1 KB
  const total = 250;

  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: editorId,
      email: "editor_open_12@example.com",
      clerkId: editorId,
      role: "video_editor",
    });
    await ctx.db.insert("users", {
      userId: targetInstructor,
      email: "instructor_open_12@example.com",
      clerkId: targetInstructor,
      role: "instructor",
    });
    await ctx.db.insert("instructors", {
      userId: targetInstructor,
      email: "instructor_open_12@example.com",
      name: "Instructor Open 12",
    });
    await ctx.db.insert("videoEditorAssignments", {
      videoEditorId: editorId,
      assignedAt: Date.now(),
    });

    const now = Date.now();
    for (let i = 0; i < total; i++) {
      const status = i % 5 === 0 ? "deleted" : "completed";
      await ctx.db.insert("instructorUploads", {
        instructorId: targetInstructor,
        filename: `key/bulk_${i}`,
        originalName: `bulk_${i}.mp4`,
        contentType: "video/mp4",
        size: uploadSize,
        status,
        uploadedById: editorId,
        createdAt: now + i,
        updatedAt: now + i,
      });
    }
  });

  const adminId = "admin_open_12";
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: adminId,
      email: "admin_open_12@example.com",
      clerkId: adminId,
      role: "admin",
    });
  });

  const adminClient = t.withIdentity({ subject: adminId });

  const rows = await adminClient.query(
    api.videoEditorAssignments.getVideoEditorAssignmentsWithStorage,
    { videoEditorId: editorId }
  );
  const openRow = rows.find((r) => r.assignment.instructorId === undefined);
  expect(openRow).toBeDefined();

  // 250 total - 50 deleted (every 5th) = 200 active uploads × 1 KB = 200 KB.
  expect(openRow!.fileCount).toBe(200);
  expect(openRow!.usedBytes).toBe(200 * uploadSize);
});
