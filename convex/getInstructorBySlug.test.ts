/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function seedInstructor(
  ctx: any,
  opts: {
    slug?: string;
    name?: string;
    profileImageUrl?: string;
    portfolioImages?: string[];
    isListed?: boolean;
    oneOnOneInventory?: number;
    groupInventory?: number;
  } = {}
): Promise<string> {
  const slug = opts.slug ?? "nino-vecia";
  return await ctx.db.insert("instructors", {
    slug,
    name: opts.name ?? "Nino Vecia",
    isActive: true,
    isListed: opts.isListed ?? true,
    profileImageUrl: opts.profileImageUrl,
    portfolioImages: opts.portfolioImages,
    oneOnOneInventory: opts.oneOnOneInventory ?? 4,
    groupInventory: opts.groupInventory ?? 0,
    updatedAt: Date.now(),
  });
}

test("getInstructorBySlug returns 5 portfolio URLs in the same order as stored", async () => {
  const t = convexTest(schema, modules);
  const urls = [
    "https://example.com/portfolio-1.png",
    "https://example.com/portfolio-2.png",
    "https://example.com/portfolio-3.png",
    "https://example.com/portfolio-4.png",
    "https://example.com/portfolio-5.png",
  ];
  await t.run(async (ctx) => {
    await seedInstructor(ctx, {
      slug: "portfolio-order",
      portfolioImages: urls,
      profileImageUrl: "https://example.com/profile.png",
    });
  });

  const result = await t.query(api.instructors.getInstructorBySlug, {
    slug: "portfolio-order",
  });

  expect(result).not.toBeNull();
  expect(result?.portfolioImages).toEqual(urls);
  expect(result?.profileImageUrl).toBe("https://example.com/profile.png");
  expect(result?.slug).toBe("portfolio-order");
  expect(result?.instructorId).toBeDefined();
});

test("getInstructorBySlug works when instructorProfiles is empty", async () => {
  // PR 3 contract: the query reads ONLY from `instructors`. An empty (or
  // missing) profile table must not affect the response.
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await seedInstructor(ctx, {
      slug: "no-profile-row",
      portfolioImages: ["https://example.com/a.png", "https://example.com/b.png"],
      profileImageUrl: "https://example.com/p.png",
    });
  });

  const result = await t.query(api.instructors.getInstructorBySlug, {
    slug: "no-profile-row",
  });

  expect(result).not.toBeNull();
  expect(result?.portfolioImages).toEqual([
    "https://example.com/a.png",
    "https://example.com/b.png",
  ]);
  expect(result?.profileImageUrl).toBe("https://example.com/p.png");
});

test("getInstructorBySlug ignores instructorProfiles row even when one exists", async () => {
  // Even if a stale instructorProfiles row exists, the query reads only from
  // the instructors table. Profile fields on the response must come from the
  // instructors row, not the profile row.
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await seedInstructor(ctx, {
      slug: "profile-divergence",
      portfolioImages: ["https://instructors.example/1.png"],
      profileImageUrl: "https://instructors.example/profile.png",
    });
    await ctx.db.insert("instructorProfiles", {
      slug: "profile-divergence",
      name: "Profile-Table-Name",
      isActive: true,
      profileImageUrl: "https://profiles.example/profile.png",
      portfolioImages: ["https://profiles.example/1.png", "https://profiles.example/2.png"],
    });
  });

  const result = await t.query(api.instructors.getInstructorBySlug, {
    slug: "profile-divergence",
  });

  expect(result).not.toBeNull();
  expect(result?.name).toBe("Nino Vecia");
  expect(result?.profileImageUrl).toBe("https://instructors.example/profile.png");
  expect(result?.portfolioImages).toEqual(["https://instructors.example/1.png"]);
});

test("getInstructorBySlug returns null when isListed is false", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await seedInstructor(ctx, { slug: "hidden", isListed: false });
  });

  const result = await t.query(api.instructors.getInstructorBySlug, {
    slug: "hidden",
  });
  expect(result).toBeNull();
});

test("getInstructorBySlug returns null when no instructor exists", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("instructorProfiles", {
      slug: "ghost-profile-only",
      name: "Ghost",
      isActive: true,
    });
  });

  const result = await t.query(api.instructors.getInstructorBySlug, {
    slug: "ghost-profile-only",
  });
  expect(result).toBeNull();
});

test("getInstructorBySlug surfaces inventory and kajabi fields from instructors", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await seedInstructor(ctx, {
      slug: "kajabi-instructor",
      oneOnOneInventory: 7,
      groupInventory: 2,
    });
    await ctx.db.patch(
      (await ctx.db
        .query("instructors")
        .withIndex("by_slug", (q: any) => q.eq("slug", "kajabi-instructor"))
        .first())._id,
      {
        useKajabiCheckout: true,
        kajabiCheckoutUrlOneOnOne: "https://kajabi.example/one-on-one",
        kajabiCheckoutUrlGroup: "https://kajabi.example/group",
      }
    );
  });

  const result = await t.query(api.instructors.getInstructorBySlug, {
    slug: "kajabi-instructor",
  });

  expect(result).not.toBeNull();
  expect(result?.oneOnOneInventory).toBe(7);
  expect(result?.groupInventory).toBe(2);
  expect(result?.useKajabiCheckout).toBe(true);
  expect(result?.kajabiCheckoutUrlOneOnOne).toBe("https://kajabi.example/one-on-one");
  expect(result?.kajabiCheckoutUrlGroup).toBe("https://kajabi.example/group");
});
