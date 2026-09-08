/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function seedAdmin(ctx: any) {
  await ctx.db.insert("users", {
    userId: "user_admin",
    clerkId: "user_admin",
    email: "admin@example.com",
    role: "admin",
  });
}

async function seedInstructorWithProfile(
  ctx: any,
  opts: {
    slug?: string;
    userId?: string;
    instructorPortfolio?: string[];
    profilePortfolio?: string[];
  } = {}
): Promise<{ instructorId: string; profileId?: string }> {
  const slug = opts.slug ?? "nino-vecia";
  const userId = opts.userId ?? "user_owner";
  const now = Date.now();
  const instructorId = await ctx.db.insert("instructors", {
    userId,
    slug,
    name: "Nino Vecia",
    email: "nino@example.com",
    isActive: true,
    portfolioImages: opts.instructorPortfolio,
    portfolioImageStorageIds: opts.instructorPortfolio?.map((_, i) => `sid_inst_${i}`),
    updatedAt: now,
  });
  let profileId: string | undefined;
  if (opts.profilePortfolio !== undefined) {
    profileId = await ctx.db.insert("instructorProfiles", {
      slug,
      userId,
      name: "Nino Vecia",
      isActive: true,
      portfolioImages: opts.profilePortfolio,
      portfolioImageStorageIds: opts.profilePortfolio.map((_, i) => `sid_prof_${i}`),
    });
  }
  return { instructorId, profileId };
}

test("internalAtomicAddPortfolioImage appends to both tables in one transaction", async () => {
  const t = convexTest(schema, modules);
  const { instructorId, profileId } = await t.run(async (ctx) => {
    await seedAdmin(ctx);
    return seedInstructorWithProfile(ctx, {
      slug: "atomic-add",
      instructorPortfolio: ["https://example.com/a.png"],
      profilePortfolio: ["https://example.com/a.png"],
    });
  });
  expect(profileId).toBeDefined();

  await t.mutation(internal.instructors.internalAtomicAddPortfolioImage, {
    instructorId: instructorId as any,
    url: "https://example.com/b.png",
    storageId: "sid_new",
  });

  const instructor = await t.run(async (ctx) => await ctx.db.get(instructorId));
  const profile = await t.run(async (ctx) => await ctx.db.get(profileId!));
  expect(instructor?.portfolioImages).toEqual([
    "https://example.com/a.png",
    "https://example.com/b.png",
  ]);
  expect(instructor?.portfolioImageStorageIds).toEqual(["sid_inst_0", "sid_new"]);
  expect(profile?.portfolioImages).toEqual([
    "https://example.com/a.png",
    "https://example.com/b.png",
  ]);
  expect(profile?.portfolioImageStorageIds).toEqual(["sid_prof_0", "sid_new"]);
});

test("internalAtomicAddPortfolioImage commits on the instructors row even when the profile row is missing", async () => {
  const t = convexTest(schema, modules);
  const { instructorId, profileId } = await t.run(async (ctx) => {
    await seedAdmin(ctx);
    return seedInstructorWithProfile(ctx, {
      slug: "atomic-add-no-profile",
      // profile row intentionally absent
    });
  });
  expect(profileId).toBeUndefined();

  await t.mutation(internal.instructors.internalAtomicAddPortfolioImage, {
    instructorId: instructorId as any,
    url: "https://example.com/only-on-instructors.png",
    storageId: "sid_only",
  });

  const instructor = await t.run(async (ctx) => await ctx.db.get(instructorId));
  expect(instructor?.portfolioImages).toEqual([
    "https://example.com/only-on-instructors.png",
  ]);
});

test("internalAtomicAddPortfolioImage throws when the instructor row is missing", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await seedAdmin(ctx);
  });

  // Insert a throwaway row, get its id, then delete it so the id is invalid.
  const ghostId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("instructors", {
      slug: "ghost",
      name: "Ghost",
      isActive: true,
    });
    await ctx.db.delete(id);
    return id;
  });

  await expect(
    t.mutation(internal.instructors.internalAtomicAddPortfolioImage, {
      instructorId: ghostId as any,
      url: "https://example.com/never.png",
      storageId: "sid_never",
    })
  ).rejects.toThrow("Instructor not found");
});

