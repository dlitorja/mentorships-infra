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

/**
 * `createWorkspaceExport` falls back to `TRIGGER_API_KEY` when
 * `TRIGGER_SECRET_KEY` is unset, so a test environment that exports
 * only one of them could leave the row in "pending" while the test
 * expects it to have failed. Clear both before any test that asserts
 * on the post-mutation status.
 */
function clearTriggerCredentials(): void {
  delete process.env.TRIGGER_SECRET_KEY;
  delete process.env.TRIGGER_API_KEY;
}

test("createWorkspaceExport inserts a pending row for the authenticated student", async () => {
  const t = convexTest(schema, modules);
  clearTriggerCredentials();
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
  clearTriggerCredentials();
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
  clearTriggerCredentials();
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
  clearTriggerCredentials();
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
  clearTriggerCredentials();
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
  clearTriggerCredentials();
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
      imageUrl: "https://export-test.convex.cloud/api/storage/abc",
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
  expect(body.images[0].imageUrl).toBe("https://export-test.convex.cloud/api/storage/abc");
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
      imageUrl: "https://export-test.convex.cloud/api/storage/keep",
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
  expect(body.images[0].imageUrl).toBe("https://export-test.convex.cloud/api/storage/keep");
});

test("HTTP /workspace/export/data returns 404 for a missing workspace", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = HTTP_KEY;
  // Use a valid-but-deleted id: a malformed id fails argument validation
  // before the handler can map "not found" to 404.
  const seeded = await seedWorkspaceAndUsers(t);
  await t.run(async (ctx) => {
    await ctx.db.delete(seeded.workspaceId as any);
  });

  const r = await t.fetch("/workspace/export/data", {
    method: "POST",
    headers: bearerHeaders(HTTP_KEY),
    body: JSON.stringify({ workspaceId: seeded.workspaceId }),
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
  clearTriggerCredentials();
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
  clearTriggerCredentials();
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
  clearTriggerCredentials();
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
  // Valid-but-deleted id, for the same validation reason as above.
  const seeded = await seedWorkspaceAndUsers(t);
  const exportId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("workspaceExports", {
      workspaceId: seeded.workspaceId as any,
      userId: "user_export_student",
      format: "pdf",
      status: "pending",
    });
    await ctx.db.delete(id);
    return id;
  });

  const r = await t.fetch("/workspace/export/get", {
    method: "POST",
    headers: bearerHeaders(HTTP_KEY),
    body: JSON.stringify({ exportId }),
  });
  expect(r.status).toBe(404);
});

// ---------------------------------------------------------------------------
// Scope-aware exports (Images ZIP vs Links CSV)
// ---------------------------------------------------------------------------

test("createWorkspaceExport stores the scope for a links CSV export", async () => {
  const t = convexTest(schema, modules);
  clearTriggerCredentials();
  const { workspaceId, studentUserId } = await seedWorkspaceAndUsers(t);

  const student = t.withIdentity({ subject: studentUserId });
  await student.mutation(api.workspaces.createWorkspaceExport, {
    workspaceId,
    userId: studentUserId,
    format: "csv",
    scope: "links",
  });

  const rows = await t.run(async (ctx) => ctx.db.query("workspaceExports").collect());
  expect(rows.length).toBe(1);
  expect(rows[0].format).toBe("csv");
  expect(rows[0].scope).toBe("links");
});

test("createWorkspaceExport stores the scope for an images ZIP export", async () => {
  const t = convexTest(schema, modules);
  clearTriggerCredentials();
  const { workspaceId, studentUserId } = await seedWorkspaceAndUsers(t);

  const student = t.withIdentity({ subject: studentUserId });
  await student.mutation(api.workspaces.createWorkspaceExport, {
    workspaceId,
    userId: studentUserId,
    format: "zip",
    scope: "images",
  });

  const rows = await t.run(async (ctx) => ctx.db.query("workspaceExports").collect());
  expect(rows[0].scope).toBe("images");
  expect(rows[0].format).toBe("zip");
});

test("createWorkspaceExport fails loudly for an unsupported format/scope pair", async () => {
  const t = convexTest(schema, modules);
  // Keep a placeholder key so the credential guard passes and the
  // unsupported-pair branch runs. That branch returns before any
  // network call, so nothing is sent to Trigger.dev.
  process.env.TRIGGER_SECRET_KEY = "trig_placeholder";
  try {
    const { workspaceId, studentUserId } = await seedWorkspaceAndUsers(t);
    const student = t.withIdentity({ subject: studentUserId });
    const result = await student.mutation(api.workspaces.createWorkspaceExport, {
      workspaceId,
      userId: studentUserId,
      format: "csv",
      scope: "images",
    });
    expect(result.errorMessage).toMatch(/Unsupported export/i);

    const row = await t.run(async (ctx) => ctx.db.get(result.exportId));
    expect(row?.status).toBe("failed");
  } finally {
    clearTriggerCredentials();
  }
});

