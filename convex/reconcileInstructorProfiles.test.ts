/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import migrationsTest from "@convex-dev/migrations/test";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function seedDivergedRow(t: ReturnType<typeof convexTest>, opts: {
  slug: string;
  profilePortfolio: { urls: string[]; sids: string[] };
  instructorPortfolio: { urls: string[]; sids: string[] };
  profileImage?: { url: string; sid?: string };
  instructorImage?: { url: string; sid?: string };
  meta?: {
    userId?: string;
    bio?: string;
    specialties?: string[];
    isActive?: boolean;
  };
}) {
  return await t.run(async (ctx) => {
    const profileId = await ctx.db.insert("instructorProfiles", {
      slug: opts.slug,
      name: `Instructor ${opts.slug}`,
      userId: opts.meta?.userId ?? `user_${opts.slug}`,
      bio: opts.meta?.bio,
      specialties: opts.meta?.specialties,
      isActive: opts.meta?.isActive ?? true,
      portfolioImages: opts.profilePortfolio.urls,
      portfolioImageStorageIds: opts.profilePortfolio.sids,
      profileImageUrl: opts.profileImage?.url,
      profileImageStorageId: opts.profileImage?.sid,
    });
    const instructorId = await ctx.db.insert("instructors", {
      slug: opts.slug,
      name: `Instructor ${opts.slug}`,
      userId: opts.meta?.userId ?? `user_${opts.slug}`,
      bio: opts.meta?.bio,
      specialties: opts.meta?.specialties,
      isActive: opts.meta?.isActive ?? true,
      maxActiveStudents: 10,
      oneOnOneInventory: 0,
      groupInventory: 0,
      portfolioImages: opts.instructorPortfolio.urls,
      portfolioImageStorageIds: opts.instructorPortfolio.sids,
      profileImageUrl: opts.instructorImage?.url,
      profileImageStorageId: opts.instructorImage?.sid,
    });
    return { profileId, instructorId };
  });
}

test("reconcileInstructorProfilePortfolioImages unions portfolio URLs in profile-first order and pairs storage IDs", async () => {
  // Plan §PR 2: union profile URLs first (preserving order), then unique
  // instructor URLs. Pair storage IDs by URL index — prefer the profile's
  // SID when the URL is at the same index on both sides.
  const t = convexTest(schema, modules);
  migrationsTest.register(t);

  // Profile has [P1, P2] with SIDs [SP1, SP2]. Instructor has [P2, I1] with
  // SIDs [SP2, SI1]. The shared P2 lands at different indices; the union
  // should preserve profile order then add unique instructor URLs.
  const { profileId, instructorId } = await seedDivergedRow(t, {
    slug: "portfolio-union",
    profilePortfolio: { urls: ["P1", "P2"], sids: ["SP1", "SP2"] },
    instructorPortfolio: { urls: ["P2", "I1"], sids: ["SP2", "SI1"] },
  });

  await t.mutation(internal.migrations.runReconcileInstructorProfilePortfolioImages, {});

  const profile = await t.run(async (ctx) => await ctx.db.get(profileId));
  const instructor = await t.run(async (ctx) => await ctx.db.get(instructorId));

  expect(profile?.portfolioImages).toEqual(["P1", "P2", "I1"]);
  expect(profile?.portfolioImageStorageIds).toEqual(["SP1", "SP2", "SI1"]);
  expect(instructor?.portfolioImages).toEqual(["P1", "P2", "I1"]);
  expect(instructor?.portfolioImageStorageIds).toEqual(["SP1", "SP2", "SI1"]);
});

test("reconcileInstructorProfilePortfolioImages is idempotent — second run is a no-op", async () => {
  const t = convexTest(schema, modules);
  migrationsTest.register(t);
  const { profileId, instructorId } = await seedDivergedRow(t, {
    slug: "portfolio-idempotent",
    profilePortfolio: { urls: ["A", "B"], sids: ["SA", "SB"] },
    instructorPortfolio: { urls: ["B", "C"], sids: ["SB", "SC"] },
  });

  await t.mutation(internal.migrations.runReconcileInstructorProfilePortfolioImages, {});
  const profileAfterFirst = await t.run(async (ctx) => await ctx.db.get(profileId));
  const instructorAfterFirst = await t.run(async (ctx) => await ctx.db.get(instructorId));
  const updatedAt1 = instructorAfterFirst?.updatedAt;

  await t.mutation(internal.migrations.runReconcileInstructorProfilePortfolioImages, {});
  const profileAfterSecond = await t.run(async (ctx) => await ctx.db.get(profileId));
  const instructorAfterSecond = await t.run(async (ctx) => await ctx.db.get(instructorId));

  expect(profileAfterSecond?.portfolioImages).toEqual(profileAfterFirst?.portfolioImages);
  expect(profileAfterSecond?.portfolioImageStorageIds).toEqual(
    profileAfterFirst?.portfolioImageStorageIds
  );
  expect(instructorAfterSecond?.portfolioImages).toEqual(instructorAfterFirst?.portfolioImages);
  expect(instructorAfterSecond?.portfolioImageStorageIds).toEqual(
    instructorAfterFirst?.portfolioImageStorageIds
  );
  // Idempotency: a no-op second run must NOT bump `updatedAt`.
  expect(instructorAfterSecond?.updatedAt).toBe(updatedAt1);
});

