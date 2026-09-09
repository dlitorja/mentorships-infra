/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function seedInstructor(
  ctx: any,
  opts: {
    slug?: string;
    portfolioImages?: string[];
    profileImageUrl?: string;
    userId?: string;
  } = {}
): Promise<string> {
  const slug = opts.slug ?? "test-instructor";
  return await ctx.db.insert("instructors", {
    slug,
    name: "Test Instructor",
    isActive: true,
    isListed: true,
    userId: opts.userId,
    profileImageUrl: opts.profileImageUrl,
    portfolioImages: opts.portfolioImages,
    updatedAt: Date.now(),
  });
}

test("internalAtomicAddPortfolioImage appends URL + storageId to the instructors row (PR 4 single-table)", async () => {
  const t = convexTest(schema, modules);
  const storageId = await t.run(async (ctx) => {
    return await ctx.storage.store(new Blob(["image bytes"]));
  });

  let instructorId = "";
  await t.run(async (ctx) => {
    instructorId = await seedInstructor(ctx, {
      slug: "append-test",
      portfolioImages: ["https://example.com/a.png"],
    });
  });

  await t.mutation(internal.instructors.internalAtomicAddPortfolioImage, {
    instructorId: instructorId as any,
    url: "https://example.com/b.png",
    storageId,
  });

  const after = await t.run(async (ctx) => ctx.db.get(instructorId as any));
  expect(after?.portfolioImages).toEqual([
    "https://example.com/a.png",
    "https://example.com/b.png",
  ]);
  expect(after?.portfolioImageStorageIds).toEqual([storageId]);
});

test("internalAtomicAddPortfolioImage returns the appended index", async () => {
  const t = convexTest(schema, modules);
  const storageId = await t.run(async (ctx) => {
    return await ctx.storage.store(new Blob(["bytes"]));
  });

  let instructorId = "";
  await t.run(async (ctx) => {
    instructorId = await seedInstructor(ctx, {
      slug: "append-index",
      portfolioImages: ["https://example.com/a.png", "https://example.com/b.png"],
    });
  });

  const result = await t.mutation(internal.instructors.internalAtomicAddPortfolioImage, {
    instructorId: instructorId as any,
    url: "https://example.com/c.png",
    storageId,
  });

  expect(result.url).toBe("https://example.com/c.png");
  expect(result.storageId).toBe(storageId);
  expect(result.index).toBe(2);
});

test("internalAtomicAddPortfolioImage throws when the instructor row is missing", async () => {
  const t = convexTest(schema, modules);
  let seededId = "";
  await t.run(async (ctx) => {
    seededId = await seedInstructor(ctx, { slug: "exists" });
  });

  await t.run(async (ctx) => {
    await ctx.db.delete(seededId as any);
  });

  await expect(
    t.mutation(internal.instructors.internalAtomicAddPortfolioImage, {
      instructorId: seededId as any,
      url: "https://example.com/x.png",
      storageId: "ignored",
    })
  ).rejects.toThrow(/Instructor not found/);
});

test("internalAtomicSetProfileImage writes the instructors row only", async () => {
  const t = convexTest(schema, modules);
  let instructorId = "";
  await t.run(async (ctx) => {
    instructorId = await seedInstructor(ctx, { slug: "set-profile" });
  });

  await t.mutation(internal.instructors.internalAtomicSetProfileImage, {
    instructorId: instructorId as any,
    url: "https://example.com/p.png",
    storageId: "sid_p",
  });

  const after = await t.run(async (ctx) => ctx.db.get(instructorId as any));
  expect(after?.profileImageUrl).toBe("https://example.com/p.png");
  expect(after?.profileImageStorageId).toBe("sid_p");
});

test("internalAtomicSetPortfolioImages replaces the instructors row arrays", async () => {
  const t = convexTest(schema, modules);
  let instructorId = "";
  await t.run(async (ctx) => {
    instructorId = await seedInstructor(ctx, {
      slug: "set-portfolio",
      portfolioImages: ["https://example.com/old.png"],
    });
  });

  await t.mutation(internal.instructors.internalAtomicSetPortfolioImages, {
    instructorId: instructorId as any,
    urls: ["https://example.com/new1.png", "https://example.com/new2.png"],
    storageIds: ["sid_new1", "sid_new2"],
  });

  const after = await t.run(async (ctx) => ctx.db.get(instructorId as any));
  expect(after?.portfolioImages).toEqual([
    "https://example.com/new1.png",
    "https://example.com/new2.png",
  ]);
  expect(after?.portfolioImageStorageIds).toEqual(["sid_new1", "sid_new2"]);
});