test("internalAtomicSetProfileImage writes both tables in one transaction", async () => {
  const t = convexTest(schema, modules);
  const { instructorId, profileId } = await t.run(async (ctx) => {
    await seedAdmin(ctx);
    return seedInstructorWithProfile(ctx, {
      slug: "atomic-profile-img",
      instructorPortfolio: ["https://example.com/profile-old.png"],
      profilePortfolio: ["https://example.com/profile-old.png"],
    });
  });
  expect(profileId).toBeDefined();

  await t.mutation(internal.instructors.internalAtomicSetProfileImage, {
    instructorId: instructorId as any,
    url: "https://example.com/new-profile.png",
    storageId: "sid_profile_new",
  });

  const instructor = await t.run(async (ctx) => await ctx.db.get(instructorId));
  const profile = await t.run(async (ctx) => await ctx.db.get(profileId!));
  expect(instructor?.profileImageUrl).toBe("https://example.com/new-profile.png");
  expect(instructor?.profileImageStorageId).toBe("sid_profile_new");
  expect(profile?.profileImageUrl).toBe("https://example.com/new-profile.png");
  expect(profile?.profileImageStorageId).toBe("sid_profile_new");
});

test("internalAtomicSetPortfolioImages replaces both tables in one transaction", async () => {
  const t = convexTest(schema, modules);
  const { instructorId, profileId } = await t.run(async (ctx) => {
    await seedAdmin(ctx);
    return seedInstructorWithProfile(ctx, {
      slug: "atomic-set-portfolio",
      instructorPortfolio: ["https://example.com/old.png"],
      profilePortfolio: ["https://example.com/old.png"],
    });
  });

  const newUrls = ["https://example.com/x.png", "https://example.com/y.png"];
  const newIds = ["sid_x", "sid_y"];
  await t.mutation(internal.instructors.internalAtomicSetPortfolioImages, {
    instructorId: instructorId as any,
    urls: newUrls,
    storageIds: newIds,
  });

  const instructor = await t.run(async (ctx) => await ctx.db.get(instructorId));
  const profile = await t.run(async (ctx) => await ctx.db.get(profileId!));
  expect(instructor?.portfolioImages).toEqual(newUrls);
  expect(instructor?.portfolioImageStorageIds).toEqual(newIds);
  expect(profile?.portfolioImages).toEqual(newUrls);
  expect(profile?.portfolioImageStorageIds).toEqual(newIds);
});

test("internalAtomicUpdateProfileFields patches only overlapping fields on both tables", async () => {
  const t = convexTest(schema, modules);
  const { instructorId, profileId } = await t.run(async (ctx) => {
    await seedAdmin(ctx);
    return seedInstructorWithProfile(ctx, {
      slug: "atomic-update-fields",
      instructorPortfolio: ["https://example.com/old.png"],
      profilePortfolio: ["https://example.com/old.png"],
    });
  });

  await t.mutation(internal.instructors.internalAtomicUpdateProfileFields, {
    instructorId: instructorId as any,
    fields: {
      // overlapping — should be written to both tables
      tagline: "New tagline",
      bio: "New bio",
      portfolioImages: ["https://example.com/x.png", "https://example.com/y.png"],
      portfolioImageStorageIds: ["sid_x", "sid_y"],
      isActive: false,
      // non-overlapping — should be ignored by the helper
      googleCalendarId: "should-be-ignored",
      maxActiveStudents: 999,
      oneOnOneInventory: 42,
      kajabiCheckoutUrlOneOnOne: "should-be-ignored",
    },
  });

  const instructor = await t.run(async (ctx) => await ctx.db.get(instructorId));
  const profile = await t.run(async (ctx) => await ctx.db.get(profileId!));

  // Overlapping fields — both tables updated
  expect(instructor?.tagline).toBe("New tagline");
  expect(profile?.tagline).toBe("New tagline");
  expect(instructor?.bio).toBe("New bio");
  expect(profile?.bio).toBe("New bio");
  expect(instructor?.portfolioImages).toEqual([
    "https://example.com/x.png",
    "https://example.com/y.png",
  ]);
  expect(profile?.portfolioImages).toEqual([
    "https://example.com/x.png",
    "https://example.com/y.png",
  ]);
  expect(instructor?.isActive).toBe(false);
  expect(profile?.isActive).toBe(false);

  // Non-overlapping fields — still untouched on both tables
  expect(instructor?.googleCalendarId).toBeUndefined();
  expect(instructor?.maxActiveStudents).toBeUndefined();
  expect(instructor?.oneOnOneInventory).toBeUndefined();
  expect(instructor?.kajabiCheckoutUrlOneOnOne).toBeUndefined();
});

test("internalAtomicUpdateProfileFields no-ops the profile table when no profile row exists", async () => {
  const t = convexTest(schema, modules);
  const { instructorId } = await t.run(async (ctx) => {
    await seedAdmin(ctx);
    return seedInstructorWithProfile(ctx, {
      slug: "atomic-update-no-profile",
      // profile row intentionally absent
    });
  });

  await t.mutation(internal.instructors.internalAtomicUpdateProfileFields, {
    instructorId: instructorId as any,
    fields: {
      tagline: "only-on-instructors",
      bio: "only-on-instructors",
    },
  });

  const instructor = await t.run(async (ctx) => await ctx.db.get(instructorId));
  expect(instructor?.tagline).toBe("only-on-instructors");
  expect(instructor?.bio).toBe("only-on-instructors");
});