test("reconcileInstructorProfilePortfolioImages is safe when the profile has no matching instructor", async () => {
  // Plan §PR 2: profiles that lack a matching instructor row (deleted or
  // never created) must not throw — the migration is best-effort per row.
  const t = convexTest(schema, modules);
  migrationsTest.register(t);
  const profileId = await t.run(async (ctx) => {
    return await ctx.db.insert("instructorProfiles", {
      slug: "orphan-profile",
      name: "Orphan",
      isActive: true,
      portfolioImages: ["A", "B"],
      portfolioImageStorageIds: ["SA", "SB"],
    });
  });

  await t.mutation(internal.migrations.runReconcileInstructorProfilePortfolioImages, {});

  const profile = await t.run(async (ctx) => await ctx.db.get(profileId));
  expect(profile?.portfolioImages).toEqual(["A", "B"]);
  expect(profile?.portfolioImageStorageIds).toEqual(["SA", "SB"]);
});

test("reconcileInstructorProfileImage: instructor wins when only instructor has storage", async () => {
  // Plan §PR 2: storage-backed beats URL-only. The instructor's
  // (url, sid) pair propagates to both rows when the profile has only a URL.
  const t = convexTest(schema, modules);
  migrationsTest.register(t);

  const { profileId, instructorId } = await seedDivergedRow(t, {
    slug: "image-instructor-wins",
    profilePortfolio: { urls: [], sids: [] },
    instructorPortfolio: { urls: [], sids: [] },
    profileImage: { url: "https://old.example.com/p.png" },
    instructorImage: { url: "https://new.example.com/p.png", sid: "SID_NEW" },
  });

  await t.mutation(internal.migrations.runReconcileInstructorProfileImage, {});

  const profile = await t.run(async (ctx) => await ctx.db.get(profileId));
  const instructor = await t.run(async (ctx) => await ctx.db.get(instructorId));
  expect(profile?.profileImageUrl).toBe("https://new.example.com/p.png");
  expect(profile?.profileImageStorageId).toBe("SID_NEW");
  expect(instructor?.profileImageUrl).toBe("https://new.example.com/p.png");
  expect(instructor?.profileImageStorageId).toBe("SID_NEW");
});

test("reconcileInstructorProfileImage: profile wins when only profile has storage", async () => {
  // Plan §PR 2: storage-backed beats URL-only. The profile's (url, sid)
  // pair propagates to both rows when the instructor has only a URL.
  const t = convexTest(schema, modules);
  migrationsTest.register(t);

  const { profileId, instructorId } = await seedDivergedRow(t, {
    slug: "image-profile-wins",
    profilePortfolio: { urls: [], sids: [] },
    instructorPortfolio: { urls: [], sids: [] },
    profileImage: { url: "https://new.example.com/p.png", sid: "SID_NEW" },
    instructorImage: { url: "https://old.example.com/p.png" },
  });

  await t.mutation(internal.migrations.runReconcileInstructorProfileImage, {});

  const profile = await t.run(async (ctx) => await ctx.db.get(profileId));
  const instructor = await t.run(async (ctx) => await ctx.db.get(instructorId));
  expect(profile?.profileImageUrl).toBe("https://new.example.com/p.png");
  expect(profile?.profileImageStorageId).toBe("SID_NEW");
  expect(instructor?.profileImageUrl).toBe("https://new.example.com/p.png");
  expect(instructor?.profileImageStorageId).toBe("SID_NEW");
});

