/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const HTTP_KEY = "test-http-key-artwork-export";

function bearerHeaders(key: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${key}`,
  };
}

function clearTriggerCredentials(): void {
  delete process.env.TRIGGER_SECRET_KEY;
  delete process.env.TRIGGER_API_KEY;
}

type Seed = {
  onboardingId: string;
  instructorRowId: string;
  instructorUserId: string;
  studentUserId: string;
};

/**
 * One onboarding row with an assigned student, one assigned instructor
 * (linked through `instructors.userId`), and two active work examples
 * plus one pending row that exports must ignore.
 */
async function seedOnboarding(
  t: ReturnType<typeof convexTest>,
  overrides: { withArtwork?: boolean } = {}
): Promise<Seed> {
  const { withArtwork = true } = overrides;
  const instructorUserId = "user_artwork_instructor";
  const studentUserId = "user_artwork_student";

  let onboardingId = "";
  let instructorRowId = "";

  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: instructorUserId,
      clerkId: instructorUserId,
      email: "artwork-instructor@example.com",
      role: "instructor",
    });
    await ctx.db.insert("users", {
      userId: studentUserId,
      clerkId: studentUserId,
      email: "artwork-student@example.com",
      role: "student",
    });

    instructorRowId = await ctx.db.insert("instructors", {
      userId: instructorUserId,
      email: "artwork-instructor@example.com",
      name: "Artwork Instructor",
      slug: "artwork-instructor",
      isActive: true,
      isNew: false,
      oneOnOneInventory: 0,
      groupInventory: 0,
      maxActiveStudents: 10,
    });

    onboardingId = await ctx.db.insert("adminOnboardings", {
      email: "artwork-student@example.com",
      flowVersion: 1,
      source: "manual",
      submittedByUserId: "user_submitter",
      status: "completed",
      attemptCount: 1,
      assignedStudentClerkId: studentUserId,
      perInstructor: [
        { instructorId: instructorRowId, isRenewal: false, sessionsPerInstructor: 4 },
      ],
      timeline: [],
      isSeparateStudentRecord: false,
      existingWorkspaceIds: [],
      createdAt: Date.now(),
    });

    if (withArtwork) {
      await ctx.db.insert("onboardingWorkExamples", {
        onboardingId,
        studentClerkId: studentUserId,
        b2Key: `onboarding/${onboardingId}/file-1/first.jpg`,
        fileName: "first.jpg",
        contentType: "image/jpeg",
        size: 1024,
        status: "active",
        uploadedAt: 1,
        fileId: "file-1",
      });
      await ctx.db.insert("onboardingWorkExamples", {
        onboardingId,
        studentClerkId: studentUserId,
        b2Key: `onboarding/${onboardingId}/file-2/second.png`,
        fileName: "second.png",
        contentType: "image/png",
        size: 2048,
        status: "active",
        uploadedAt: 2,
        fileId: "file-2",
      });
      // Pending rows are in-flight uploads and must never appear in an
      // export.
      await ctx.db.insert("onboardingWorkExamples", {
        onboardingId,
        studentClerkId: studentUserId,
        b2Key: `onboarding/${onboardingId}/file-3/pending.jpg`,
        fileName: "pending.jpg",
        contentType: "image/jpeg",
        size: 4096,
        status: "pending",
        uploadedAt: 3,
        fileId: "file-3",
      });
    }
  });

  return { onboardingId, instructorRowId, instructorUserId, studentUserId };
}

test("createOnboardingArtworkExport inserts a row for an assigned instructor", async () => {
  const t = convexTest(schema, modules);
  clearTriggerCredentials();
  const { onboardingId, instructorUserId } = await seedOnboarding(t);

  const instructor = t.withIdentity({ subject: instructorUserId });
  const result = await instructor.mutation(
    api.onboardingArtworkExports.createOnboardingArtworkExport,
    { onboardingId: onboardingId as any }
  );

  // Missing trigger credentials is surfaced as a failed row rather
  // than a silent "pending" that polls forever.
  expect(result.errorMessage).toBeTruthy();

  const rows = await t.run(async (ctx) =>
    ctx.db.query("onboardingArtworkExports").collect()
  );
  expect(rows.length).toBe(1);
  expect(rows[0].requestedBy).toBe(instructorUserId);
  expect(rows[0].status).toBe("failed");
});

test("createOnboardingArtworkExport lets the assigned student export their own artwork", async () => {
  const t = convexTest(schema, modules);
  clearTriggerCredentials();
  const { onboardingId, studentUserId } = await seedOnboarding(t);

  const student = t.withIdentity({ subject: studentUserId });
  await student.mutation(
    api.onboardingArtworkExports.createOnboardingArtworkExport,
    { onboardingId: onboardingId as any }
  );
  const rows = await t.run(async (ctx) =>
    ctx.db.query("onboardingArtworkExports").collect()
  );
  expect(rows.length).toBe(1);
  expect(rows[0].requestedBy).toBe(studentUserId);
});

test("createOnboardingArtworkExport rejects an unrelated authenticated user", async () => {
  const t = convexTest(schema, modules);
  clearTriggerCredentials();
  const { onboardingId } = await seedOnboarding(t);

  const stranger = t.withIdentity({ subject: "user_someone_else" });
  await expect(
    stranger.mutation(api.onboardingArtworkExports.createOnboardingArtworkExport, {
      onboardingId: onboardingId as any,
    })
  ).rejects.toThrow(/Not authorized/);
});

test("createOnboardingArtworkExport rejects an unauthenticated caller", async () => {
  const t = convexTest(schema, modules);
  const { onboardingId } = await seedOnboarding(t);

  await expect(
    t.mutation(api.onboardingArtworkExports.createOnboardingArtworkExport, {
      onboardingId: onboardingId as any,
    })
  ).rejects.toThrow(/Unauthorized/);
});

test("createOnboardingArtworkExport refuses when there is no active artwork", async () => {
  const t = convexTest(schema, modules);
  clearTriggerCredentials();
  const { onboardingId, instructorUserId } = await seedOnboarding(t, {
    withArtwork: false,
  });

  const instructor = t.withIdentity({ subject: instructorUserId });
  await expect(
    instructor.mutation(
      api.onboardingArtworkExports.createOnboardingArtworkExport,
      { onboardingId: onboardingId as any }
    )
  ).rejects.toThrow(/no uploaded artwork/i);
});

test("getOnboardingArtworkExports returns rows to a viewer and [] to a stranger", async () => {
  const t = convexTest(schema, modules);
  clearTriggerCredentials();
  const { onboardingId, instructorUserId, studentUserId } = await seedOnboarding(t);

  const instructor = t.withIdentity({ subject: instructorUserId });
  await instructor.mutation(
    api.onboardingArtworkExports.createOnboardingArtworkExport,
    { onboardingId: onboardingId as any }
  );

  const visible = await instructor.query(
    api.onboardingArtworkExports.getOnboardingArtworkExports,
    { onboardingId: onboardingId as any }
  );
  expect(visible.length).toBe(1);

  const stranger = t.withIdentity({ subject: "user_stranger_export_list" });
  const hidden = await stranger.query(
    api.onboardingArtworkExports.getOnboardingArtworkExports,
    { onboardingId: onboardingId as any }
  );
  expect(hidden).toEqual([]);

  // An unauthenticated caller also sees nothing.
  const anonymous = await t.query(
    api.onboardingArtworkExports.getOnboardingArtworkExports,
    { onboardingId: onboardingId as any }
  );
  expect(anonymous).toEqual([]);
  expect(studentUserId).toBeTruthy();
});

test("cancelOnboardingArtworkExport marks a row failed with no errorMessage", async () => {
  const t = convexTest(schema, modules);
  const { onboardingId, instructorUserId } = await seedOnboarding(t);

  const exportId = await t.run(async (ctx) =>
    ctx.db.insert("onboardingArtworkExports", {
      onboardingId: onboardingId as any,
      requestedBy: instructorUserId,
      status: "processing",
    })
  );

  const instructor = t.withIdentity({ subject: instructorUserId });
  await instructor.mutation(api.onboardingArtworkExports.cancelOnboardingArtworkExport, {
    id: exportId,
  });

  const row = await t.run(async (ctx) => ctx.db.get(exportId));
  expect(row?.status).toBe("failed");
  // No errorMessage distinguishes a user cancel from a task failure.
  expect(row?.errorMessage).toBeUndefined();
});

test("cancelOnboardingArtworkExport rejects an unrelated user", async () => {
  const t = convexTest(schema, modules);
  const { onboardingId, instructorUserId } = await seedOnboarding(t);

  const exportId = await t.run(async (ctx) =>
    ctx.db.insert("onboardingArtworkExports", {
      onboardingId: onboardingId as any,
      requestedBy: instructorUserId,
      status: "processing",
    })
  );

  const stranger = t.withIdentity({ subject: "user_stranger_cancel_export" });
  await expect(
    stranger.mutation(api.onboardingArtworkExports.cancelOnboardingArtworkExport, {
      id: exportId,
    })
  ).rejects.toThrow(/Not authorized/);
});

test("HTTP /onboarding/artwork-export/data returns only active files, sorted by upload time", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = HTTP_KEY;
  const { onboardingId } = await seedOnboarding(t);

  const r = await t.fetch("/onboarding/artwork-export/data", {
    method: "POST",
    headers: bearerHeaders(HTTP_KEY),
    body: JSON.stringify({ onboardingId }),
  });
  expect(r.status).toBe(200);

  const body = await r.json();
  expect(body.studentEmail).toBe("artwork-student@example.com");
  expect(body.files.map((f: { fileName: string }) => f.fileName)).toEqual([
    "first.jpg",
    "second.png",
  ]);
  expect(body.files[0].b2Key).toContain("onboarding/");
});

test("HTTP /onboarding/artwork-export/data rejects an unauthenticated caller", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = HTTP_KEY;
  const { onboardingId } = await seedOnboarding(t);

  const r = await t.fetch("/onboarding/artwork-export/data", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ onboardingId }),
  });
  expect(r.status).toBe(401);
});

test("HTTP /onboarding/artwork-export/update-status writes completion fields", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = HTTP_KEY;
  const { onboardingId, instructorUserId } = await seedOnboarding(t);

  const exportId = await t.run(async (ctx) =>
    ctx.db.insert("onboardingArtworkExports", {
      onboardingId: onboardingId as any,
      requestedBy: instructorUserId,
      status: "pending",
    })
  );

  const r = await t.fetch("/onboarding/artwork-export/update-status", {
    method: "POST",
    headers: bearerHeaders(HTTP_KEY),
    body: JSON.stringify({
      exportId,
      status: "completed",
      downloadUrl: "https://b2.example.com/artwork.zip",
      expiresAt: Date.now() + 86_400_000,
      fileCount: 2,
    }),
  });
  expect(r.status).toBe(200);

  const row = await t.run(async (ctx) => ctx.db.get(exportId));
  expect(row?.status).toBe("completed");
  expect(row?.downloadUrl).toBe("https://b2.example.com/artwork.zip");
  expect(row?.fileCount).toBe(2);
});

test("HTTP /onboarding/artwork-export/update-status refuses to downgrade a completed export", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = HTTP_KEY;
  const { onboardingId, instructorUserId } = await seedOnboarding(t);

  const exportId = await t.run(async (ctx) =>
    ctx.db.insert("onboardingArtworkExports", {
      onboardingId: onboardingId as any,
      requestedBy: instructorUserId,
      status: "pending",
    })
  );

  await t.fetch("/onboarding/artwork-export/update-status", {
    method: "POST",
    headers: bearerHeaders(HTTP_KEY),
    body: JSON.stringify({ exportId, status: "completed" }),
  });

  const r = await t.fetch("/onboarding/artwork-export/update-status", {
    method: "POST",
    headers: bearerHeaders(HTTP_KEY),
    body: JSON.stringify({ exportId, status: "failed", errorMessage: "retried" }),
  });
  expect(r.status).toBe(500);
  const body = await r.json();
  expect(body.error).toMatch(/already completed/i);
});

test("createOnboardingArtworkExport schedules the trigger action (mutations cannot fetch)", async () => {
  const t = convexTest(schema, modules);
  process.env.TRIGGER_SECRET_KEY = "trig_placeholder";
  try {
    const { onboardingId, instructorUserId } = await seedOnboarding(t);
    const instructor = t.withIdentity({ subject: instructorUserId });

    const { exportId } = await instructor.mutation(
      api.onboardingArtworkExports.createOnboardingArtworkExport,
      { onboardingId: onboardingId as any }
    );

    const scheduled = await t.run(async (ctx) =>
      ctx.db.system.query("_scheduled_functions").collect()
    );
    const entries = scheduled.filter((entry) =>
      /triggerOnboardingArtworkExportTask/i.test(entry.name)
    );
    expect(entries.length).toBe(1);
    expect(JSON.stringify(entries[0].args)).toContain(exportId);
  } finally {
    clearTriggerCredentials();
  }
});

test("triggerOnboardingArtworkExportTask marks the row failed when Trigger.dev rejects the request", async () => {
  const t = convexTest(schema, modules);
  process.env.TRIGGER_SECRET_KEY = "trig_placeholder";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response("nope", { status: 500 })) as typeof fetch;

  try {
    const { onboardingId, instructorUserId } = await seedOnboarding(t);
    const exportId = await t.run(async (ctx) =>
      ctx.db.insert("onboardingArtworkExports", {
        onboardingId: onboardingId as any,
        requestedBy: instructorUserId,
        status: "pending",
      })
    );

    await t.action(internal.exportActions.triggerOnboardingArtworkExportTask, {
      exportId,
      onboardingId: onboardingId as any,
    });

    const row = await t.run(async (ctx) => ctx.db.get(exportId));
    expect(row?.status).toBe("failed");
    expect(row?.errorMessage).toMatch(/Trigger\.dev request failed: 500/);
  } finally {
    globalThis.fetch = originalFetch;
    clearTriggerCredentials();
  }
});