test("HTTP /workspace/export/data with scope=links returns links and no notes/images", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = HTTP_KEY;
  const { workspaceId } = await seedWorkspaceAndUsers(t);

  await t.run(async (ctx) => {
    await ctx.db.insert("workspaceLinks", {
      workspaceId: workspaceId as any,
      url: "https://example.com/older",
      title: "Older link",
      createdBy: "user_export_student",
    });
    await ctx.db.insert("workspaceLinks", {
      workspaceId: workspaceId as any,
      url: "https://example.com/newer",
      title: "Newer link",
      createdBy: "user_export_student",
    });
    await ctx.db.insert("workspaceLinks", {
      workspaceId: workspaceId as any,
      url: "https://example.com/deleted",
      title: "Deleted link",
      createdBy: "user_export_student",
      deletedAt: Date.now(),
    });
    await ctx.db.insert("workspaceNotes", {
      workspaceId: workspaceId as any,
      title: "Should not be exported",
      content: "note body",
      createdBy: "user_export_student",
      updatedAt: Date.now(),
    });
  });

  const r = await t.fetch("/workspace/export/data", {
    method: "POST",
    headers: bearerHeaders(HTTP_KEY),
    body: JSON.stringify({ workspaceId, scope: "links" }),
  });
  expect(r.status).toBe(200);

  const body = await r.json();
  expect(body.notes).toBeUndefined();
  expect(body.images).toBeUndefined();
  expect(body.links.map((l: { title: string }) => l.title)).toEqual([
    "Newer link",
    "Older link",
  ]);
  // Deleted links never reach the CSV.
  expect(
    body.links.some((l: { title: string }) => l.title === "Deleted link")
  ).toBe(false);
});

test("HTTP /workspace/export/data returns the b2Key for B2-backed images", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = HTTP_KEY;
  const { workspaceId } = await seedWorkspaceAndUsers(t);

  await t.run(async (ctx) => {
    await ctx.db.insert("workspaceImages", {
      workspaceId: workspaceId as any,
      imageUrl: "",
      b2Key: "2026-01-01/workspaces/ws/file-1/sketch.png",
      createdBy: "user_export_student",
    });
  });

  const r = await t.fetch("/workspace/export/data", {
    method: "POST",
    headers: bearerHeaders(HTTP_KEY),
    body: JSON.stringify({ workspaceId, scope: "images" }),
  });
  expect(r.status).toBe(200);

  const body = await r.json();
  expect(body.images.length).toBe(1);
  // The trigger reads the object directly; no signed URL is minted.
  expect(body.images[0].b2Key).toBe("2026-01-01/workspaces/ws/file-1/sketch.png");
  expect(body.images[0].imageUrl).toBe("");
  expect(body.images[0].fileName).toBe("sketch.png");
});

// ---------------------------------------------------------------------------
// Trigger hand-off: network I/O must happen in an action, not a mutation
// ---------------------------------------------------------------------------

test("createWorkspaceExport schedules the trigger action instead of fetching in the mutation", async () => {
  const t = convexTest(schema, modules);
  process.env.TRIGGER_SECRET_KEY = "trig_placeholder";
  try {
    const { workspaceId, studentUserId } = await seedWorkspaceAndUsers(t);
    const student = t.withIdentity({ subject: studentUserId });

    const { exportId } = await student.mutation(api.workspaces.createWorkspaceExport, {
      workspaceId,
      userId: studentUserId,
      format: "csv",
      scope: "links",
    });

    const scheduled = await t.run(async (ctx) =>
      ctx.db.system.query("_scheduled_functions").collect()
    );
    const entries = scheduled.filter((entry) =>
      /triggerWorkspaceExportTask/i.test(entry.name)
    );
    expect(entries.length).toBe(1);
    expect(JSON.stringify(entries[0].args)).toContain("process-workspace-links-export");
    expect(JSON.stringify(entries[0].args)).toContain(exportId);
  } finally {
    clearTriggerCredentials();
  }
});

test("triggerWorkspaceExportTask marks the row failed when Trigger.dev rejects the request", async () => {
  const t = convexTest(schema, modules);
  process.env.TRIGGER_SECRET_KEY = "trig_placeholder";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response("nope", { status: 503 })) as typeof fetch;

  try {
    const { workspaceId, studentUserId } = await seedWorkspaceAndUsers(t);
    const exportId = await t.run(async (ctx) =>
      ctx.db.insert("workspaceExports", {
        workspaceId: workspaceId as any,
        userId: studentUserId,
        format: "zip",
        scope: "images",
        status: "pending",
      })
    );

    await t.action(internal.exportActions.triggerWorkspaceExportTask, {
      exportId,
      workspaceId: workspaceId as any,
      taskName: "process-workspace-export",
      scope: "images",
    });

    const row = await t.run(async (ctx) => ctx.db.get(exportId));
    expect(row?.status).toBe("failed");
    expect(row?.errorMessage).toMatch(/Trigger\.dev request failed: 503/);
  } finally {
    globalThis.fetch = originalFetch;
    clearTriggerCredentials();
  }
});