test("reconcileInstructorProfileImage is idempotent — second run is a no-op", async () => {
  const t = convexTest(schema, modules);
  migrationsTest.register(t);
  const { profileId, instructorId } = await seedDivergedRow(t, {
    slug: "image-idempotent",
    profilePortfolio: { urls: [], sids: [] },
    instructorPortfolio: { urls: [], sids: [] },
    profileImage: { url: "https://a.example.com/p.png", sid: "SA" },
    instructorImage: { url: "https://b.example.com/p.png", sid: "SB" },
  });

  await t.mutation(internal.migrations.runReconcileInstructorProfileImage, {});
  const instructorAfterFirst = await t.run(async (ctx) => await ctx.db.get(instructorId));
  const updatedAt1 = instructorAfterFirst?.updatedAt;

  await t.mutation(internal.migrations.runReconcileInstructorProfileImage, {});
  const profileAfterSecond = await t.run(async (ctx) => await ctx.db.get(profileId));
  const instructorAfterSecond = await t.run(async (ctx) => await ctx.db.get(instructorId));

  // First run resolves to profile's URL (tied — both have SIDs, profile wins per plan).
  expect(profileAfterSecond?.profileImageUrl).toBe("https://a.example.com/p.png");
  expect(instructorAfterSecond?.profileImageUrl).toBe("https://a.example.com/p.png");
  expect(instructorAfterSecond?.updatedAt).toBe(updatedAt1);
});

test("reconcileInstructorProfileMetadata prefers instructor value, falls back to profile", async () => {
  // Plan §PR 2: `instructors` is canonical. The profile gets the instructor's
  // value when defined; the instructor gets filled in from the profile when
  // its own value is undefined.
  const t = convexTest(schema, modules);
  migrationsTest.register(t);

  const { profileId, instructorId } = await t.run(async (ctx) => {
    const profileId = await ctx.db.insert("instructorProfiles", {
      slug: "meta-prefer-instructor",
      name: "Profile Name",
      userId: "user_meta_prefer",
      email: "profile@example.com",
      bio: "Profile bio",
      tagline: "Profile tagline",
      specialties: ["profile-a", "profile-b"],
      background: ["profile-bg"],
      socials: { twitter: "profile-twitter" },
      isActive: true,
      isNew: true,
      profileImageUploadPath: "profile/path",
    });
    const instructorId = await ctx.db.insert("instructors", {
      slug: "meta-prefer-instructor",
      name: "Instructor Name",
      userId: "user_meta_prefer",
      email: "instructor@example.com",
      bio: "Instructor bio",
      tagline: "Instructor tagline",
      specialties: ["inst-a", "inst-b"],
      background: ["inst-bg"],
      socials: { twitter: "inst-twitter" },
      isActive: true,
      isNew: false,
      maxActiveStudents: 10,
      oneOnOneInventory: 0,
      groupInventory: 0,
      profileImageUploadPath: "instructor/path",
    });
    return { profileId, instructorId };
  });

  await t.mutation(internal.migrations.runReconcileInstructorProfileMetadata, {});

  const profile = await t.run(async (ctx) => await ctx.db.get(profileId));
  const instructor = await t.run(async (ctx) => await ctx.db.get(instructorId));

  // Both rows now match the instructor's canonical values.
  expect(profile?.email).toBe("instructor@example.com");
  expect(profile?.bio).toBe("Instructor bio");
  expect(profile?.tagline).toBe("Instructor tagline");
  expect(profile?.specialties).toEqual(["inst-a", "inst-b"]);
  expect(profile?.background).toEqual(["inst-bg"]);
  expect(profile?.socials).toEqual({ twitter: "inst-twitter" });
  expect(profile?.isNew).toBe(false);
  expect(profile?.profileImageUploadPath).toBe("instructor/path");
  expect(profile?.name).toBe("Instructor Name");

  // Instructor row already had values; they should be unchanged (no patch).
  expect(instructor?.email).toBe("instructor@example.com");
  expect(instructor?.bio).toBe("Instructor bio");
});

test("reconcileInstructorProfileMetadata falls back from instructor to profile when instructor lacks a value", async () => {
  const t = convexTest(schema, modules);
  migrationsTest.register(t);
  const { profileId, instructorId } = await t.run(async (ctx) => {
    const profileId = await ctx.db.insert("instructorProfiles", {
      slug: "meta-fallback",
      name: "Profile Name",
      bio: "Profile bio",
      tagline: "Profile tagline",
      specialties: ["profile-a"],
      isActive: true,
    });
    const instructorId = await ctx.db.insert("instructors", {
      slug: "meta-fallback",
      name: "Instructor Name",
      // bio, tagline, specialties intentionally undefined on the instructor.
      isActive: true,
      maxActiveStudents: 10,
      oneOnOneInventory: 0,
      groupInventory: 0,
    });
    return { profileId, instructorId };
  });

  await t.mutation(internal.migrations.runReconcileInstructorProfileMetadata, {});

  const instructor = await t.run(async (ctx) => await ctx.db.get(instructorId));
  expect(instructor?.bio).toBe("Profile bio");
  expect(instructor?.tagline).toBe("Profile tagline");
  expect(instructor?.specialties).toEqual(["profile-a"]);

  // Profile row already had the values; its `name` should be unaffected
  // (instructor's name is defined, so the profile gets it).
  const profile = await t.run(async (ctx) => await ctx.db.get(profileId));
  expect(profile?.name).toBe("Instructor Name");
  expect(profile?.bio).toBe("Profile bio");
});

