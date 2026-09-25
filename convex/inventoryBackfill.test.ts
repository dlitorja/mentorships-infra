/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function seedInstructor(
  t: ReturnType<typeof convexTest>,
  fields: Partial<{
    name: string;
    slug: string;
    isListed: boolean;
    deletedAt: number | undefined;
    oneOnOneInventory: number | undefined;
    groupInventory: number | undefined;
  }>
): Promise<string> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("instructors", {
      name: fields.name ?? "Test Instructor",
      slug: fields.slug ?? "test-instructor",
      isListed: fields.isListed ?? true,
      deletedAt: fields.deletedAt,
      oneOnOneInventory: fields.oneOnOneInventory,
      groupInventory: fields.groupInventory,
      updatedAt: 1,
    });
  });
}

test("getPublicInventoryBySlug: returns inventory for a listed instructor", async () => {
  const t = convexTest({ schema, modules });
  await seedInstructor(t, {
    slug: "jordan-jardine",
    name: "Jordan Jardine",
    oneOnOneInventory: 3,
    groupInventory: 2,
  });

  const result = await t.query(api.instructors.getPublicInventoryBySlug, {
    slug: "jordan-jardine",
  });

  expect(result).not.toBeNull();
  expect(result?.slug).toBe("jordan-jardine");
  expect(result?.oneOnOneInventory).toBe(3);
  expect(result?.groupInventory).toBe(2);
});

test("getPublicInventoryBySlug: returns null when instructor is not found", async () => {
  const t = convexTest({ schema, modules });
  await seedInstructor(t, { slug: "jordan-jardine", name: "Jordan Jardine" });

  const result = await t.query(api.instructors.getPublicInventoryBySlug, {
    slug: "missing-instructor",
  });

  expect(result).toBeNull();
});

test("getPublicInventoryBySlug: returns null when instructor is unlisted", async () => {
  const t = convexTest({ schema, modules });
  await seedInstructor(t, {
    slug: "hidden-instructor",
    name: "Hidden Instructor",
    isListed: false,
    oneOnOneInventory: 5,
    groupInventory: 1,
  });

  const result = await t.query(api.instructors.getPublicInventoryBySlug, {
    slug: "hidden-instructor",
  });

  expect(result).toBeNull();
});

test("getPublicInventoryBySlug: returns null when instructor is soft-deleted", async () => {
  const t = convexTest({ schema, modules });
  await seedInstructor(t, {
    slug: "retired-instructor",
    name: "Retired Instructor",
    isListed: true,
    deletedAt: 1_700_000_000_000,
    oneOnOneInventory: 2,
  });

  const result = await t.query(api.instructors.getPublicInventoryBySlug, {
    slug: "retired-instructor",
  });

  expect(result).toBeNull();
});

test("getPublicInventoryBySlug: defaults missing inventory fields to 0", async () => {
  const t = convexTest({ schema, modules });
  await seedInstructor(t, {
    slug: "new-instructor",
    name: "New Instructor",
    oneOnOneInventory: undefined,
    groupInventory: undefined,
  });

  const result = await t.query(api.instructors.getPublicInventoryBySlug, {
    slug: "new-instructor",
  });

  expect(result).not.toBeNull();
  expect(result?.oneOnOneInventory).toBe(0);
  expect(result?.groupInventory).toBe(0);
});

test("internalGetInstructorBySlugForBackfill: returns unlisted instructors (visibility bypass)", async () => {
  const t = convexTest({ schema, modules });
  await seedInstructor(t, {
    slug: "hidden-instructor",
    name: "Hidden Instructor",
    isListed: false,
    oneOnOneInventory: 5,
  });

  const result = await t.query(
    internal.instructors.internalGetInstructorBySlugForBackfill,
    { slug: "hidden-instructor" }
  );

  // The public getInstructorBySlug would have returned null here.
  // The backfill variant deliberately bypasses visibility so the
  // Supabase baseline still seeds the Convex row.
  expect(result).not.toBeNull();
  expect(result?.slug).toBe("hidden-instructor");
  expect(result?.isListed).toBe(false);
});

