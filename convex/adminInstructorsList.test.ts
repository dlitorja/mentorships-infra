/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const ADMIN = "user_admin_instructor_list";

/**
 * The admin roster used to fetch at most 100 rows from Convex with no paging,
 * and the page filtered/searched only what it had loaded. These tests pin the
 * server-side selection the list now relies on: status filters, search, paging,
 * and a total that matches the list.
 */
async function seed() {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: ADMIN,
      clerkId: ADMIN,
      email: "admin@example.com",
      role: "admin",
    });

    const instructors = [
      { name: "Active One", email: "active1@example.com", slug: "active-one", isActive: true },
      { name: "Active Two", email: "active2@example.com", slug: "active-two", isActive: true },
      { name: "Inactive One", email: "inactive@example.com", slug: "inactive-one", isActive: false },
      { name: "Deleted One", email: "deleted@example.com", slug: "deleted-one", isActive: true },
      { name: "Hidden Specialty", email: "specialty@example.com", slug: "specialty", isActive: true },
    ];
    // Inserted in order, so `_creationTime` (and therefore paging) is stable.
    for (const instructor of instructors) {
      const id = await ctx.db.insert("instructors", instructor);
      if (instructor.name === "Deleted One") {
        await ctx.db.patch(id, { deletedAt: Date.now() });
      }
      if (instructor.name === "Hidden Specialty") {
        await ctx.db.patch(id, { specialties: ["Concept Art"] });
      }
    }
  });
  return t;
}

test("status filters select the right rows and exclude deleted by default", async () => {
  const t = await seed();
  const asAdmin = t.withIdentity({ subject: ADMIN });

  const active = await asAdmin.query(api.instructors.getInstructorsForAdmin, { status: "active" });
  expect(active.map((i) => i.name)).toEqual(["Active One", "Active Two", "Hidden Specialty"]);

  const inactive = await asAdmin.query(api.instructors.getInstructorsForAdmin, { status: "inactive" });
  expect(inactive.map((i) => i.name)).toEqual(["Inactive One"]);

  const deleted = await asAdmin.query(api.instructors.getInstructorsForAdmin, { status: "deleted" });
  expect(deleted.map((i) => i.name)).toEqual(["Deleted One"]);

  // No status keeps the historical "everything not deleted" behaviour, which the
  // edit form's instructor dropdown depends on.
  const unfiltered = await asAdmin.query(api.instructors.getInstructorsForAdmin, {});
  expect(unfiltered.map((i) => i.name)).toEqual([
    "Active One",
    "Active Two",
    "Inactive One",
    "Hidden Specialty",
  ]);
});

test("search matches name, email, slug and specialties", async () => {
  const t = await seed();
  const asAdmin = t.withIdentity({ subject: ADMIN });

  for (const [term, expected] of [
    ["inactive", ["Inactive One"]],
    ["active2@example.com", ["Active Two"]],
    ["deleted-on", ["Deleted One"]],
    ["concept art", ["Hidden Specialty"]],
  ] as const) {
    const result = await asAdmin.query(api.instructors.getInstructorsForAdmin, {
      status: "all",
      search: term,
    });
    expect(result.map((i) => i.name)).toEqual([...expected]);
  }
});

test("paging returns distinct slices and the count matches the filtered set", async () => {
  const t = await seed();
  const asAdmin = t.withIdentity({ subject: ADMIN });

  const first = await asAdmin.query(api.instructors.getInstructorsForAdmin, {
    status: "all",
    limit: 2,
    offset: 0,
  });
  const second = await asAdmin.query(api.instructors.getInstructorsForAdmin, {
    status: "all",
    limit: 2,
    offset: 2,
  });

  expect(first.map((i) => i.name)).toEqual(["Active One", "Active Two"]);
  expect(second.map((i) => i.name)).toEqual(["Inactive One", "Deleted One"]);

  const { total } = await asAdmin.query(api.instructors.countInstructorsForAdmin, { status: "all" });
  expect(total).toBe(5);

  const deletedOnly = await asAdmin.query(api.instructors.countInstructorsForAdmin, {
    status: "all",
    search: "deleted",
  });
  expect(deletedOnly.total).toBe(1);
});

test("the roster query is admin-only", async () => {
  const t = await seed();
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: "user_student",
      clerkId: "user_student",
      email: "student@example.com",
      role: "student",
    });
  });

  await expect(
    t.withIdentity({ subject: "user_student" }).query(api.instructors.getInstructorsForAdmin, {})
  ).rejects.toThrow(/Forbidden/);
});
