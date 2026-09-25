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

test("getPublicInventoryBySlug: returns explicit 0 (not null) after a real write", async () => {
  // A Kajabi purchase can drive the field to 0. The route MUST
  // see 0 (not null) so it knows this is a live value and does
  // not fall back to a stale positive Supabase baseline.
  const t = convexTest({ schema, modules });
  await seedInstructor(t, {
    slug: "sold-out-instructor",
    name: "Sold Out Instructor",
    oneOnOneInventory: 0,
    groupInventory: 0,
  });

  const result = await t.query(api.instructors.getPublicInventoryBySlug, {
    slug: "sold-out-instructor",
  });

  expect(result).not.toBeNull();
  expect(result?.oneOnOneInventory).toBe(0);
  expect(result?.groupInventory).toBe(0);
});

test("getPublicInventoryBySlug: returns null for unset fields (pre-backfill signal)", async () => {
  // Pre-backfill: Convex fields are undefined. The route uses
  // `null` as the signal that the field is unset and should fall
  // back to Supabase, distinguishing it from a real 0 above.
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
  expect(result?.oneOnOneInventory).toBeNull();
  expect(result?.groupInventory).toBeNull();
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

test("getPublicInventoryBySlug: prefers the active row when slug has a soft-deleted duplicate", async () => {
  // Greptile P1 (round 8): the previous `.first()` lookup could
  // return the soft-deleted row, hiding the live instructor's
  // available inventory from the public page. The query now
  // mirrors the backfill's "active first" policy.
  const t = convexTest({ schema, modules });
  await t.run((ctx) =>
    ctx.db.insert("instructors", {
      slug: "shared-public-slug",
      name: "Shared Public Slug (deleted)",
      isListed: true,
      oneOnOneInventory: 99,
      groupInventory: 99,
      deletedAt: 1_700_000_000_000,
      updatedAt: 1_600_000_000_000,
    })
  );
  await seedInstructor(t, {
    slug: "shared-public-slug",
    name: "Shared Public Slug (active)",
    oneOnOneInventory: 4,
    groupInventory: 2,
  });

  const result = await t.query(api.instructors.getPublicInventoryBySlug, {
    slug: "shared-public-slug",
  });

  expect(result).not.toBeNull();
  expect(result?.slug).toBe("shared-public-slug");
  expect(result?.oneOnOneInventory).toBe(4);
  expect(result?.groupInventory).toBe(2);
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

test("internalBackfillInventory: patches undefined fields (never written)", async () => {
  const t = convexTest({ schema, modules });
  const instructorId = await seedInstructor(t, {
    slug: "untouched-instructor",
    name: "Untouched Instructor",
    // No Kajabi write has touched the row yet — fields are
    // undefined (NOT 0; see round 12 policy: 0 is a real value).
    oneOnOneInventory: undefined,
    groupInventory: undefined,
  });

  // The backfill should patch fields that were never written.
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
    { slug: "untouched-instructor" }
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
    oneOnOneInventory: undefined,
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

test("internalGetInstructorBySlugForBackfill: prefers the active row when slug has a soft-deleted duplicate", async () => {
  // Greptile P1: the previous .first() lookup could return the
  // soft-deleted row when a slug had both a deleted historical
  // instructor and an active replacement. The backfill would
  // then patch the WRONG instructor and report success.
  const t = convexTest({ schema, modules });
  const deletedId = await t.run((ctx) =>
    ctx.db.insert("instructors", {
      slug: "shared-slug",
      name: "Shared Slug (deleted)",
      isListed: true,
      oneOnOneInventory: 99,
      groupInventory: 99,
      deletedAt: 1_700_000_000_000,
      updatedAt: 1_600_000_000_000,
    })
  );
  await seedInstructor(t, {
    slug: "shared-slug",
    name: "Shared Slug (active)",
    oneOnOneInventory: undefined,
    groupInventory: undefined,
  });

  const resolved = await t.query(
    internal.instructors.internalGetInstructorBySlugForBackfill,
    { slug: "shared-slug" }
  );

  expect(resolved).not.toBeNull();
  expect(resolved?.name).toBe("Shared Slug (active)");
  // Confirm we did NOT return the deleted row's record id.
  expect(resolved?._id).not.toBe(deletedId);
});

test("internalGetInstructorBySlugForBackfill: returns null when only a soft-deleted row matches the slug", async () => {
  // If the only row at this slug is soft-deleted, the backfill
  // should report a not-found rather than corrupt a deleted
  // record. Operators can then decide whether to restore or
  // remap the slug.
  const t = convexTest({ schema, modules });
  await t.run((ctx) =>
    ctx.db.insert("instructors", {
      slug: "retired-only",
      name: "Retired Only",
      isListed: true,
      oneOnOneInventory: 1,
      groupInventory: 1,
      deletedAt: 1_700_000_000_000,
      updatedAt: 1_600_000_000_000,
    })
  );

  const resolved = await t.query(
    internal.instructors.internalGetInstructorBySlugForBackfill,
    { slug: "retired-only" }
  );

  expect(resolved).toBeNull();
});

test("internalGetInstructorBySlugForBackfill: prefers the listed row when slug has both listed + unlisted active rows", async () => {
  // Greptile P1 (round 9): the backfill must agree with the
  // public read about which active row owns the slug. If the
  // backfill picks the unlisted row while the public read
  // serves the listed row, the backfill would patch the wrong
  // instructor while reporting success.
  const t = convexTest({ schema, modules });
  await seedInstructor(t, {
    slug: "mixed-state",
    name: "Mixed State (unlisted)",
    isListed: false,
    oneOnOneInventory: undefined,
    groupInventory: undefined,
  });
  await seedInstructor(t, {
    slug: "mixed-state",
    name: "Mixed State (listed)",
    isListed: true,
    oneOnOneInventory: undefined,
    groupInventory: undefined,
  });

  const resolved = await t.query(
    internal.instructors.internalGetInstructorBySlugForBackfill,
    { slug: "mixed-state" }
  );

  expect(resolved).not.toBeNull();
  expect(resolved?.name).toBe("Mixed State (listed)");
  expect(resolved?.isListed).toBe(true);
});

test("internalBackfillInventory: treats already-matching values as no-op (not skipped)", async () => {
  // Greptile P2: an idempotent re-run where the Convex value
  // already equals the Supabase legacy value should be treated
  // as reconciled (neither patched nor skipped), so the backfill
  // script can count such rows as complete and not exit non-zero.
  const t = convexTest({ schema, modules });
  const instructorId = await seedInstructor(t, {
    slug: "reconciled-instructor",
    name: "Reconciled Instructor",
    oneOnOneInventory: 4,
    groupInventory: 7,
  });

  const result = await t.mutation(
    internal.instructors.internalBackfillInventory,
    {
      instructorId: instructorId as any,
      oneOnOneInventory: 4, // already equals Convex
      groupInventory: 7, // already equals Convex
    }
  );

  expect(result.patched).toEqual([]);
  expect(result.skipped).toEqual([]);
});

test("internalBackfillInventory: never overwrites a real sold-out zero", async () => {
  // Greptile P1 (round 12): if a Kajabi purchase decremented
  // Convex to 0, a later backfill would replace that real
  // zero with the stale Supabase legacy positive value,
  // advertising a sold-out offer as available on the public
  // page. The default path must treat `0` as a real value
  // and skip; only `force: true` should restore from Supabase.
  const t = convexTest({ schema, modules });
  const instructorId = await seedInstructor(t, {
    slug: "sold-out-via-kajabi",
    name: "Sold Out Via Kajabi",
    oneOnOneInventory: 0,
    groupInventory: 0,
  });

  const result = await t.mutation(
    internal.instructors.internalBackfillInventory,
    {
      instructorId: instructorId as any,
      oneOnOneInventory: 8,
      groupInventory: 4,
    }
  );

  expect(result.patched).toEqual([]);
  expect(result.skipped).toEqual([
    "oneOnOneInventory",
    "groupInventory",
  ]);

  // Confirm Convex still has the sold-out zeros.
  const after = await t.query(
    internal.instructors.internalGetInstructorBySlugForBackfill,
    { slug: "sold-out-via-kajabi" }
  );
  expect(after?.oneOnOneInventory).toBe(0);
  expect(after?.groupInventory).toBe(0);
});

test("internalBackfillInventory: with force=true, restores a sold-out zero from Supabase", async () => {
  // Operator opt-in path: FORCE=1 should let the operator
  // restore a sold-out zero from the Supabase legacy.
  const t = convexTest({ schema, modules });
  const instructorId = await seedInstructor(t, {
    slug: "force-restore",
    name: "Force Restore",
    oneOnOneInventory: 0,
    groupInventory: 0,
  });

  const result = await t.mutation(
    internal.instructors.internalBackfillInventory,
    {
      instructorId: instructorId as any,
      oneOnOneInventory: 8,
      groupInventory: 4,
      force: true,
    }
  );

  expect(result.patched).toEqual(["oneOnOneInventory", "groupInventory"]);
  expect(result.skipped).toEqual([]);
});
