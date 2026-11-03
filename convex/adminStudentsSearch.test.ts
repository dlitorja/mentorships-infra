/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const ADMIN_ID = "admin_students_search";
const CONVEX_STUDENT_ID = "user_convex_student";
const CLERK_ONLY_STUDENT_ID = "user_clerk_only_student";

async function seed(ctx: any) {
  await ctx.db.insert("users", {
    userId: ADMIN_ID,
    clerkId: ADMIN_ID,
    email: "admin@example.com",
    role: "admin",
  });
  await ctx.db.insert("users", {
    userId: CONVEX_STUDENT_ID,
    clerkId: CONVEX_STUDENT_ID,
    email: "convex@example.com",
    role: "student",
  });
  // CLERK_ONLY_STUDENT_ID intentionally has no `users` row: this is the
  // webhook-race state the Clerk fallback exists for.

  const instructorId = await ctx.db.insert("instructors", {
    userId: "instructor_user",
    name: "Instructor",
    slug: "instructor",
  });

  await ctx.db.insert("sessionPacks", {
    userId: CONVEX_STUDENT_ID,
    instructorId: instructorId as any,
    totalSessions: 4,
    remainingSessions: 2,
    status: "active",
    purchasedAt: Date.now(),
  });
  await ctx.db.insert("sessionPacks", {
    userId: CLERK_ONLY_STUDENT_ID,
    instructorId: instructorId as any,
    totalSessions: 2,
    remainingSessions: 1,
    status: "active",
    purchasedAt: Date.now(),
  });
}

test("getStudentsForAdmin: search still matches Convex users by email", async () => {
  const t = convexTest({ schema, modules });
  await t.run(seed);

  const result = await t
    .withIdentity({ subject: ADMIN_ID })
    .query(api.admin.getStudentsForAdmin, {
      search: "convex@example.com",
      page: 1,
      pageSize: 20,
    });

  expect(result.items.map((s) => s.userId)).toEqual([CONVEX_STUDENT_ID]);
  expect(result.items[0]?.email).toBe("convex@example.com");
});

test("getStudentsForAdmin: userIds allowlist returns a Clerk-only student", async () => {
  const t = convexTest({ schema, modules });
  await t.run(seed);

  const result = await t
    .withIdentity({ subject: ADMIN_ID })
    .query(api.admin.getStudentsForAdmin, {
      userIds: [CLERK_ONLY_STUDENT_ID],
      page: 1,
      pageSize: 20,
    });

  expect(result.items.map((s) => s.userId)).toEqual([CLERK_ONLY_STUDENT_ID]);
  // No Convex users row: the API route's enrichment fills the email.
  expect(result.items[0]?.email).toBeNull();
});

test("getStudentsForAdmin: userIds preserve the other filters", async () => {
  const t = convexTest({ schema, modules });
  await t.run(seed);

  const result = await t
    .withIdentity({ subject: ADMIN_ID })
    .query(api.admin.getStudentsForAdmin, {
      userIds: [CLERK_ONLY_STUDENT_ID],
      status: "refunded",
      page: 1,
      pageSize: 20,
    });

  expect(result.items).toEqual([]);
  expect(result.total).toBe(0);
});
