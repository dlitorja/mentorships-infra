/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const HTTP_KEY = "test-http-key-export";

function bearerHeaders(key: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${key}`,
  };
}

async function seedWorkspaceAndUsers(
  t: ReturnType<typeof convexTest>
): Promise<{
  workspaceId: string;
  instructorId: string;
  studentUserId: string;
  instructorUserId: string;
  instructorRowId: string;
}> {
  let workspaceId = "";
  let instructorId = "";
  let studentUserId = "user_export_student";
  let instructorUserId = "user_export_instructor";
  let instructorRowId = "";

  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: studentUserId,
      clerkId: studentUserId,
      email: "student-export@example.com",
      role: "student",
    });
    await ctx.db.insert("users", {
      userId: instructorUserId,
      clerkId: instructorUserId,
      email: "instructor-export@example.com",
      role: "instructor",
    });
    instructorId = await ctx.db.insert("instructors", {
      userId: instructorUserId,
      email: "instructor-export@example.com",
      name: "Export Instructor",
      isActive: true,
      isNew: false,
      oneOnOneInventory: 0,
      groupInventory: 0,
      maxActiveStudents: 10,
    });
    instructorRowId = instructorId;
    workspaceId = await ctx.db.insert("workspaces", {
      name: "Export Test",
      ownerId: studentUserId,
      instructorId,
      isPublic: false,
      studentImageCount: 0,
      instructorImageCount: 0,
    });
  });

  return { workspaceId, instructorId, studentUserId, instructorUserId, instructorRowId };
}

test("createWorkspaceExport inserts a pending row for the authenticated student", async () => {
  const t = convexTest(schema, modules);
  delete process.env.TRIGGER_SECRET_KEY;
  const { workspaceId, studentUserId } = await seedWorkspaceAndUsers(t);

  const student = t.withIdentity({ subject: studentUserId });
  // The mutation sends a Trigger.dev fetch in CI; with no secret it must
  // catch the missing key path and mark the row as failed. Confirm
  // either outcome leaves exactly one row in workspaceExports.
  await student.mutation(api.workspaces.createWorkspaceExport, {
    workspaceId,
    userId: studentUserId,
    format: "zip",
  });

  const rows = await t.run(async (ctx) => ctx.db.query("workspaceExports").collect());
  expect(rows.length).toBe(1);
  expect(rows[0].workspaceId).toBe(workspaceId);
  expect(rows[0].userId).toBe(studentUserId);
  expect(rows[0].format).toBe("zip");
  // Status will be "pending" if the trigger secret was set OR "failed"
  // with an explicit errorMessage if the secret is missing. Both
  // outcomes indicate the row was inserted successfully.
  expect(["pending", "failed"]).toContain(rows[0].status);
});

test("createWorkspaceExport rejects an unauthenticated caller", async () => {
  const t = convexTest(schema, modules);
  delete process.env.TRIGGER_SECRET_KEY;
  const { workspaceId, studentUserId } = await seedWorkspaceAndUsers(t);

  await expect(
    t.mutation(api.workspaces.createWorkspaceExport, {
      workspaceId,
      userId: studentUserId,
      format: "zip",
    })
  ).rejects.toThrow(/Unauthorized/);
});

test("createWorkspaceExport rejects a non-participant", async () => {
  const t = convexTest(schema, modules);
  delete process.env.TRIGGER_SECRET_KEY;
  const { workspaceId } = await seedWorkspaceAndUsers(t);

  const stranger = t.withIdentity({ subject: "user_random_stranger" });
  await expect(
    stranger.mutation(api.workspaces.createWorkspaceExport, {
      workspaceId,
      userId: "user_random_stranger",
      format: "zip",
    })
  ).rejects.toThrow(/Not authorized to export this workspace/);
});

test("createWorkspaceExport stores the auth subject even when client userId disagrees", async () => {
  const t = convexTest(schema, modules);
  delete process.env.TRIGGER_SECRET_KEY;
  const { workspaceId, studentUserId } = await seedWorkspaceAndUsers(t);

  const student = t.withIdentity({ subject: studentUserId });
  await student.mutation(api.workspaces.createWorkspaceExport, {
    workspaceId,
    userId: "spoofed_user",
    format: "zip",
  });

  const rows = await t.run(async (ctx) => ctx.db.query("workspaceExports").collect());
  expect(rows.length).toBe(1);
  expect(rows[0].userId).toBe(studentUserId);
});

test("cancelWorkspaceExport is allowed for the export's owner", async () => {
  const t = convexTest(schema, modules);
  const { workspaceId, studentUserId } = await seedWorkspaceAndUsers(t);

  // Seed the export row directly so the test is independent of
  // TRIGGER_SECRET_KEY (which controls whether createWorkspaceExport
  // leaves the row in "pending" or "failed"). The "no errorMessage"
  // invariant is what makes a cancel distinguishable from a trigger
  // failure in `updateWorkspaceExportStatus`.
  const exportId = await t.run(async (ctx) =>
    ctx.db.insert("workspaceExports", {
      workspaceId,
      userId: studentUserId,
      format: "zip",
      status: "pending",
    })
  );

  const student = t.withIdentity({ subject: studentUserId });
  await student.mutation(api.workspaces.cancelWorkspaceExport, { id: exportId });
  const row = await t.run(async (ctx) => ctx.db.get(exportId));
  expect(row?.status).toBe("failed");
  // No errorMessage — distinguishes user-cancel from trigger-side errors
  // (see `updateWorkspaceExportStatus` "Export was cancelled" check).
  expect(row?.errorMessage).toBeUndefined();
});

test("cancelWorkspaceExport is allowed for a co-participant (the instructor)", async () => {
  const t = convexTest(schema, modules);
  const { workspaceId, studentUserId, instructorUserId } = await seedWorkspaceAndUsers(t);

  const exportId = await t.run(async (ctx) =>
    ctx.db.insert("workspaceExports", {
      workspaceId,
      userId: studentUserId,
      format: "zip",
      status: "pending",
    })
  );

  // Instructor is a workspace participant; cancelling on behalf of
  // the student is part of the cleanup-on-call-end flow.
  const instructor = t.withIdentity({ subject: instructorUserId });
  await instructor.mutation(api.workspaces.cancelWorkspaceExport, { id: exportId });
  const row = await t.run(async (ctx) => ctx.db.get(exportId));
  expect(row?.status).toBe("failed");
});

test("cancelWorkspaceExport rejects an unrelated authenticated user", async () => {
  const t = convexTest(schema, modules);
  const { workspaceId, studentUserId } = await seedWorkspaceAndUsers(t);

  const exportId = await t.run(async (ctx) =>
    ctx.db.insert("workspaceExports", {
      workspaceId,
      userId: studentUserId,
      format: "zip",
      status: "pending",
    })
  );

  const stranger = t.withIdentity({ subject: "user_random_stranger_cancel" });
  await expect(
    stranger.mutation(api.workspaces.cancelWorkspaceExport, { id: exportId })
  ).rejects.toThrow(/Not authorized to cancel this export/);
});

test("cancelWorkspaceExport rejects an unauthenticated caller", async () => {
  const t = convexTest(schema, modules);
  const { workspaceId, studentUserId } = await seedWorkspaceAndUsers(t);

  const exportId = await t.run(async (ctx) =>
    ctx.db.insert("workspaceExports", {
      workspaceId,
      userId: studentUserId,
      format: "zip",
      status: "pending",
    })
  );

  await expect(
    t.mutation(api.workspaces.cancelWorkspaceExport, { id: exportId })
  ).rejects.toThrow(/Unauthorized/);
});

test("getWorkspaceExports returns up to 10 most recent exports for participants", async () => {
  const t = convexTest(schema, modules);
  delete process.env.TRIGGER_SECRET_KEY;
  const { workspaceId, studentUserId } = await seedWorkspaceAndUsers(t);

  const student = t.withIdentity({ subject: studentUserId });
  for (let i = 0; i < 12; i++) {
    await student.mutation(api.workspaces.createWorkspaceExport, {
      workspaceId,
      userId: studentUserId,
      format: "zip",
    });
  }

  const exports = await student.query(api.workspaces.getWorkspaceExports, { workspaceId });
  expect(exports.length).toBe(10);
});

test("getWorkspaceExports returns empty for non-participants", async () => {
  const t = convexTest(schema, modules);
  delete process.env.TRIGGER_SECRET_KEY;
  const { workspaceId } = await seedWorkspaceAndUsers(t);

  const stranger = t.withIdentity({ subject: "user_random_stranger_query" });
  const exports = await stranger.query(api.workspaces.getWorkspaceExports, { workspaceId });
  expect(exports).toEqual([]);
});

test("getWorkspaceExports returns empty for an unauthenticated caller", async () => {
  const t = convexTest(schema, modules);
  const { workspaceId } = await seedWorkspaceAndUsers(t);

  const exports = await t.query(api.workspaces.getWorkspaceExports, { workspaceId });
  expect(exports).toEqual([]);
});

test("HTTP /workspace/export/data returns notes and images for the workspace", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = HTTP_KEY;
  const { workspaceId } = await seedWorkspaceAndUsers(t);

  // Seed a note and an image so the query has content to return.
  const noteId = await t.run(async (ctx) =>
    ctx.db.insert("workspaceNotes", {
      workspaceId,
      title: "HTTP export note",
      content: "Body of the note",
      createdBy: "user_export_student",
      updatedAt: Date.now(),
    })
  );
  const imageId = await t.run(async (ctx) =>
    ctx.db.insert("workspaceImages", {
      workspaceId,
      imageUrl: "https://example.com/a.png",
      createdBy: "user_export_student",
      deletedAt: undefined,
    })
  );
  await t.run(async (ctx) =>
    ctx.db.insert("workspaceNotes", {
      workspaceId,
      title: "deleted note",
      content: "should be filtered",
      createdBy: "user_export_student",
      updatedAt: Date.now(),
      deletedAt: Date.now(),
    })
  );

  const r = await t.fetch("/workspace/export/data", {
    method: "POST",
    headers: bearerHeaders(HTTP_KEY),
    body: JSON.stringify({ workspaceId }),
  });
  expect(r.status).toBe(200);
  const body = await r.json();
  expect(body.workspaceName).toBe("Export Test");
  expect(body.notes.map((n: { title: string }) => n.title)).toEqual(["HTTP export note"]);
  expect(body.images.length).toBe(1);
  expect(body.images[0].imageUrl).toBe("https://example.com/a.png");
  expect(noteId).toBeTruthy();
  expect(imageId).toBeTruthy();
});

test("HTTP /workspace/export/data filters images by imageIds", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = HTTP_KEY;
  const { workspaceId } = await seedWorkspaceAndUsers(t);

  const keepId = await t.run(async (ctx) =>
    ctx.db.insert("workspaceImages", {
      workspaceId,
      imageUrl: "https://example.com/keep.png",
      createdBy: "user_export_student",
    })
  );
  await t.run(async (ctx) =>
    ctx.db.insert("workspaceImages", {
      workspaceId,
      imageUrl: "https://example.com/drop.png",
      createdBy: "user_export_student",
    })
  );

  const r = await t.fetch("/workspace/export/data", {
    method: "POST",
    headers: bearerHeaders(HTTP_KEY),
    body: JSON.stringify({ workspaceId, imageIds: [keepId] }),
  });
  expect(r.status).toBe(200);
  const body = await r.json();
  expect(body.images.length).toBe(1);
  expect(body.images[0].imageUrl).toBe("https://example.com/keep.png");
});

test("HTTP /workspace/export/data returns 404 for a missing workspace", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = HTTP_KEY;

  const r = await t.fetch("/workspace/export/data", {
    method: "POST",
    headers: bearerHeaders(HTTP_KEY),
    body: JSON.stringify({ workspaceId: "workspaces_does_not_exist" }),
  });
  expect(r.status).toBe(404);
  const body = await r.json();
  expect(body.error).toMatch(/Workspace not found/);
});

test("HTTP /workspace/export/data rejects an unauthenticated caller", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = HTTP_KEY;
  const { workspaceId } = await seedWorkspaceAndUsers(t);

  const r = await t.fetch("/workspace/export/data", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId }),
  });
  expect(r.status).toBe(401);
});

test("HTTP /workspace/export/update-status updates status and downloadUrl", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = HTTP_KEY;
  const { workspaceId, studentUserId } = await seedWorkspaceAndUsers(t);

  const student = t.withIdentity({ subject: studentUserId });
  delete process.env.TRIGGER_SECRET_KEY;
  const { exportId } = await student.mutation(api.workspaces.createWorkspaceExport, {
    workspaceId,
    userId: studentUserId,
    format: "zip",
  });

  const r = await t.fetch("/workspace/export/update-status", {
    method: "POST",
    headers: bearerHeaders(HTTP_KEY),
    body: JSON.stringify({
      exportId,
      status: "completed",
      downloadUrl: "https://b2.example.com/export.zip",
      expiresAt: Date.now() + 86_400_000,
    }),
  });
  expect(r.status).toBe(200);

  const row = await t.run(async (ctx) => ctx.db.get(exportId));
  expect(row?.status).toBe("completed");
  expect(row?.downloadUrl).toBe("https://b2.example.com/export.zip");
  expect(row?.expiresAt).toBeGreaterThan(Date.now());
});

test("HTTP /workspace/export/update-status refuses to downgrade a completed export", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = HTTP_KEY;
  const { workspaceId, studentUserId } = await seedWorkspaceAndUsers(t);

  const student = t.withIdentity({ subject: studentUserId });
  delete process.env.TRIGGER_SECRET_KEY;
  const { exportId } = await student.mutation(api.workspaces.createWorkspaceExport, {
    workspaceId,
    userId: studentUserId,
    format: "zip",
  });
  // Manually mark completed via HTTP (same as the trigger would).
  await t.fetch("/workspace/export/update-status", {
    method: "POST",
    headers: bearerHeaders(HTTP_KEY),
    body: JSON.stringify({ exportId, status: "completed" }),
  });

  const r = await t.fetch("/workspace/export/update-status", {
    method: "POST",
    headers: bearerHeaders(HTTP_KEY),
    body: JSON.stringify({ exportId, status: "failed", errorMessage: "retried" }),
  });
  expect(r.status).toBe(500);
  const body = await r.json();
  expect(body.error).toMatch(/Export already completed/);
});

test("HTTP /workspace/export/update-status refuses to overwrite a user-initiated cancel", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = HTTP_KEY;
  const { workspaceId, studentUserId } = await seedWorkspaceAndUsers(t);

  const student = t.withIdentity({ subject: studentUserId });
  // Insert a "pending" export row directly and cancel it via the
  // mutation so the resulting "failed" row has no errorMessage —
  // matching the user-initiated-cancel shape that the trigger-side
  // overwrite check looks for.
  const exportId = await t.run(async (ctx) =>
    ctx.db.insert("workspaceExports", {
      workspaceId,
      userId: studentUserId,
      format: "zip",
      status: "pending",
    })
  );
  await student.mutation(api.workspaces.cancelWorkspaceExport, { id: exportId });

  const r = await t.fetch("/workspace/export/update-status", {
    method: "POST",
    headers: bearerHeaders(HTTP_KEY),
    body: JSON.stringify({ exportId, status: "processing" }),
  });
  expect(r.status).toBe(500);
  const body = await r.json();
  expect(body.error).toMatch(/Export was cancelled/);
});

test("HTTP /workspace/export/get returns the export's owner + workspace", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = HTTP_KEY;
  const { workspaceId, studentUserId } = await seedWorkspaceAndUsers(t);

  const student = t.withIdentity({ subject: studentUserId });
  delete process.env.TRIGGER_SECRET_KEY;
  const { exportId } = await student.mutation(api.workspaces.createWorkspaceExport, {
    workspaceId,
    userId: studentUserId,
    format: "zip",
  });

  const r = await t.fetch("/workspace/export/get", {
    method: "POST",
    headers: bearerHeaders(HTTP_KEY),
    body: JSON.stringify({ exportId }),
  });
  expect(r.status).toBe(200);
  const body = await r.json();
  expect(body.userId).toBe(studentUserId);
  expect(body.workspaceId).toBe(workspaceId);
  expect(body.workspaceName).toBe("Export Test");
  expect(body.status).toBe("failed");
});

test("HTTP /workspace/export/get returns 404 for a missing export", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = HTTP_KEY;

  const r = await t.fetch("/workspace/export/get", {
    method: "POST",
    headers: bearerHeaders(HTTP_KEY),
    body: JSON.stringify({ exportId: "workspaceExports_does_not_exist" }),
  });
  expect(r.status).toBe(404);
});
