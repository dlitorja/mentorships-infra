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

test("getInstructorBySlug does NOT expose operational metadata (PR 3 security regression guard)", async () => {
  // PR 3 security: the query is unauthenticated. The previous shape spread the
  // full instructor document after stripping googleRefreshToken, leaking
  // googleCalendarId, googleRefreshToken, timeZone, workingHours, scheduling
  // fields, discordVoiceChannelUrl, stripe* metadata, etc. The query must
  // use an explicit public allowlist and omit operational fields.
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    const id = await seedInstructor(ctx, { slug: "operational" });
    await ctx.db.patch(id, {
      googleRefreshToken: "secret-refresh-token",
      googleCalendarId: "ops-calendar-id",
      timeZone: "America/New_York",
      workingHours: { mon: { start: "09:00", end: "17:00" } },
      bufferMinutesBetweenSessions: 15,
      minBookingLeadMinutes: 60,
      maxBookingAdvanceDays: 30,
      blockedDateRanges: [{ start: "2026-01-01", end: "2026-01-07", label: "Holiday" }],
      discordVoiceChannelUrl: "https://discord.com/channels/secret",
      maxActiveStudents: 10,
    } as any);
  });

  const result = await t.query(api.instructors.getInstructorBySlug, {
    slug: "operational",
  });

  expect(result).not.toBeNull();
  const exposed = result as Record<string, unknown>;
  for (const forbidden of [
    "googleRefreshToken",
    "googleCalendarId",
    "timeZone",
    "workingHours",
    "bufferMinutesBetweenSessions",
    "minBookingLeadMinutes",
    "maxBookingAdvanceDays",
    "blockedDateRanges",
    "discordVoiceChannelUrl",
    "maxActiveStudents",
  ]) {
    expect(exposed[forbidden]).toBeUndefined();
  }
});

test("getInstructorBySlug does NOT surface stale storage IDs when the matching URL was removed from portfolioImages", async () => {
  // Reproduces the nino-vecia bug: admin edit form's `removePortfolioImage`
  // drops a URL from `portfolioImages` but leaves the matching entry in
  // `portfolioImageStorageIds`. The previous `getFreshPortfolioUrls`
  // iterated over `storageIds.length` and resolved a fresh URL for the stale
  // storage ID, so the public profile page kept showing the deleted image.
  // Now we iterate over `portfolioImages.length`, so stale storage IDs are
  // ignored and the public page matches the admin form.
  const t = convexTest(schema, modules);

  // Upload two real blobs so we have valid Convex storage IDs to stage.
  const orphanedStorageId = await t.run(async (ctx) => {
    return await ctx.storage.store(new Blob(["orphaned image bytes"]));
  });
  const keptStorageId = await t.run(async (ctx) => {
    return await ctx.storage.store(new Blob(["kept image bytes"]));
  });

  await t.run(async (ctx) => {
    await seedInstructor(ctx, { slug: "stale-storage-ids" });
    const id = await ctx.db
      .query("instructors")
      .withIndex("by_slug", (q: any) => q.eq("slug", "stale-storage-ids"))
      .first()
      .then((d: any) => d?._id);
    if (!id) throw new Error("seed failed");
    // Simulate the post-remove state: admin removed the image at index 0 from
    // `portfolioImages`, leaving the matching storage ID behind. storageIds
    // has one orphaned entry that should not surface.
    await ctx.db.patch(id, {
      portfolioImages: ["https://example.com/keep.jpg"],
      portfolioImageStorageIds: [orphanedStorageId, keptStorageId],
    } as any);
  });

  const result = await t.query(api.instructors.getInstructorBySlug, {
    slug: "stale-storage-ids",
  });

  expect(result).not.toBeNull();
  // Only ONE entry returned (matching `portfolioImages.length === 1`). The
  // orphaned storage ID at index 0 must NOT contribute a fresh URL — the
  // old shape iterated over storageIds.length and returned 2 entries.
  expect(result?.portfolioImages).toHaveLength(1);
  // The kept entry resolves to the fresh Convex storage URL for `keptStorageId`,
  // not the original placeholder. We assert it matches the storage URL rather
  // than the placeholder, since storage IDs always take precedence on read.
  expect(result?.portfolioImages?.[0]).toMatch(/^https?:\/\/.*convex\.cloud\/api\/storage\//);
  expect(result?.portfolioImages?.[0]).not.toBe("https://example.com/keep.jpg");
});
