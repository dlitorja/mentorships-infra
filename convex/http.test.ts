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