test("internalAtomicUpdateProfileFields is a no-op when fields is empty", async () => {
  const t = convexTest(schema, modules);
  const { instructorId, profileId } = await t.run(async (ctx) => {
    await seedAdmin(ctx);
    return seedInstructorWithProfile(ctx, {
      slug: "atomic-update-empty",
      instructorPortfolio: ["https://example.com/keep.png"],
      profilePortfolio: ["https://example.com/keep.png"],
    });
  });

  await t.mutation(internal.instructors.internalAtomicUpdateProfileFields, {
    instructorId: instructorId as any,
    fields: {
      googleCalendarId: "instructor-only",
      maxActiveStudents: 50,
      oneOnOneInventory: 7,
    },
  });

  const instructor = await t.run(async (ctx) => await ctx.db.get(instructorId));
  const profile = await t.run(async (ctx) => await ctx.db.get(profileId!));
  // Non-overlapping fields ignored; original data untouched.
  expect(instructor?.portfolioImages).toEqual(["https://example.com/keep.png"]);
  expect(profile?.portfolioImages).toEqual(["https://example.com/keep.png"]);
  expect(instructor?.googleCalendarId).toBeUndefined();
  expect(instructor?.oneOnOneInventory).toBeUndefined();
});

test("public updateInstructor writes overlapping fields to both tables (PR 1 contract)", async () => {
  const t = convexTest(schema, modules);
  const { instructorId, profileId } = await t.run(async (ctx) => {
    await seedAdmin(ctx);
    return seedInstructorWithProfile(ctx, {
      slug: "public-update-contract",
      instructorPortfolio: ["https://example.com/old.png"],
      profilePortfolio: ["https://example.com/old.png"],
    });
  });

  await t
    .withIdentity({ subject: "user_admin" })
    .mutation(api.instructors.updateInstructor, {
      id: instructorId as any,
      tagline: "Public-route tagline",
      bio: "Public-route bio",
      portfolioImages: ["https://example.com/x.png", "https://example.com/y.png"],
      // non-overlapping field — only patched on instructors
      maxActiveStudents: 25,
      oneOnOneInventory: 3,
    });

  const instructor = await t.run(async (ctx) => await ctx.db.get(instructorId));
  const profile = await t.run(async (ctx) => await ctx.db.get(profileId!));

  // Both tables received the overlapping writes.
  expect(instructor?.tagline).toBe("Public-route tagline");
  expect(profile?.tagline).toBe("Public-route tagline");
  expect(instructor?.bio).toBe("Public-route bio");
  expect(profile?.bio).toBe("Public-route bio");
  expect(instructor?.portfolioImages).toEqual([
    "https://example.com/x.png",
    "https://example.com/y.png",
  ]);
  expect(profile?.portfolioImages).toEqual([
    "https://example.com/x.png",
    "https://example.com/y.png",
  ]);

  // Non-overlapping fields stayed on instructors only.
  expect(instructor?.maxActiveStudents).toBe(25);
  expect(instructor?.oneOnOneInventory).toBe(3);
  expect(profile?.maxActiveStudents).toBeUndefined();
});

test("internalAtomicFullUpdateInstructor writes both tables for overlapping + instructors-only for the rest in one transaction", async () => {
  const t = convexTest(schema, modules);
  const { instructorId, profileId } = await t.run(async (ctx) => {
    await seedAdmin(ctx);
    return seedInstructorWithProfile(ctx, {
      slug: "atomic-full-update",
      instructorPortfolio: ["https://example.com/old.png"],
      profilePortfolio: ["https://example.com/old.png"],
    });
  });

  await t
    .withIdentity({ subject: "user_admin" })
    .mutation(api.instructors.updateInstructor, {
      id: instructorId as any,
      // overlapping — both tables
      tagline: "Full-update tagline",
      bio: "Full-update bio",
      portfolioImages: ["https://example.com/x.png"],
      // instructors-only
      maxActiveStudents: 25,
      oneOnOneInventory: 3,
      kajabiCheckoutUrlOneOnOne: "https://kajabi.test/1on1",
    });

  const instructor = await t.run(async (ctx) => await ctx.db.get(instructorId));
  const profile = await t.run(async (ctx) => await ctx.db.get(profileId!));

  expect(instructor?.tagline).toBe("Full-update tagline");
  expect(profile?.tagline).toBe("Full-update tagline");
  expect(instructor?.bio).toBe("Full-update bio");
  expect(profile?.bio).toBe("Full-update bio");
  expect(instructor?.portfolioImages).toEqual(["https://example.com/x.png"]);
  expect(profile?.portfolioImages).toEqual(["https://example.com/x.png"]);

  expect(instructor?.maxActiveStudents).toBe(25);
  expect(instructor?.oneOnOneInventory).toBe(3);
  expect(instructor?.kajabiCheckoutUrlOneOnOne).toBe("https://kajabi.test/1on1");
  expect(profile?.maxActiveStudents).toBeUndefined();
  expect(profile?.oneOnOneInventory).toBeUndefined();
  expect(profile?.kajabiCheckoutUrlOneOnOne).toBeUndefined();

  // updatedAt bumped on instructors
  expect(typeof instructor?.updatedAt).toBe("number");
});