test("internalBackfillInventory: patches fields when Convex value is undefined", async () => {
  const t = convexTest({ schema, modules });
  const instructorId = await seedInstructor(t, {
    slug: "fresh-instructor",
    name: "Fresh Instructor",
    oneOnOneInventory: undefined,
    groupInventory: undefined,
  });

  const result = await t.mutation(
    internal.instructors.internalBackfillInventory,
    {
      instructorId: instructorId as any,
      oneOnOneInventory: 5,
      groupInventory: 3,
    }
  );

  expect(result.patched).toEqual(
    expect.arrayContaining(["oneOnOneInventory", "groupInventory"])
  );
  expect(result.skipped).toEqual([]);

  const after = await t.query(
    internal.instructors.internalGetInstructorBySlugForBackfill,
    { slug: "fresh-instructor" }
  );
  expect(after?.oneOnOneInventory).toBe(5);
  expect(after?.groupInventory).toBe(3);
});

test("internalBackfillInventory: skips fields when Convex value is already non-zero", async () => {
  const t = convexTest({ schema, modules });
  const instructorId = await seedInstructor(t, {
    slug: "live-instructor",
    name: "Live Instructor",
    oneOnOneInventory: 2,
    groupInventory: 1,
  });

  // Without force, the backfill should NOT overwrite non-zero values
  // (a Kajabi purchase has already decremented these).
  const result = await t.mutation(
    internal.instructors.internalBackfillInventory,
    {
      instructorId: instructorId as any,
      oneOnOneInventory: 5,
      groupInventory: 3,
    }
  );

  expect(result.patched).toEqual([]);
  expect(result.skipped).toEqual(
    expect.arrayContaining(["oneOnOneInventory", "groupInventory"])
  );

  const after = await t.query(
    internal.instructors.internalGetInstructorBySlugForBackfill,
    { slug: "live-instructor" }
  );
  // Untouched: still the live values.
  expect(after?.oneOnOneInventory).toBe(2);
  expect(after?.groupInventory).toBe(1);
});

test("internalBackfillInventory: patches 0-valued fields (treated as untouched)", async () => {
  const t = convexTest({ schema, modules });
  const instructorId = await seedInstructor(t, {
    slug: "zero-instructor",
    name: "Zero Instructor",
    oneOnOneInventory: 0,
    groupInventory: 0,
  });

  // Convex defaults to 0 when no Kajabi write has touched the row yet.
  // The backfill should treat 0 as "untouched" and patch.
  const result = await t.mutation(
    internal.instructors.internalBackfillInventory,
    {
      instructorId: instructorId as any,
      oneOnOneInventory: 5,
      groupInventory: 3,
    }
  );

  expect(result.patched).toEqual(
    expect.arrayContaining(["oneOnOneInventory", "groupInventory"])
  );
  expect(result.skipped).toEqual([]);

  const after = await t.query(
    internal.instructors.internalGetInstructorBySlugForBackfill,
    { slug: "zero-instructor" }
  );
  expect(after?.oneOnOneInventory).toBe(5);
  expect(after?.groupInventory).toBe(3);
});

test("internalBackfillInventory: force=true overwrites non-zero values", async () => {
  const t = convexTest({ schema, modules });
  const instructorId = await seedInstructor(t, {
    slug: "forced-instructor",
    name: "Forced Instructor",
    oneOnOneInventory: 2,
    groupInventory: 1,
  });

  const result = await t.mutation(
    internal.instructors.internalBackfillInventory,
    {
      instructorId: instructorId as any,
      oneOnOneInventory: 5,
      groupInventory: 3,
      force: true,
    }
  );

  expect(result.patched).toEqual(
    expect.arrayContaining(["oneOnOneInventory", "groupInventory"])
  );
  expect(result.skipped).toEqual([]);

  const after = await t.query(
    internal.instructors.internalGetInstructorBySlugForBackfill,
    { slug: "forced-instructor" }
  );
  expect(after?.oneOnOneInventory).toBe(5);
  expect(after?.groupInventory).toBe(3);
});

test("internalBackfillInventory: handles partial updates (only one field supplied)", async () => {
  const t = convexTest({ schema, modules });
  const instructorId = await seedInstructor(t, {
    slug: "partial-instructor",
    name: "Partial Instructor",
    oneOnOneInventory: 0,
    groupInventory: 4,
  });

  // Caller only updates oneOnOneInventory; groupInventory is preserved.
  const result = await t.mutation(
    internal.instructors.internalBackfillInventory,
    {
      instructorId: instructorId as any,
      oneOnOneInventory: 7,
      // groupInventory intentionally omitted
    }
  );

  expect(result.patched).toEqual(["oneOnOneInventory"]);
  expect(result.skipped).toEqual([]);

  const after = await t.query(
    internal.instructors.internalGetInstructorBySlugForBackfill,
    { slug: "partial-instructor" }
  );
  expect(after?.oneOnOneInventory).toBe(7);
  expect(after?.groupInventory).toBe(4);
});