test("getWorkspaceExports filters by scope so each tab keeps its own latest rows", async () => {
  const t = convexTest(schema, modules);
  const { workspaceId, studentUserId } = await seedWorkspaceAndUsers(t);

  await t.run(async (ctx) => {
    // Eleven newer Links exports: without server-side scoping these
    // would push the Images ZIP out of the shared 10-row window.
    for (let i = 0; i < 11; i++) {
      await ctx.db.insert("workspaceExports", {
        workspaceId: workspaceId as any,
        userId: studentUserId,
        format: "csv",
        scope: "links",
        status: "completed",
      });
    }
    await ctx.db.insert("workspaceExports", {
      workspaceId: workspaceId as any,
      userId: studentUserId,
      format: "zip",
      scope: "images",
      status: "completed",
      downloadUrl: "https://b2.example.com/images.zip",
    });
    // Legacy row (no scope) — should count as the Images tab's history.
    await ctx.db.insert("workspaceExports", {
      workspaceId: workspaceId as any,
      userId: studentUserId,
      format: "zip",
      status: "completed",
    });
  });

  const student = t.withIdentity({ subject: studentUserId });
  const images = await student.query(api.workspaces.getWorkspaceExports, {
    workspaceId,
    scope: "images",
  });
  expect(images.map((row) => row.scope ?? "legacy")).toEqual(["legacy", "images"]);

  const links = await student.query(api.workspaces.getWorkspaceExports, {
    workspaceId,
    scope: "links",
  });
  expect(links.length).toBe(10);
  expect(links.every((row) => row.scope === "links")).toBe(true);
});

test("HTTP /workspace/export/data drops untrusted legacy imageUrl values (no SSRF)", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = HTTP_KEY;
  const { workspaceId } = await seedWorkspaceAndUsers(t);

  const trustedDataUri = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";
  await t.run(async (ctx) => {
    // A legacy row (no storageId / b2Key) whose URL points at an
    // internal address. The export worker must never fetch it.
    await ctx.db.insert("workspaceImages", {
      workspaceId: workspaceId as any,
      imageUrl: "http://169.254.169.254/latest/meta-data/iam/security-credentials/",
      createdBy: "user_export_student",
    });
    // A legitimate inline payload survives.
    await ctx.db.insert("workspaceImages", {
      workspaceId: workspaceId as any,
      imageUrl: trustedDataUri,
      createdBy: "user_export_student",
    });
  });

  const r = await t.fetch("/workspace/export/data", {
    method: "POST",
    headers: bearerHeaders(HTTP_KEY),
    body: JSON.stringify({ workspaceId, scope: "images" }),
  });
  expect(r.status).toBe(200);

  const body = await r.json();
  const untrusted = body.images.find(
    (img: { imageUrl: string }) => img.imageUrl === ""
  );
  const trusted = body.images.find(
    (img: { imageUrl: string }) => img.imageUrl === trustedDataUri
  );
  expect(untrusted).toBeTruthy();
  expect(trusted).toBeTruthy();
  expect(
    body.images.some((img: { imageUrl: string }) =>
      img.imageUrl.includes("169.254.169.254")
    )
  ).toBe(false);
});

test("a cancel is terminal even when the row still carries an earlier task error", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = HTTP_KEY;
  const { workspaceId, studentUserId } = await seedWorkspaceAndUsers(t);

  // Simulates a retried task: the first attempt recorded an error, so
  // `errorMessage` is populated, and the row is failed.
  const exportId = await t.run(async (ctx) =>
    ctx.db.insert("workspaceExports", {
      workspaceId: workspaceId as any,
      userId: studentUserId,
      format: "zip",
      scope: "images",
      status: "failed",
      errorMessage: "transient B2 error",
    })
  );

  const student = t.withIdentity({ subject: studentUserId });
  await student.mutation(api.workspaces.cancelWorkspaceExport, { id: exportId });

  const cancelled = await t.run(async (ctx) => ctx.db.get(exportId));
  expect(cancelled?.cancelledAt).toBeTypeOf("number");
  expect(cancelled?.status).toBe("failed");
  // The earlier message is preserved for diagnostics.
  expect(cancelled?.errorMessage).toBe("transient B2 error");

  // The retry's completion update must be refused.
  const r = await t.fetch("/workspace/export/update-status", {
    method: "POST",
    headers: bearerHeaders(HTTP_KEY),
    body: JSON.stringify({ exportId, status: "completed" }),
  });
  expect(r.status).toBe(500);
  const body = await r.json();
  expect(body.error).toMatch(/cancelled/i);

  const after = await t.run(async (ctx) => ctx.db.get(exportId));
  expect(after?.status).toBe("failed");
});