test("reconcileInstructorProfileMetadata is idempotent — second run is a no-op", async () => {
  const t = convexTest(schema, modules);
  migrationsTest.register(t);
  const { profileId, instructorId } = await seedDivergedRow(t, {
    slug: "meta-idempotent",
    profilePortfolio: { urls: [], sids: [] },
    instructorPortfolio: { urls: [], sids: [] },
    meta: { bio: "Profile bio", specialties: ["x"], isActive: true },
  });
  await t.run(async (ctx) => {
    await ctx.db.patch(instructorId as any, { bio: "Instructor bio", specialties: ["y"] });
  });

  await t.mutation(internal.migrations.runReconcileInstructorProfileMetadata, {});
  const instructorAfterFirst = await t.run(async (ctx) => await ctx.db.get(instructorId));
  const updatedAt1 = instructorAfterFirst?.updatedAt;

  await t.mutation(internal.migrations.runReconcileInstructorProfileMetadata, {});
  const profileAfterSecond = await t.run(async (ctx) => await ctx.db.get(profileId));
  const instructorAfterSecond = await t.run(async (ctx) => await ctx.db.get(instructorId));

  expect(instructorAfterSecond?.bio).toBe("Instructor bio");
  expect(profileAfterSecond?.bio).toBe("Instructor bio");
  expect(instructorAfterSecond?.updatedAt).toBe(updatedAt1);
});

test("reconciliation suite: full end-to-end run on a divergent row leaves both tables in lockstep", async () => {
  // Plan §PR 2 acceptance: a single divergent instructor (e.g. nino-vecia)
  // passes all three migrations and ends with identical rows. This is the
  // closest possible in-test proxy for the manual staging verification.
  const t = convexTest(schema, modules);
  migrationsTest.register(t);
  const { profileId, instructorId } = await t.run(async (ctx) => {
    const profileId = await ctx.db.insert("instructorProfiles", {
      slug: "end-to-end",
      name: "Profile Name",
      userId: "user_e2e",
      bio: "Profile bio",
      tagline: "Profile tagline",
      specialties: ["x"],
      background: ["y"],
      socials: { twitter: "profile-tw" },
      isActive: true,
      isNew: true,
      profileImageUploadPath: "profile/path",
      portfolioImages: ["https://p.example.com/a.png", "https://p.example.com/b.png"],
      portfolioImageStorageIds: ["SA", "SB"],
      profileImageUrl: "https://old.example.com/p.png",
    });
    const instructorId = await ctx.db.insert("instructors", {
      slug: "end-to-end",
      name: "Instructor Name",
      bio: "Instructor bio",
      tagline: "Instructor tagline",
      specialties: ["a", "b"],
      background: ["c"],
      socials: { twitter: "inst-tw" },
      isActive: true,
      isNew: false,
      maxActiveStudents: 10,
      oneOnOneInventory: 0,
      groupInventory: 0,
      profileImageUploadPath: "instructor/path",
      portfolioImages: ["https://p.example.com/c.png", "https://p.example.com/a.png"],
      portfolioImageStorageIds: ["SC", "SA"],
      profileImageUrl: "https://new.example.com/p.png",
      profileImageStorageId: "SID_NEW",
    });
    return { profileId, instructorId };
  });

  await t.mutation(internal.migrations.runReconcileInstructorProfilePortfolioImages, {});
  await t.mutation(internal.migrations.runReconcileInstructorProfileMetadata, {});
  await t.mutation(internal.migrations.runReconcileInstructorProfileImage, {});

  const profile = await t.run(async (ctx) => await ctx.db.get(profileId));
  const instructor = await t.run(async (ctx) => await ctx.db.get(instructorId));

  expect(profile?.portfolioImages).toEqual(instructor?.portfolioImages);
  expect(profile?.portfolioImageStorageIds).toEqual(instructor?.portfolioImageStorageIds);
  expect(profile?.profileImageUrl).toBe(instructor?.profileImageUrl);
  expect(profile?.profileImageStorageId).toBe(instructor?.profileImageStorageId);
  expect(profile?.name).toBe(instructor?.name);
  expect(profile?.bio).toBe(instructor?.bio);
  expect(profile?.tagline).toBe(instructor?.tagline);
  expect(profile?.specialties).toEqual(instructor?.specialties);
  expect(profile?.background).toEqual(instructor?.background);
  expect(profile?.socials).toEqual(instructor?.socials);
  expect(profile?.isActive).toBe(instructor?.isActive);
  expect(profile?.isNew).toBe(instructor?.isNew);
  expect(profile?.profileImageUploadPath).toBe(instructor?.profileImageUploadPath);
});