test("internalAtomicFullUpdateInstructor rolls back BOTH tables when the instructor-side write fails", async () => {
  // Atomicity contract from Greptile P1 review on PR #830: a single Convex
  // transaction must back the entire update. If the instructors-side patch
  // throws (e.g. schema validator rejects a field), neither table is committed.
  const t = convexTest(schema, modules);
  const { instructorId, profileId } = await t.run(async (ctx) => {
    await seedAdmin(ctx);
    return seedInstructorWithProfile(ctx, {
      slug: "atomic-rollback",
      instructorPortfolio: ["https://example.com/before.png"],
      profilePortfolio: ["https://example.com/before.png"],
    });
  });

  const beforeInstructor = await t.run(async (ctx) => await ctx.db.get(instructorId));
  const beforeProfile = await t.run(async (ctx) => await ctx.db.get(profileId!));
  const beforeUpdatedAt = beforeInstructor?.updatedAt;
  expect(beforeUpdatedAt).toBeTypeOf("number");

  // Force a failure: maxActiveStudents is typed `v.number()` in the
  // `instructors` schema, so the string below violates the validator on the
  // instructors patch. The helper accepts `v.any()` for `fields` so the
  // argument validator itself doesn't reject — the schema validator on
  // `db.patch` does, which is exactly the failure mode we want.
  await expect(
    t.mutation(internal.instructors.internalAtomicFullUpdateInstructor, {
      instructorId: instructorId as any,
      fields: {
        tagline: "Should not commit",
        bio: "Should not commit",
        maxActiveStudents: "not-a-number",
      },
    })
  ).rejects.toThrow();

  // Neither table should have been touched.
  const afterInstructor = await t.run(async (ctx) => await ctx.db.get(instructorId));
  const afterProfile = await t.run(async (ctx) => await ctx.db.get(profileId!));
  expect(afterInstructor?.tagline).toBe(beforeInstructor?.tagline);
  expect(afterInstructor?.bio).toBe(beforeInstructor?.bio);
  expect(afterInstructor?.portfolioImages).toEqual(["https://example.com/before.png"]);
  expect(afterInstructor?.updatedAt).toBe(beforeUpdatedAt);
  expect(afterProfile?.tagline).toBe(beforeProfile?.tagline);
  expect(afterProfile?.bio).toBe(beforeProfile?.bio);
  expect(afterProfile?.portfolioImages).toEqual(["https://example.com/before.png"]);
});

test("updateInstructorProfile sets updatedAt on instructors without an outer patch", async () => {
  // Greptile P1 concern on the previous shape: the public mutation patched
  // `instructors.updatedAt` outside the atomic helper, which risked a
  // partial commit. The helper now sets `updatedAt` itself; this test
  // verifies the public mutation does not need to.
  const t = convexTest(schema, modules);
  const { instructorId, profileId } = await t.run(async (ctx) => {
    await seedAdmin(ctx);
    return seedInstructorWithProfile(ctx, {
      slug: "atomic-profile-updatedAt",
      instructorPortfolio: ["https://example.com/old.png"],
      profilePortfolio: ["https://example.com/old.png"],
    });
  });
  const beforeUpdatedAt = (await t.run(async (ctx) => await ctx.db.get(instructorId)))?.updatedAt;
  await new Promise((r) => setTimeout(r, 5));

  await t
    .withIdentity({ subject: "user_owner" })
    .mutation(api.instructors.updateInstructorProfile, {
      id: instructorId as any,
      tagline: "Owner updated tagline",
    });

  const instructor = await t.run(async (ctx) => await ctx.db.get(instructorId));
  const profile = await t.run(async (ctx) => await ctx.db.get(profileId!));
  expect(instructor?.tagline).toBe("Owner updated tagline");
  expect(profile?.tagline).toBe("Owner updated tagline");
  expect(instructor?.updatedAt).toBeGreaterThan(beforeUpdatedAt ?? 0);
});

// PR 3: the legacy *ForProfile fallback test was removed because the
// updateInstructorProfileStorageIdForProfile and
// updateInstructorPortfolioStorageIdsForProfile mutations no longer exist.
// Backfill routes now call the atomic instructors-only mutations directly,
// and PR 4 will drop the instructorProfiles table.
