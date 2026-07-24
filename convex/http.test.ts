/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

/**
 * Smoke tests for the bearer-auth HTTP endpoints added in
 * `chore/secret-removal-low-risk`. Each endpoint:
 *   - Returns 401 without the bearer header
 *   - Returns 401 with a wrong bearer
 *   - Returns 200 with a valid bearer
 *   - Writes an audit log atomically with the data write (where
 *     applicable)
 *
 * The endpoints we test are:
 *   - POST /instructors/create-for-clerk-user
 *   - POST /instructors/deactivate-by-user-id
 *   - POST /users/set-role
 *   - POST /users/set-clerk-id
 */

function bearerHeaders(key: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${key}`,
  };
}

async function setupAdmin(t: ReturnType<typeof convexTest>) {
  const adminUserId = "user_admin_1";
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: adminUserId,
      email: "admin@example.com",
      clerkId: adminUserId,
      role: "admin",
    });
  });
  return adminUserId;
}

const VALID_KEY = "test-http-key";

test("http endpoints: 401 without Authorization header", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;

  const r1 = await t.fetch("/instructors/create-for-clerk-user", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: "user_x" }),
  });
  expect(r1.status).toBe(401);

  const r2 = await t.fetch("/users/set-role", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: "user_x", role: "instructor" }),
  });
  expect(r2.status).toBe(401);
});

test("http endpoints: 401 with wrong bearer", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;

  const r = await t.fetch("/instructors/deactivate-by-user-id", {
    method: "POST",
    headers: bearerHeaders("wrong-key"),
    body: JSON.stringify({ userId: "user_x" }),
  });
  expect(r.status).toBe(401);
});

test("http endpoints: 200 with valid bearer, body shape correct", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;

  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: "user_target",
      email: "target@example.com",
      clerkId: "user_target",
      role: "student",
    });
  });

  const r = await t.fetch("/instructors/create-for-clerk-user", {
    method: "POST",
    headers: bearerHeaders(VALID_KEY),
    body: JSON.stringify({
      userId: "user_target",
      name: "Alex Target",
      email: "target@example.com",
    }),
  });
  expect(r.status).toBe(200);
  const body = await r.json();
  expect(body).toMatchObject({ success: true });
  expect(body.instructorId).toBeDefined();
});

test("http /instructors/create-for-clerk-user: writes audit row atomically", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;
  await setupAdmin(t);

  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: "user_audit_target",
      email: "audit@example.com",
      clerkId: "user_audit_target",
      role: "student",
    });
  });

  const before = await t.run(async (ctx) => {
    return await ctx.db.query("auditLogs").collect();
  });
  expect(before.length).toBe(0);

  const r = await t.fetch("/instructors/create-for-clerk-user", {
    method: "POST",
    headers: bearerHeaders(VALID_KEY),
    body: JSON.stringify({ userId: "user_audit_target", name: "Audit" }),
  });
  expect(r.status).toBe(200);

  const after = await t.run(async (ctx) => {
    return await ctx.db.query("auditLogs").collect();
  });
  expect(after.length).toBeGreaterThan(0);
  expect(after[0].action).toBe("create_instructor_for_clerk_user");
});

test("http /instructors/deactivate-by-user-id: writes audit row", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;
  await setupAdmin(t);

  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: "user_deact",
      email: "deact@example.com",
      clerkId: "user_deact",
      role: "instructor",
    });
    await ctx.db.insert("instructors", {
      userId: "user_deact",
      slug: "deact-slug",
      name: "Deact",
      isActive: true,
      isNew: false,
      oneOnOneInventory: 0,
      groupInventory: 0,
      maxActiveStudents: 10,
    });
  });

  const r = await t.fetch("/instructors/deactivate-by-user-id", {
    method: "POST",
    headers: bearerHeaders(VALID_KEY),
    body: JSON.stringify({ userId: "user_deact" }),
  });
  expect(r.status).toBe(200);

  const instructor = await t.run(async (ctx) => {
    return await ctx.db.query("instructors").first();
  });
  expect(instructor?.isActive).toBe(false);

  const logs = await t.run(async (ctx) => {
    return await ctx.db.query("auditLogs").collect();
  });
  expect(logs.some((l: any) => l.action === "deactivate_instructor_by_user_id")).toBe(true);
});

test("http /users/set-role: writes audit row", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;
  await setupAdmin(t);

  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: "user_role",
      email: "role@example.com",
      clerkId: "user_role",
      role: "student",
    });
  });

  const r = await t.fetch("/users/set-role", {
    method: "POST",
    headers: bearerHeaders(VALID_KEY),
    body: JSON.stringify({ userId: "user_role", role: "instructor" }),
  });
  expect(r.status).toBe(200);

  const user = await t.run(async (ctx) => {
    return await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", "user_role"))
      .first();
  });
  expect(user?.role).toBe("instructor");

  const logs = await t.run(async (ctx) => {
    return await ctx.db.query("auditLogs").collect();
  });
  expect(logs.some((l: any) => l.action === "set_user_role_http")).toBe(true);
});

test("http /users/set-clerk-id: updates user", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;
  await setupAdmin(t);

  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: "user_clerk",
      email: "clerk@example.com",
      clerkId: "old-clerk",
      role: "student",
    });
  });

  const r = await t.fetch("/users/set-clerk-id", {
    method: "POST",
    headers: bearerHeaders(VALID_KEY),
    body: JSON.stringify({ userId: "user_clerk", clerkId: "new-clerk" }),
  });
  expect(r.status).toBe(200);

  const user = await t.run(async (ctx) => {
    return await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", "user_clerk"))
      .first();
  });
  expect(user?.clerkId).toBe("new-clerk");
});

test("http /users/set-role: invalid role returns 400", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;

  const r = await t.fetch("/users/set-role", {
    method: "POST",
    headers: bearerHeaders(VALID_KEY),
    body: JSON.stringify({ userId: "user_x", role: "god" }),
  });
  expect(r.status).toBe(400);
});

test("http /instructors/create-for-clerk-user: missing userId returns 400", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;

  const r = await t.fetch("/instructors/create-for-clerk-user", {
    method: "POST",
    headers: bearerHeaders(VALID_KEY),
    body: JSON.stringify({ name: "NoUser" }),
  });
  expect(r.status).toBe(400);
});

/**
 * PR B: bearer-auth HTTP endpoints for the admin-onboarding flow.
 * Each endpoint:
 *   - Returns 401 without the bearer header
 *   - Returns 200 with a valid bearer (happy path body shape)
 *
 * The endpoints we test are:
 *   - POST /admin-onboarding/get
 *   - POST /admin-onboarding/list
 *   - POST /admin-onboarding/instructor-contacts
 *   - POST /admin-onboarding/stale
 *   - POST /admin-onboarding/append-timeline
 *   - POST /admin-onboarding/mark-email-sent
 *   - POST /admin-onboarding/release-placeholder
 *   - POST /admin-onboarding/release-placeholder-batch
 */

async function seedAdminOnboardingRow(
  t: ReturnType<typeof convexTest>,
  email: string,
  status: "queued" | "processing" | "completed" | "failed" | "cancelled" = "processing",
  attemptCount = 1,
): Promise<{ onboardingId: string; instructorId: string }> {
  let onboardingId = "";
  let instructorId = "";
  await t.run(async (ctx) => {
    instructorId = await ctx.db.insert("instructors", {
      name: "Test Instructor",
      slug: "test-instructor",
      email: "instructor@example.com",
      isActive: true,
      isNew: false,
      oneOnOneInventory: 0,
      groupInventory: 0,
      maxActiveStudents: 10,
    });
    onboardingId = await ctx.db.insert("adminOnboardings", {
      email,
      flowVersion: 1,
      source: "manual",
      submittedByUserId: "user_submitter",
      status,
      attemptCount,
      perInstructor: [
        {
          instructorId: instructorId as any,
          isRenewal: false,
          sessionsPerInstructor: 4,
        },
      ],
      isSeparateStudentRecord: false,
      existingWorkspaceIds: [],
      timeline: [
        { at: Date.now(), event: "queued" },
      ],
      createdAt: Date.now(),
    });
  });
  return { onboardingId, instructorId };
}

test("http /admin-onboarding/get: 401 without bearer", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;
  const { onboardingId } = await seedAdminOnboardingRow(t, "aob-test-1@example.com");

  const r = await t.fetch("/admin-onboarding/get", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: onboardingId }),
  });
  expect(r.status).toBe(401);
});

test("http /admin-onboarding/get: 200 returns the row", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;
  const { onboardingId } = await seedAdminOnboardingRow(t, "aob-test-2@example.com");

  const r = await t.fetch("/admin-onboarding/get", {
    method: "POST",
    headers: bearerHeaders(VALID_KEY),
    body: JSON.stringify({ id: onboardingId }),
  });
  expect(r.status).toBe(200);
  const body = await r.json();
  expect(body?.email).toBe("aob-test-2@example.com");
});

test("http /admin-onboarding/list: 401 without bearer", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;
  await seedAdminOnboardingRow(t, "aob-list-1@example.com");

  const r = await t.fetch("/admin-onboarding/list", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  expect(r.status).toBe(401);
});

test("http /admin-onboarding/list: 200 returns the rows", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;
  await seedAdminOnboardingRow(t, "aob-list-2@example.com");

  const r = await t.fetch("/admin-onboarding/list", {
    method: "POST",
    headers: bearerHeaders(VALID_KEY),
    body: JSON.stringify({ status: "processing" }),
  });
  expect(r.status).toBe(200);
  const body = await r.json();
  expect(Array.isArray(body.rows)).toBe(true);
  expect(body.rows.some((row: any) => row.email === "aob-list-2@example.com")).toBe(true);
});

test("http /admin-onboarding/instructor-contacts: 401 without bearer", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;
  const { instructorId } = await seedAdminOnboardingRow(t, "aob-ic-1@example.com");

  const r = await t.fetch("/admin-onboarding/instructor-contacts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ instructorIds: [instructorId] }),
  });
  expect(r.status).toBe(401);
});

test("http /admin-onboarding/instructor-contacts: 200 returns contact map", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;
  const { instructorId } = await seedAdminOnboardingRow(t, "aob-ic-2@example.com");

  const r = await t.fetch("/admin-onboarding/instructor-contacts", {
    method: "POST",
    headers: bearerHeaders(VALID_KEY),
    body: JSON.stringify({ instructorIds: [instructorId] }),
  });
  expect(r.status).toBe(200);
  const body = await r.json();
  expect(body.contacts[instructorId]).toBeDefined();
  expect(body.contacts[instructorId].email).toBe("instructor@example.com");
  expect(body.contacts[instructorId].name).toBe("Test Instructor");
});

test("http /admin-onboarding/stale: 401 without bearer", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;
  await seedAdminOnboardingRow(t, "aob-stale-1@example.com", "completed");

  const r = await t.fetch("/admin-onboarding/stale", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cutoffMs: Date.now(), paginationOpts: { numItems: 10 } }),
  });
  expect(r.status).toBe(401);
});

test("http /admin-onboarding/stale: 200 returns page", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;
  await seedAdminOnboardingRow(t, "aob-stale-2@example.com", "completed");

  const r = await t.fetch("/admin-onboarding/stale", {
    method: "POST",
    headers: bearerHeaders(VALID_KEY),
    body: JSON.stringify({ cutoffMs: Date.now(), paginationOpts: { numItems: 10 } }),
  });
  expect(r.status).toBe(200);
  const body = await r.json();
  expect(Array.isArray(body.rows)).toBe(true);
});

test("http /admin-onboarding/append-timeline: 401 without bearer", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;
  const { onboardingId } = await seedAdminOnboardingRow(t, "aob-append-1@example.com");

  const r = await t.fetch("/admin-onboarding/append-timeline", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ onboardingId, event: "processing_started" }),
  });
  expect(r.status).toBe(401);
});

test("http /admin-onboarding/append-timeline: 200 appends entry", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;
  const { onboardingId } = await seedAdminOnboardingRow(t, "aob-append-2@example.com");

  const r = await t.fetch("/admin-onboarding/append-timeline", {
    method: "POST",
    headers: bearerHeaders(VALID_KEY),
    body: JSON.stringify({ onboardingId, event: "processing_started" }),
  });
  expect(r.status).toBe(200);
  const body = await r.json();
  expect(body.event).toBe("processing_started");

  const row = await t.run(async (ctx) => await ctx.db.get(onboardingId as any));
  expect(row?.timeline.some((e: any) => e.event === "processing_started")).toBe(true);
});

test("http /admin-onboarding/mark-email-sent: 401 without bearer", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;
  const { onboardingId } = await seedAdminOnboardingRow(t, "aob-mail-1@example.com");

  const r = await t.fetch("/admin-onboarding/mark-email-sent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      onboardingId,
      recipient: { kind: "student" },
    }),
  });
  expect(r.status).toBe(401);
});

test("http /admin-onboarding/mark-email-sent: 200 appends email_sent entry", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;
  const { onboardingId } = await seedAdminOnboardingRow(t, "aob-mail-2@example.com");

  const r = await t.fetch("/admin-onboarding/mark-email-sent", {
    method: "POST",
    headers: bearerHeaders(VALID_KEY),
    body: JSON.stringify({
      onboardingId,
      recipient: { kind: "student" },
    }),
  });
  expect(r.status).toBe(200);
  const body = await r.json();
  expect(body.event).toBe("email_sent");

  const row = await t.run(async (ctx) => await ctx.db.get(onboardingId as any));
  expect(row?.timeline.some((e: any) => e.event === "email_sent")).toBe(true);
});

test("http /admin-onboarding/release-placeholder: 401 without bearer", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;
  const { onboardingId } = await seedAdminOnboardingRow(t, "aob-rel-1@example.com", "completed");

  const r = await t.fetch("/admin-onboarding/release-placeholder", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ onboardingId }),
  });
  expect(r.status).toBe(401);
});

test("http /admin-onboarding/release-placeholder: 200 appends released entry", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;
  const { onboardingId } = await seedAdminOnboardingRow(t, "aob-rel-2@example.com", "completed");

  const r = await t.fetch("/admin-onboarding/release-placeholder", {
    method: "POST",
    headers: bearerHeaders(VALID_KEY),
    body: JSON.stringify({ onboardingId, details: "test-release" }),
  });
  expect(r.status).toBe(200);
  const body = await r.json();
  expect(body.releasedCount).toBeDefined();
  expect(body.skipped).toBeDefined();

  const row = await t.run(async (ctx) => await ctx.db.get(onboardingId as any));
  expect(row?.timeline.some((e: any) => e.event === "released")).toBe(true);
});

test("http /admin-onboarding/release-placeholder-batch: 401 without bearer", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;
  const { onboardingId } = await seedAdminOnboardingRow(t, "aob-batch-1@example.com", "completed");

  const r = await t.fetch("/admin-onboarding/release-placeholder-batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ onboardingIds: [onboardingId] }),
  });
  expect(r.status).toBe(401);
});

test("http /admin-onboarding/release-placeholder-batch: 200 returns aggregate counters", async () => {
  const t = convexTest(schema, modules);
  process.env.CONVEX_HTTP_KEY = VALID_KEY;
  const a = await seedAdminOnboardingRow(t, "aob-batch-2a@example.com", "completed");
  const b = await seedAdminOnboardingRow(t, "aob-batch-2b@example.com", "completed");

  const r = await t.fetch("/admin-onboarding/release-placeholder-batch", {
    method: "POST",
    headers: bearerHeaders(VALID_KEY),
    body: JSON.stringify({
      onboardingIds: [a.onboardingId, b.onboardingId],
      details: "test-batch-release",
    }),
  });
  expect(r.status).toBe(200);
  const body = await r.json();
  expect(body.onboardingsProcessed).toBeDefined();
  expect(Array.isArray(body.failedOnboardingIds)).toBe(true);
});
