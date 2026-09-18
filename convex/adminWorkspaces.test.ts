/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

test("adminWorkspaces.getAllWorkspaces: returns paginated workspaces for admin", async () => {
  const t = convexTest({ schema, modules });

  const adminUserId = "user_admin_test";
  const studentUserId = "user_student_test";
  const instructorUserId = "user_instructor_test";

  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: adminUserId,
      clerkId: adminUserId,
      email: "admin@example.com",
      firstName: "Admin",
      lastName: "User",
      role: "admin",
    });
    await ctx.db.insert("users", {
      userId: studentUserId,
      clerkId: studentUserId,
      email: "student@example.com",
      firstName: "Stu",
      lastName: "Dent",
      role: "student",
    });
    await ctx.db.insert("users", {
      userId: instructorUserId,
      clerkId: instructorUserId,
      email: "instructor@example.com",
      firstName: "Alice",
      lastName: "Artist",
      role: "instructor",
    });
    const instructorId = await ctx.db.insert("instructors", {
      userId: instructorUserId,
      email: "instructor@example.com",
      name: "Alice Artist",
    });
    await ctx.db.insert("workspaces", {
      name: "Workspace 1",
      ownerId: studentUserId,
      instructorId,
      isPublic: false,
      studentImageCount: 0,
      instructorImageCount: 0,
    });
    await ctx.db.insert("workspaces", {
      name: "Workspace 2",
      ownerId: studentUserId,
      isPublic: true,
      studentImageCount: 5,
      instructorImageCount: 0,
    });
  });

  // Admin can list all workspaces
  const result = await t
    .withIdentity({ subject: adminUserId })
    .query(api.adminWorkspaces.getAllWorkspaces, {
      paginationOpts: { numItems: 20, cursor: null },
    });

  expect(result.page.length).toBe(2);
  expect(result.page[0].owner?.email).toBe("student@example.com");
});

test("adminWorkspaces.getAllWorkspaces: excludes deleted workspaces without throwing", async () => {
  // Regression: previously a while loop called .paginate() a second
  // time when filtered page was short, which throws
  // "Only a single paginated query (`.paginate()`) is allowed per
  // function execution" on the deployed backend. See PR fix.
  const t = convexTest({ schema, modules });

  const adminUserId = "user_admin_test";
  const studentUserId = "user_student_test";

  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: adminUserId,
      clerkId: adminUserId,
      email: "admin@example.com",
      role: "admin",
    });
    await ctx.db.insert("users", {
      userId: studentUserId,
      clerkId: studentUserId,
      email: "student@example.com",
      role: "student",
    });
    // Live workspaces first, then a large block of deleted ones.
    // The first page should return the live workspaces (filtered out
    // the deleted ones); the next page should contain only deleted
    // workspaces, which we filter out, and we should not throw.
    await ctx.db.insert("workspaces", {
      name: "Live 1",
      ownerId: studentUserId,
      isPublic: false,
      studentImageCount: 0,
      instructorImageCount: 0,
    });
    await ctx.db.insert("workspaces", {
      name: "Live 2",
      ownerId: studentUserId,
      isPublic: true,
      studentImageCount: 5,
      instructorImageCount: 0,
    });
    for (let i = 0; i < 25; i++) {
      await ctx.db.insert("workspaces", {
        name: `Deleted ${i}`,
        ownerId: studentUserId,
        isPublic: false,
        studentImageCount: 0,
        instructorImageCount: 0,
        deletedAt: Date.now(),
      });
    }
  });

  // Drain all pages. The point of this test is that we can paginate
  // through a mix of live and deleted workspaces without throwing
  // the single-paginate error.
  const seenNames: string[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const next = await t
      .withIdentity({ subject: adminUserId })
      .query(api.adminWorkspaces.getAllWorkspaces, {
        paginationOpts: { numItems: 20, cursor },
      });
    seenNames.push(...next.page.map((w) => w.name));
    cursor = next.continueCursor;
    pages++;
    if (next.isDone) break;
  } while (cursor && pages < 20);

  // The 2 live workspaces should be returned across all pages; deleted
  // ones are filtered out by the query itself.
  expect(seenNames.sort()).toEqual(["Live 1", "Live 2"]);
});

test("adminWorkspaces.getAllWorkspaces: filters by type", async () => {
  const t = convexTest({ schema, modules });

  const adminUserId = "user_admin_test";
  const studentUserId = "user_student_test";

  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: adminUserId,
      clerkId: adminUserId,
      email: "admin@example.com",
      role: "admin",
    });
    await ctx.db.insert("users", {
      userId: studentUserId,
      clerkId: studentUserId,
      email: "student@example.com",
      role: "student",
    });
    await ctx.db.insert("workspaces", {
      name: "Mentorship 1",
      ownerId: studentUserId,
      isPublic: false,
      studentImageCount: 0,
      instructorImageCount: 0,
      type: "mentorship",
    });
    await ctx.db.insert("workspaces", {
      name: "Admin-Student 1",
      ownerId: studentUserId,
      isPublic: false,
      studentImageCount: 0,
      instructorImageCount: 0,
      type: "admin_student",
    });
  });

  const mentorship = await t
    .withIdentity({ subject: adminUserId })
    .query(api.adminWorkspaces.getAllWorkspaces, {
      paginationOpts: { numItems: 20, cursor: null },
      type: "mentorship",
    });
  expect(mentorship.page.length).toBe(1);
  expect(mentorship.page[0].name).toBe("Mentorship 1");
  expect(mentorship.page[0].type).toBe("mentorship");

  const adminStudent = await t
    .withIdentity({ subject: adminUserId })
    .query(api.adminWorkspaces.getAllWorkspaces, {
      paginationOpts: { numItems: 20, cursor: null },
      type: "admin_student",
    });
  expect(adminStudent.page.length).toBe(1);
  expect(adminStudent.page[0].name).toBe("Admin-Student 1");
});

test("adminWorkspaces.getAllWorkspaces: rejects non-admin", async () => {
  const t = convexTest({ schema, modules });
  const studentUserId = "user_student_test";

  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: studentUserId,
      clerkId: studentUserId,
      email: "student@example.com",
      role: "student",
    });
    await ctx.db.insert("workspaces", {
      name: "W",
      ownerId: studentUserId,
      isPublic: false,
      studentImageCount: 0,
      instructorImageCount: 0,
    });
  });

  await expect(
    t
      .withIdentity({ subject: studentUserId })
      .query(api.adminWorkspaces.getAllWorkspaces, {
        paginationOpts: { numItems: 20, cursor: null },
      })
  ).rejects.toThrow("Admin access required");
});

test("adminWorkspaces.getAllWorkspaces: returns empty for anonymous", async () => {
  const t = convexTest({ schema, modules });

  const result = await t.query(api.adminWorkspaces.getAllWorkspaces, {
    paginationOpts: { numItems: 20, cursor: null },
  });
  expect(result.page).toEqual([]);
  expect(result.isDone).toBe(true);
});