test("internalAtomicUpdateProfileFields patches the instructors row and stamps updatedAt", async () => {
  const t = convexTest(schema, modules);
  let instructorId = "";
  const before = Date.now();
  await t.run(async (ctx) => {
    instructorId = await seedInstructor(ctx, {
      slug: "patch-fields",
      portfolioImages: ["https://example.com/old.png"],
    });
  });

  await t.mutation(internal.instructors.internalAtomicUpdateProfileFields, {
    instructorId: instructorId as any,
    fields: {
      tagline: "New tagline",
      bio: "New bio",
      portfolioImages: ["https://example.com/new.png"],
    },
  });

  const after = await t.run(async (ctx) => ctx.db.get(instructorId as any));
  expect(after?.tagline).toBe("New tagline");
  expect(after?.bio).toBe("New bio");
  expect(after?.portfolioImages).toEqual(["https://example.com/new.png"]);
  expect(after?.updatedAt).toBeGreaterThanOrEqual(before);
});

test("internalAtomicFullUpdateInstructor writes all provided fields + updatedAt", async () => {
  const t = convexTest(schema, modules);
  let instructorId = "";
  const before = Date.now();
  await t.run(async (ctx) => {
    instructorId = await seedInstructor(ctx, {
      slug: "full-update",
      portfolioImages: ["https://example.com/old.png"],
    });
  });

  await t.mutation(internal.instructors.internalAtomicFullUpdateInstructor, {
    instructorId: instructorId as any,
    fields: {
      tagline: "Full update tagline",
      portfolioImages: ["https://example.com/new.png"],
      oneOnOneInventory: 7,
    },
  });

  const after = await t.run(async (ctx) => ctx.db.get(instructorId as any));
  expect(after?.tagline).toBe("Full update tagline");
  expect(after?.portfolioImages).toEqual(["https://example.com/new.png"]);
  expect(after?.oneOnOneInventory).toBe(7);
  expect(after?.updatedAt).toBeGreaterThanOrEqual(before);
});

test("internalAtomicFullUpdateInstructor is a no-op when fields is empty but still stamps updatedAt", async () => {
  const t = convexTest(schema, modules);
  let instructorId = "";
  const before = Date.now();
  await t.run(async (ctx) => {
    instructorId = await seedInstructor(ctx, { slug: "empty-update" });
  });

  await t.mutation(internal.instructors.internalAtomicFullUpdateInstructor, {
    instructorId: instructorId as any,
    fields: {},
  });

  const after = await t.run(async (ctx) => ctx.db.get(instructorId as any));
  expect(after).not.toBeNull();
  expect(after?.updatedAt).toBeGreaterThanOrEqual(before);
});

test("updateInstructorProfile (public) routes through internalAtomicUpdateProfileFields", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: "user_owner",
      clerkId: "user_owner",
      email: "owner@example.com",
      role: "instructor",
    });
  });
  let instructorId = "";
  await t.run(async (ctx) => {
    instructorId = await seedInstructor(ctx, {
      slug: "owner-update",
      userId: "user_owner",
    });
  });

  await t
    .withIdentity({ subject: "user_owner" })
    .mutation(api.instructors.updateInstructorProfile, {
      id: instructorId as any,
      tagline: "Owner updated tagline",
    });

  const after = await t.run(async (ctx) => ctx.db.get(instructorId as any));
  expect(after?.tagline).toBe("Owner updated tagline");
});

test("getInstructorBySlug surfaces updated fields from a write through the atomic helper", async () => {
  const t = convexTest(schema, modules);
  let instructorId = "";
  await t.run(async (ctx) => {
    instructorId = await seedInstructor(ctx, {
      slug: "public-roundtrip",
      portfolioImages: ["https://example.com/old.png"],
    });
  });

  await t.mutation(internal.instructors.internalAtomicUpdateProfileFields, {
    instructorId: instructorId as any,
    fields: {
      tagline: "Public read tagline",
      portfolioImages: ["https://example.com/new.png"],
    },
  });

  const result = await t.query(api.instructors.getInstructorBySlug, {
    slug: "public-roundtrip",
  });
  expect(result?.tagline).toBe("Public read tagline");
  expect(result?.portfolioImages).toEqual(["https://example.com/new.png"]);
});
