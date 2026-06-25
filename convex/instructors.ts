import { query, mutation, internalMutation, internalAction, internalQuery, action } from "./_generated/server";
import { internal, api } from "./_generated/api";
import type { QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";

export const getStorageUrl = query({
  args: { storageId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.storage.getUrl(args.storageId as Id<"_storage">);
  },
});

async function getFreshProfileUrl(
  ctx: QueryCtx,
  storageId: string | undefined,
  fallbackUrl: string | undefined
): Promise<string | undefined> {
  if (!storageId) return fallbackUrl;
  const url = await ctx.storage.getUrl(storageId as Id<"_storage">);
  return url ?? fallbackUrl;
}

async function getFreshPortfolioUrls(
  ctx: QueryCtx,
  storageIds: string[] | undefined,
  fallbackUrls: string[] | undefined
): Promise<string[] | undefined> {
  if (!storageIds || storageIds.length === 0) return fallbackUrls;
  const urls = await Promise.all(
    storageIds.map(async (sid, i) => {
      if (!sid) return fallbackUrls?.[i];
      const url = await ctx.storage.getUrl(sid as Id<"_storage">);
      return url ?? fallbackUrls?.[i];
    })
  );
  return urls.filter((u): u is string => u !== undefined);
}

export const getMigrationStatus = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const user = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
      .first();
    if (user?.role !== "admin") throw new Error("Forbidden");

    const instructors = await ctx.db.query("instructors").collect();
    const profiles = await ctx.db.query("instructorProfiles").collect();

    const instructorsNeedingProfileMigration = instructors.filter(
      (i) => i.profileImageUrl && !i.profileImageStorageId
    ).length;

    const instructorsNeedingPortfolioMigration = instructors.filter(
      (i) => i.portfolioImages &&
      i.portfolioImages.length > 0 &&
      (!i.portfolioImageStorageIds || i.portfolioImageStorageIds.length < i.portfolioImages.length)
    ).length;

    const profilesNeedingProfileMigration = profiles.filter(
      (p) => p.profileImageUrl && !p.profileImageStorageId
    ).length;

    const profilesNeedingPortfolioMigration = profiles.filter(
      (p) => p.portfolioImages &&
      p.portfolioImages.length > 0 &&
      (!p.portfolioImageStorageIds || p.portfolioImageStorageIds.length < p.portfolioImages.length)
    ).length;

    const instructorsWithStorageId = instructors.filter((i) => i.profileImageStorageId).length;
    const profilesWithStorageId = profiles.filter((p) => p.profileImageStorageId).length;

    return {
      instructorsNeedingProfileMigration,
      instructorsNeedingPortfolioMigration,
      profilesNeedingProfileMigration,
      profilesNeedingPortfolioMigration,
      instructorsWithStorageId,
      profilesWithStorageId,
      totalInstructors: instructors.length,
      totalProfiles: profiles.length,
    };
  },
});

type BackfillSummary = {
  processedProfiles: number;
  processedInstructors: number;
  processedPortfolioImages: number;
  processedStudentResults: number;
  skipped: number;
  errors: Array<{ kind: string; id: string; message: string }>;
};

function absoluteUrl(baseUrl: string, url?: string): string | undefined {
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  const base = baseUrl.replace(/\/$/, "");
  const path = url.startsWith("/") ? url : `/${url}`;
  return `${base}${path}`;
}

function contentTypeForPath(path: string): string {
  const p = path.toLowerCase();
  if (p.endsWith(".png")) return "image/png";
  if (p.endsWith(".webp")) return "image/webp";
  if (p.endsWith(".gif")) return "image/gif";
  if (p.endsWith(".svg") || p.endsWith(".svgz")) return "image/svg+xml";
  return "image/jpeg"; // default
}

export const backfillImages = action({
  args: {
    baseUrl: v.string(),
    dryRun: v.optional(v.boolean()),
    includeStudentResults: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<BackfillSummary> => {
    const summary: BackfillSummary = {
      processedProfiles: 0,
      processedInstructors: 0,
      processedPortfolioImages: 0,
      processedStudentResults: 0,
      skipped: 0,
      errors: [],
    };

    // Ensure caller is admin (direct check, no side-effects)
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    // We can't use QueryCtx helpers directly in actions; verify admin by calling a query that enforces admin.
    try {
      await ctx.runQuery(api.instructors.getMigrationStatus, {} as any);
    } catch {
      throw new Error("Forbidden");
    }

    // Normalize to origin (accepts full URLs or paths; route also normalizes)
    let baseUrl = args.baseUrl;
    try {
      baseUrl = new URL(baseUrl).origin;
    } catch {
      baseUrl = baseUrl;
    }
    const includeStudentResults = args.includeStudentResults !== false;

    // Load profiles and instructors
    const [profiles, instructors] = await Promise.all([
      ctx.runQuery(api.instructors.listInstructorProfilesInternal, {} as any),
      ctx.runQuery(api.instructors.listInstructorsInternal, {} as any),
    ]);

    // Index instructors by slug for convenience
    const instructorBySlug = new Map<string, any>();
    for (const inst of instructors as any[]) {
      if (inst.slug) instructorBySlug.set(inst.slug, inst);
    }

    const maxItems = args.limit ?? Number.POSITIVE_INFINITY;
    let processedCount = 0;

    // Helper to upload one URL and return {storageId, url}
    const uploadFromUrl = async (srcUrl: string): Promise<{ storageId: string; url: string } | { error: string }> => {
      try {
        const res = await fetch(srcUrl);
        if (!res.ok) return { error: `GET ${res.status}` };
        const buf = await res.arrayBuffer();
        const postUrl = await ctx.runMutation(api.instructors.generateInstructorUploadUrl, {} as any);
        const ct = contentTypeForPath(srcUrl);
        const up = await fetch(postUrl, { method: "POST", headers: { "Content-Type": ct }, body: buf });
        if (!up.ok) return { error: `POST ${up.status}` };
        const { storageId } = await up.json() as { storageId: string };
        const url = (await ctx.runQuery(api.instructors.getStorageUrl, { storageId } as any)) ?? `convex://storage/${storageId}`;
        return { storageId, url };
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    };

    // Backfill profile images and portfolio images
    for (const profile of profiles as any[]) {
      if (processedCount >= maxItems) break;
      const slug: string | undefined = profile.slug;
      try {
        const inst = slug ? instructorBySlug.get(slug) : undefined;

        // Profile image
        if (!profile.profileImageStorageId && profile.profileImageUrl) {
          const src = absoluteUrl(baseUrl, profile.profileImageUrl);
          if (src && !args.dryRun) {
            const uploaded = await uploadFromUrl(src);
            if (!('error' in uploaded)) {
              await ctx.runMutation(api.instructors.updateInstructorProfileStorageIdForProfile, {
                slug,
                storageId: uploaded.storageId,
                url: uploaded.url,
              } as any);
              if (inst?._id) {
                await ctx.runMutation(api.instructors.updateInstructorProfileStorageId, {
                  instructorId: inst._id,
                  storageId: uploaded.storageId,
                  url: uploaded.url,
                } as any);
                summary.processedInstructors += 1;
              }
              summary.processedProfiles += 1;
            } else {
              summary.errors.push({ kind: "profile", id: slug || "unknown", message: `upload failed for ${src}: ${uploaded.error}` });
            }
          }
          processedCount++;
        }

        // Portfolio images
        const urls: string[] = (profile.portfolioImages ?? []) as string[];
        const sids: string[] = (profile.portfolioImageStorageIds ?? []) as string[];
        const toProcess: number[] = urls.map((_, i) => i).filter((i) => !sids[i] && urls[i]);
        if (toProcess.length > 0) {
          const newUrls = [...urls];
          const newSids = [...sids];
          for (const i of toProcess) {
            if (processedCount >= maxItems) break;
            const src = absoluteUrl(baseUrl, urls[i]);
            if (src && !args.dryRun) {
              const uploaded = await uploadFromUrl(src);
              if (!('error' in uploaded)) {
                newUrls[i] = uploaded.url;
                newSids[i] = uploaded.storageId;
                summary.processedPortfolioImages += 1;
              } else {
                summary.errors.push({ kind: "portfolio", id: `${slug || "unknown"}[${i}]`, message: `upload failed for ${src}: ${uploaded.error}` });
              }
            }
            processedCount++;
          }
          if (!args.dryRun && toProcess.length > 0) {
            await ctx.runMutation(api.instructors.updateInstructorPortfolioStorageIdsForProfile, {
              slug,
              storageIds: newSids,
              urls: newUrls,
            } as any);
            if (inst?._id) {
              await ctx.runMutation(api.instructors.updateInstructorPortfolioStorageIds, {
                instructorId: inst._id,
                storageIds: newSids,
                urls: newUrls,
              } as any);
            }
          }
        }
      } catch (e) {
        summary.errors.push({ kind: "profile", id: slug || "unknown", message: e instanceof Error ? e.message : String(e) });
        summary.skipped += 1;
      }
    }

    if (includeStudentResults) {
      const studentResults = await ctx.runQuery(api.instructors.listStudentResultsInternal, {} as any);
      for (const r of studentResults as any[]) {
        if (processedCount >= maxItems) break;
        try {
          if (!r.imageStorageId && r.imageUrl) {
            const src = absoluteUrl(baseUrl, r.imageUrl);
            if (src && !args.dryRun) {
              const uploaded = await uploadFromUrl(src);
              if (!('error' in uploaded)) {
                await ctx.runMutation(api.instructors.updateStudentResultStorageId, {
                  studentResultId: r._id,
                  storageId: uploaded.storageId,
                  url: uploaded.url,
                } as any);
                summary.processedStudentResults += 1;
              } else {
                summary.errors.push({ kind: "studentResult", id: r._id, message: `upload failed for ${src}: ${uploaded.error}` });
              }
            }
            processedCount++;
          }
        } catch (e) {
          summary.errors.push({ kind: "studentResult", id: r._id, message: e instanceof Error ? e.message : String(e) });
          summary.skipped += 1;
        }
      }
    }

    return summary;
  },
});

/**
 * Internal-only helpers to read and write without auth for maintenance/backfills.
 * Keep scope tight and reuse existing logic. These are intentionally not exported via api.*
 */

export const listInstructorProfilesAll = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("instructorProfiles").collect();
  },
});

export const listInstructorsAll = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("instructors")
      .withIndex("by_deletedAt", (q) => q.eq("deletedAt", undefined))
      .collect();
  },
});

export const listStudentResultsAll = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("studentResults").collect();
  },
});

export const internalPatchInstructorProfileImageBySlug = internalMutation({
  args: { slug: v.string(), storageId: v.string(), url: v.string() },
  handler: async (ctx, args) => {
    const profile = await ctx.db
      .query("instructorProfiles")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();
    if (!profile) throw new Error("Instructor profile not found");
    await ctx.db.patch(profile._id, {
      profileImageStorageId: args.storageId,
      profileImageUrl: args.url,
    });
    return { storageId: args.storageId, url: args.url };
  },
});

export const internalPatchInstructorPortfolioBySlug = internalMutation({
  args: { slug: v.string(), storageIds: v.array(v.string()), urls: v.array(v.string()) },
  handler: async (ctx, args) => {
    const profile = await ctx.db
      .query("instructorProfiles")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();
    if (!profile) throw new Error("Instructor profile not found");
    await ctx.db.patch(profile._id, {
      portfolioImageStorageIds: args.storageIds,
      portfolioImages: args.urls,
    });
    return { storageIds: args.storageIds, urls: args.urls };
  },
});

export const internalPatchInstructorProfileImageById = internalMutation({
  args: { instructorId: v.id("instructors"), storageId: v.string(), url: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.instructorId, {
      profileImageStorageId: args.storageId,
      profileImageUrl: args.url,
    });
    return { storageId: args.storageId, url: args.url };
  },
});

export const internalPatchInstructorPortfolioById = internalMutation({
  args: { instructorId: v.id("instructors"), storageIds: v.array(v.string()), urls: v.array(v.string()) },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.instructorId, {
      portfolioImageStorageIds: args.storageIds,
      portfolioImages: args.urls,
    });
    return { storageIds: args.storageIds, urls: args.urls };
  },
});

export const internalPatchStudentResultImage = internalMutation({
  args: { studentResultId: v.id("studentResults"), storageId: v.string(), url: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.studentResultId, {
      imageStorageId: args.storageId,
      imageUrl: args.url,
    });
    return { storageId: args.storageId, url: args.url };
  },
});

/**
 * Internal backfill scoped to specific slugs.
 * Fetches images from a source site, uploads to Convex Storage, and updates both instructorProfiles and instructors.
 */
export const backfillImagesForSlugs = internalAction({
  args: {
    baseUrl: v.string(),
    slugs: v.array(v.string()),
    includeStudentResults: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<BackfillSummary> => {
    const summary: BackfillSummary = {
      processedProfiles: 0,
      processedInstructors: 0,
      processedPortfolioImages: 0,
      processedStudentResults: 0,
      skipped: 0,
      errors: [],
    };

    // Normalize origin
    let sourceOrigin = args.baseUrl;
    try {
      sourceOrigin = new URL(sourceOrigin).origin;
    } catch {
      sourceOrigin = sourceOrigin;
    }

    const maxItems = args.limit ?? Number.POSITIVE_INFINITY;
    let processedCount = 0;

    const abs = (url?: string): string | undefined => {
      if (!url) return undefined;
      if (/^https?:\/\//i.test(url)) return url;
      const base = sourceOrigin.replace(/\/$/, "");
      const path = url.startsWith("/") ? url : `/${url}`;
      return `${base}${path}`;
    };

    const contentTypeForPath = (p: string): string => {
      const s = p.toLowerCase();
      if (s.endsWith(".png")) return "image/png";
      if (s.endsWith(".webp")) return "image/webp";
      if (s.endsWith(".gif")) return "image/gif";
      if (s.endsWith(".svg") || s.endsWith(".svgz")) return "image/svg+xml";
      return "image/jpeg";
    };

    const uploadFromUrl = async (src: string): Promise<{ storageId: string; url: string } | { error: string }> => {
      try {
        const r = await fetch(src);
        if (!r.ok) return { error: `GET ${r.status}` };
        const buf = await r.arrayBuffer();
        const postUrl = await ctx.runMutation(api.instructors.generateInstructorUploadUrl, {} as any);
        const ct = contentTypeForPath(src);
        const up = await fetch(postUrl, { method: "POST", headers: { "Content-Type": ct }, body: buf });
        if (!up.ok) return { error: `POST ${up.status}` };
        const { storageId } = (await up.json()) as { storageId: string };
        const url = (await ctx.runQuery(api.instructors.getStorageUrl, { storageId } as any)) ?? `convex://storage/${storageId}`;
        return { storageId, url };
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    };

    const [profiles, instructors] = await Promise.all([
      ctx.runQuery(internal.instructors.listInstructorProfilesAll, {}),
      ctx.runQuery(internal.instructors.listInstructorsAll, {}),
    ]);

    const allowed = new Set(args.slugs.map((s) => s.trim()).filter(Boolean));
    const bySlug = new Map<string, any>();
    for (const inst of instructors as any[]) {
      if (inst.slug && allowed.has(inst.slug)) bySlug.set(inst.slug, inst);
    }

    // Process profiles for selected slugs
    for (const profile of (profiles as any[])) {
      if (processedCount >= maxItems) break;
      const slug: string | undefined = profile.slug;
      if (!slug || !allowed.has(slug)) continue;
      try {
        const inst = bySlug.get(slug);

        // Profile image
        if (!profile.profileImageStorageId && profile.profileImageUrl) {
          const src = abs(profile.profileImageUrl);
          if (src) {
            const uploaded = await uploadFromUrl(src);
            if (!("error" in uploaded)) {
              await ctx.runMutation(internal.instructors.internalPatchInstructorProfileImageBySlug, {
                slug,
                storageId: uploaded.storageId,
                url: uploaded.url,
              } as any);
              if (inst?._id) {
                await ctx.runMutation(internal.instructors.internalPatchInstructorProfileImageById, {
                  instructorId: inst._id,
                  storageId: uploaded.storageId,
                  url: uploaded.url,
                } as any);
                summary.processedInstructors += 1;
              }
              summary.processedProfiles += 1;
            } else {
              summary.errors.push({ kind: "profile", id: slug || "unknown", message: `upload failed for ${src}: ${uploaded.error}` });
            }
          }
          processedCount++;
        }

        // Portfolio images
        const urls: string[] = (profile.portfolioImages ?? []) as string[];
        const sids: string[] = (profile.portfolioImageStorageIds ?? []) as string[];
        const toProcess: number[] = urls.map((_, i) => i).filter((i) => !sids[i] && urls[i]);
        if (toProcess.length > 0) {
          const newUrls = [...urls];
          const newSids = [...sids];
          for (const i of toProcess) {
            if (processedCount >= maxItems) break;
            const src = abs(urls[i]);
            if (src) {
              const uploaded = await uploadFromUrl(src);
              if (!("error" in uploaded)) {
                newUrls[i] = uploaded.url;
                newSids[i] = uploaded.storageId;
                summary.processedPortfolioImages += 1;
              } else {
                summary.errors.push({ kind: "portfolio", id: `${slug || "unknown"}[${i}]`, message: `upload failed for ${src}: ${uploaded.error}` });
              }
            }
            processedCount++;
          }
          if (toProcess.length > 0) {
            await ctx.runMutation(internal.instructors.internalPatchInstructorPortfolioBySlug, {
              slug,
              storageIds: newSids,
              urls: newUrls,
            } as any);
            if (inst?._id) {
              await ctx.runMutation(internal.instructors.internalPatchInstructorPortfolioById, {
                instructorId: inst._id,
                storageIds: newSids,
                urls: newUrls,
              } as any);
            }
          }
        }
      } catch (e) {
        summary.errors.push({ kind: "profile", id: slug || "unknown", message: e instanceof Error ? e.message : String(e) });
        summary.skipped += 1;
      }
    }

    if (args.includeStudentResults !== false) {
      const studentResults = await ctx.runQuery(internal.instructors.listStudentResultsAll, {});
      // Map instructorId to slug for filtering
      const allowedInstructorIds = new Set(
        Array.from(bySlug.values()).map((i: any) => i?._id).filter(Boolean)
      );
      for (const r of studentResults as any[]) {
        if (processedCount >= maxItems) break;
        try {
          if (!allowedInstructorIds.has(r.instructorId)) continue;
          if (!r.imageStorageId && r.imageUrl) {
            const src = abs(r.imageUrl);
            if (src) {
              const uploaded = await uploadFromUrl(src);
              if (!("error" in uploaded)) {
                await ctx.runMutation(internal.instructors.internalPatchStudentResultImage, {
                  studentResultId: r._id,
                  storageId: uploaded.storageId,
                  url: uploaded.url,
                } as any);
                summary.processedStudentResults += 1;
              } else {
                summary.errors.push({ kind: "studentResult", id: r._id, message: `upload failed for ${src}: ${uploaded.error}` });
              }
            }
            processedCount++;
          }
        } catch (e) {
          summary.errors.push({ kind: "studentResult", id: r._id, message: e instanceof Error ? e.message : String(e) });
          summary.skipped += 1;
        }
      }
    }

    return summary;
  },
});

export const getInstructorByUserIdExternal = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const instructor = await ctx.db
      .query("instructors")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();
    if (!instructor) return null;
    const profileImageUrl = await getFreshProfileUrl(ctx, instructor.profileImageStorageId, instructor.profileImageUrl);
    return { ...instructor, profileImageUrl };
  },
});

async function isAdminUser(ctx: QueryCtx, userId: string): Promise<boolean> {
  const user = await ctx.db
    .query("users")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .first();
  return user?.role === "admin";
}

export const listInstructorsInternal = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const user = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
      .first();
    if (user?.role !== "admin") throw new Error("Forbidden");
    const instructors = await ctx.db
      .query("instructors")
      .withIndex("by_deletedAt", (q) => q.eq("deletedAt", undefined))
      .collect();
    return Promise.all(
      instructors.map(async (inst) => {
        const profileImageUrl = await getFreshProfileUrl(ctx, inst.profileImageStorageId, inst.profileImageUrl);
        return { ...inst, profileImageUrl };
      })
    );
  },
});

export const listInstructorProfilesInternal = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const user = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
      .first();
    if (user?.role !== "admin") throw new Error("Forbidden");
    return await ctx.db.query("instructorProfiles").collect();
  },
});

export const listStudentResultsInternal = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const user = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
      .first();
    if (user?.role !== "admin") throw new Error("Forbidden");
    return await ctx.db.query("studentResults").collect();
  },
});

/** Returns the instructor matching the given userId, or null if not authenticated. */
export const getInstructorByUserId = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return null;
    }
    const instructor = await ctx.db
      .query("instructors")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();
    if (!instructor) return null;
    const profileImageUrl = await getFreshProfileUrl(ctx, instructor.profileImageStorageId, instructor.profileImageUrl);
    return { ...instructor, profileImageUrl };
  },
});

export const getCurrentInstructor = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return null;
    }
    const instructor = await ctx.db
      .query("instructors")
      .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
      .first();
    if (!instructor) return null;
    const profileImageUrl = await getFreshProfileUrl(ctx, instructor.profileImageStorageId, instructor.profileImageUrl);
    return { ...instructor, profileImageUrl };
  },
});

export const getInstructorByEmail = query({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return null;
    }
    const instructor = await ctx.db
      .query("instructors")
      .withIndex("by_email", (q) => q.eq("email", args.email.toLowerCase()))
      .first();
    if (!instructor) return null;
    const profileImageUrl = await getFreshProfileUrl(ctx, instructor.profileImageStorageId, instructor.profileImageUrl);
    return { ...instructor, profileImageUrl };
  },
});

/** Returns the instructor document by id, or null if not authenticated. */
export const getInstructorById = query({
  args: { id: v.id("instructors") },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return null;
    }
    const instructor = await ctx.db.get(args.id);
    if (!instructor) return null;
    const profileImageUrl = await getFreshProfileUrl(ctx, instructor.profileImageStorageId, instructor.profileImageUrl);
    return { ...instructor, profileImageUrl };
  },
});

export const getInstructorNameById = query({
  args: { id: v.id("instructors") },
  handler: async (ctx, args) => {
    const instructor = await ctx.db.get(args.id);
    if (!instructor) return null;
    return instructor.name ?? null;
  },
});

/** Returns non-deleted instructors matching the given ids. */
export const getInstructorsByIds = query({
  args: { ids: v.array(v.id("instructors")) },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return [];
    }
    
    const instructors = await Promise.all(
      args.ids.map((id) => ctx.db.get(id))
    );
    
    const filtered = instructors.filter((inst): inst is Doc<"instructors"> => inst !== null && !inst.deletedAt);
    return Promise.all(
      filtered.map(async (inst) => {
        const profileImageUrl = await getFreshProfileUrl(ctx, inst.profileImageStorageId, inst.profileImageUrl);
        return { ...inst, profileImageUrl };
      })
    );
  },
});

/** Returns the instructor profile matching the given slug. */
export const getInstructorBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const profile = await ctx.db
      .query("instructorProfiles")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();
    if (!profile) {
      // Fallback: some environments may have only an instructors row without a separate profile
      const instructorOnly = await ctx.db
        .query("instructors")
        .withIndex("by_slug", (q) => q.eq("slug", args.slug))
        .first();
      if (!instructorOnly) return null;

      const fallbackProfileImageUrl = await getFreshProfileUrl(
        ctx,
        instructorOnly.profileImageStorageId,
        instructorOnly.profileImageUrl
      );
      const fallbackPortfolioImages = await getFreshPortfolioUrls(
        ctx,
        instructorOnly.portfolioImageStorageIds,
        instructorOnly.portfolioImages
      );
      // Strip sensitive fields and return a profile-like object with injected instructorId
      const { googleRefreshToken, ...safe } = instructorOnly as any;
      return {
        ...safe,
        profileImageUrl: fallbackProfileImageUrl,
        portfolioImages: fallbackPortfolioImages,
        instructorId: instructorOnly._id,
      } as any;
    }
    // Also fetch the instructor by slug to expose its _id for downstream queries
    const instructor = await ctx.db
      .query("instructors")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();
    const profileImageUrl = await getFreshProfileUrl(ctx, profile.profileImageStorageId, profile.profileImageUrl);
    const portfolioImages = await getFreshPortfolioUrls(ctx, profile.portfolioImageStorageIds, profile.portfolioImages);
    return {
      ...profile,
      profileImageUrl,
      portfolioImages,
      instructorId: instructor?._id,
      // Surface inventory for purchase/waitlist logic; default to 0 when missing
      oneOnOneInventory: (instructor as any)?.oneOnOneInventory ?? 0,
      groupInventory: (instructor as any)?.groupInventory ?? 0,
    } as any;
  },
});

/** Returns all non-deleted instructors. Requires authentication. */
export const listInstructors = query({
  handler: async (ctx) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return [];
    }
    const instructors = await ctx.db
      .query("instructors")
      .withIndex("by_deletedAt", (q) => q.eq("deletedAt", undefined))
      .collect();
    return Promise.all(
      instructors.map(async (inst) => {
        const profileImageUrl = await getFreshProfileUrl(ctx, inst.profileImageStorageId, inst.profileImageUrl);
        return { ...inst, profileImageUrl };
      })
    );
  },
});

/** Returns active instructors with inventory, excluding sensitive fields. Requires authentication. */
export const getActiveInstructors = query({
  handler: async (ctx) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return [];
    }
    const instructors = await ctx.db
      .query("instructors")
      .withIndex("by_deletedAt", (q) => q.eq("deletedAt", undefined))
      .filter((q) => q.gt(q.field("oneOnOneInventory"), 0))
      .collect();
    const refreshed = await Promise.all(
      instructors.map(async (inst) => {
        const profileImageUrl = await getFreshProfileUrl(ctx, inst.profileImageStorageId, inst.profileImageUrl);
        return { ...inst, profileImageUrl };
      })
    );
    return refreshed.map(({ googleRefreshToken, ...rest }) => rest);
  },
});

/** Returns publicly available instructors (non-deleted), with a computed sold-out flag per their active offerings. */
export const getPublicInstructors = query({
  handler: async (ctx) => {
    // Fetch non-deleted instructors; then filter to public-visible ones only
    const all = await ctx.db
      .query("instructors")
      .withIndex("by_deletedAt", (q) => q.eq("deletedAt", undefined))
      .collect();
    // Filter to public-visible instructors. Treat undefined isActive as active (legacy data)
    const publicVisible = all.filter((inst) => inst.isActive !== false);

    const refreshed = await Promise.all(
      publicVisible.map(async (inst) => {
        const profileImageUrl = await getFreshProfileUrl(
          ctx,
          inst.profileImageStorageId,
          inst.profileImageUrl
        );

        // Determine offered mentorship types from active products
        const products = await ctx.db
          .query("products")
          .withIndex("by_instructorId", (q) => q.eq("instructorId", inst._id))
          .collect();

        const activeProducts = products.filter((p) => p.active && !p.deletedAt);
        const offeredTypes = Array.from(
          new Set(
            activeProducts
              .map((p) => p.mentorshipType)
              .filter((t): t is string => typeof t === "string")
          )
        );

        let isCompletelySoldOut = false;
        if (offeredTypes.length > 0) {
          const oneOnOneInv = (inst as any).oneOnOneInventory ?? 0;
          const groupInv = (inst as any).groupInventory ?? 0;
          isCompletelySoldOut = offeredTypes.every((t) => {
            if (t === "one-on-one") return oneOnOneInv === 0;
            if (t === "group") return groupInv === 0;
            // Unknown type: treat as not sold out
            return false;
          });
        }

        return { ...inst, profileImageUrl, isCompletelySoldOut };
      })
    );

    // Strip sensitive fields
    return refreshed.map(({ googleRefreshToken, ...rest }) => rest);
  },
});

/** Returns all non-deleted instructors for admin with inventory data, excluding sensitive fields. */
export const getInstructorsForAdmin = query({
  handler: async (ctx) => {
    const instructors = await ctx.db
      .query("instructors")
      .withIndex("by_deletedAt", (q) => q.eq("deletedAt", undefined))
      .collect();
    const refreshed = await Promise.all(
      instructors.map(async (inst) => {
        const profileImageUrl = await getFreshProfileUrl(ctx, inst.profileImageStorageId, inst.profileImageUrl);
        return { ...inst, profileImageUrl };
      })
    );
    return refreshed.map(({ googleRefreshToken, ...rest }) => rest);
  },
});

/** Returns an instructor by slug from the instructors table (not instructorProfiles). */
export const getInstructorBySlugForAdmin = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return null;
    }
    const isAdmin = await isAdminUser(ctx, user.subject);
    if (!isAdmin) {
      return null;
    }
    const instructor = await ctx.db
      .query("instructors")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();
    if (!instructor) {
      return null;
    }
    const profileImageUrl = await getFreshProfileUrl(ctx, instructor.profileImageStorageId, instructor.profileImageUrl);
    return { ...instructor, profileImageUrl };
  },
});

/** Creates a new instructor or returns the existing instructor id if one already exists. */
export const createInstructor = mutation({
  args: {
    userId: v.string(),
    name: v.optional(v.string()),
    slug: v.optional(v.string()),
    email: v.optional(v.string()),
    discordVoiceChannelUrl: v.optional(v.string()),
    googleCalendarId: v.optional(v.string()),
    googleRefreshToken: v.optional(v.string()),
    timeZone: v.optional(v.string()),
    workingHours: v.optional(v.any()),
    maxActiveStudents: v.optional(v.number()),
    bio: v.optional(v.string()),
    pricing: v.optional(v.string()),
    oneOnOneInventory: v.optional(v.number()),
    groupInventory: v.optional(v.number()),
    tagline: v.optional(v.string()),
    background: v.optional(v.array(v.string())),
    specialties: v.optional(v.array(v.string())),
    portfolioImages: v.optional(v.array(v.string())),
    socials: v.optional(v.any()),
    isActive: v.optional(v.boolean()),
    isNew: v.optional(v.boolean()),
    profileImageUrl: v.optional(v.string()),
    profileImageUploadPath: v.optional(v.string()),
    profileImageStorageId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("instructors")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();
    
    if (existing) {
      return existing._id;
    }

    if (!args.name && !args.email && !args.slug) {
      throw new Error("At least one of name, email, or slug is required");
    }

    if (args.slug) {
      const existingBySlug = await ctx.db
        .query("instructors")
        .withIndex("by_slug", (q) => q.eq("slug", args.slug!))
        .first();
      
      if (existingBySlug) {
        throw new Error("Slug already exists");
      }
    }
    
    return await ctx.db.insert("instructors", {
      userId: args.userId,
      name: args.name ?? undefined,
      slug: args.slug ?? undefined,
      email: args.email ?? undefined,
      discordVoiceChannelUrl: args.discordVoiceChannelUrl ?? undefined,
      tagline: args.tagline ?? undefined,
      background: args.background ?? undefined,
      portfolioImages: args.portfolioImages ?? undefined,
      socials: args.socials ?? undefined,
      isActive: args.isActive ?? true,
      isNew: args.isNew ?? true,
      profileImageUrl: args.profileImageUrl ?? undefined,
      profileImageUploadPath: args.profileImageUploadPath ?? undefined,
      profileImageStorageId: args.profileImageStorageId ?? undefined,
      maxActiveStudents: args.maxActiveStudents ?? 10,
      oneOnOneInventory: args.oneOnOneInventory ?? 0,
      groupInventory: args.groupInventory ?? 0,
    });
  },
});

export const migrateInstructor = mutation({
  args: {
    userId: v.string(),
    name: v.optional(v.string()),
    slug: v.optional(v.string()),
    email: v.optional(v.string()),
    bio: v.optional(v.string()),
    tagline: v.optional(v.string()),
    background: v.optional(v.array(v.string())),
    specialties: v.optional(v.array(v.string())),
    portfolioImages: v.optional(v.array(v.string())),
    socials: v.optional(v.any()),
    isActive: v.optional(v.boolean()),
    isNew: v.optional(v.boolean()),
    profileImageUrl: v.optional(v.string()),
    profileImageUploadPath: v.optional(v.string()),
    profileImageStorageId: v.optional(v.string()),
    legacyInstructorRef: v.optional(v.string()),
    googleCalendarId: v.optional(v.string()),
    googleRefreshToken: v.optional(v.string()),
    timeZone: v.optional(v.string()),
    workingHours: v.optional(v.any()),
    maxActiveStudents: v.optional(v.number()),
    pricing: v.optional(v.string()),
    oneOnOneInventory: v.optional(v.number()),
    groupInventory: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existingByUserId = await ctx.db
      .query("instructors")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();

    if (existingByUserId) {
      const updates: Record<string, unknown> = {};
      if (args.name !== undefined) updates.name = args.name;
      if (args.slug !== undefined) updates.slug = args.slug;
      if (args.email !== undefined) updates.email = args.email;
      if (args.bio !== undefined) updates.bio = args.bio;
      if (args.tagline !== undefined) updates.tagline = args.tagline;
      if (args.background !== undefined) updates.background = args.background;
      if (args.specialties !== undefined) updates.specialties = args.specialties;
      if (args.portfolioImages !== undefined) updates.portfolioImages = args.portfolioImages;
      if (args.socials !== undefined) updates.socials = args.socials;
      if (args.isActive !== undefined) updates.isActive = args.isActive;
      if (args.isNew !== undefined) updates.isNew = args.isNew;
      if (args.profileImageUrl !== undefined) updates.profileImageUrl = args.profileImageUrl;
      if (args.profileImageUploadPath !== undefined) updates.profileImageUploadPath = args.profileImageUploadPath;
      if (args.profileImageStorageId !== undefined) updates.profileImageStorageId = args.profileImageStorageId;
      if (args.legacyInstructorRef !== undefined) updates.legacyId = args.legacyInstructorRef;
      if (args.googleCalendarId !== undefined) updates.googleCalendarId = args.googleCalendarId;
      if (args.googleRefreshToken !== undefined) updates.googleRefreshToken = args.googleRefreshToken;
      if (args.timeZone !== undefined) updates.timeZone = args.timeZone;
      if (args.workingHours !== undefined) updates.workingHours = args.workingHours;
      if (args.maxActiveStudents !== undefined) updates.maxActiveStudents = args.maxActiveStudents;
      if (args.pricing !== undefined) updates.pricing = args.pricing;
      if (args.oneOnOneInventory !== undefined) updates.oneOnOneInventory = args.oneOnOneInventory;
      if (args.groupInventory !== undefined) updates.groupInventory = args.groupInventory;

      if (Object.keys(updates).length > 0) {
        await ctx.db.patch(existingByUserId._id, updates);
      }
      return { action: "updated", id: existingByUserId._id };
    }

    if (!args.name && !args.email && !args.slug) {
      throw new Error("At least one of name, email, or slug is required");
    }

    const id = await ctx.db.insert("instructors", {
      userId: args.userId,
      name: args.name ?? undefined,
      slug: args.slug ?? undefined,
      email: args.email ?? undefined,
      bio: args.bio ?? undefined,
      tagline: args.tagline ?? undefined,
      background: args.background ?? undefined,
      specialties: args.specialties ?? undefined,
      portfolioImages: args.portfolioImages ?? undefined,
      socials: args.socials ?? undefined,
      isActive: args.isActive ?? true,
      isNew: args.isNew ?? true,
      profileImageUrl: args.profileImageUrl ?? undefined,
      profileImageUploadPath: args.profileImageUploadPath ?? undefined,
      profileImageStorageId: args.profileImageStorageId ?? undefined,
      googleCalendarId: args.googleCalendarId ?? undefined,
      googleRefreshToken: args.googleRefreshToken ?? undefined,
      timeZone: args.timeZone ?? undefined,
      workingHours: args.workingHours ?? undefined,
      maxActiveStudents: args.maxActiveStudents ?? 10,
      pricing: args.pricing ?? undefined,
      oneOnOneInventory: args.oneOnOneInventory ?? 0,
      groupInventory: args.groupInventory ?? 0,
    });

    // If legacy reference provided, patch after insert to avoid type mismatches across environments.
    if (args.legacyInstructorRef !== undefined) {
      // Patch both possible legacy fields to be compatible with deployments
      await ctx.db.patch(id as any, { legacyInstructorRef: args.legacyInstructorRef, legacyId: args.legacyInstructorRef } as any);
    }

    return { action: "inserted", id };
  },
});

/** Updates the specified instructor fields and returns the updated document. */
export const updateInstructor = mutation({
  args: {
    id: v.id("instructors"),
    userId: v.optional(v.string()),
    name: v.optional(v.string()),
    slug: v.optional(v.string()),
    // Allow clearing via null from API layer
    email: v.optional(v.union(v.string(), v.null())),
    googleCalendarId: v.optional(v.union(v.string(), v.null())),
    googleRefreshToken: v.optional(v.union(v.string(), v.null())),
    googleAvailabilityCalendarIds: v.optional(v.array(v.string())),
    discordVoiceChannelUrl: v.optional(v.union(v.string(), v.null())),
    timeZone: v.optional(v.string()),
    workingHours: v.optional(v.any()),
    maxActiveStudents: v.optional(v.number()),
    bio: v.optional(v.union(v.string(), v.null())),
    pricing: v.optional(v.string()),
    oneOnOneInventory: v.optional(v.number()),
    groupInventory: v.optional(v.number()),
    tagline: v.optional(v.union(v.string(), v.null())),
    background: v.optional(v.array(v.string())),
    portfolioImages: v.optional(v.array(v.string())),
    socials: v.optional(v.union(v.any(), v.null())),
    isActive: v.optional(v.boolean()),
    isNew: v.optional(v.boolean()),
    profileImageUrl: v.optional(v.union(v.string(), v.null())),
    profileImageUploadPath: v.optional(v.union(v.string(), v.null())),
    profileImageStorageId: v.optional(v.string()),
    specialties: v.optional(v.array(v.string())),
    legacyInstructorRef: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const user = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
      .first();

    if (user?.role !== "admin") {
      const instructor = await ctx.db.get(args.id);
      if (!instructor || instructor.userId !== identity.subject) {
        throw new Error("Forbidden");
      }
      const { id, ...updates } = args;
      const allowedFields: (keyof typeof updates)[] = [
        "googleRefreshToken",
        "googleCalendarId",
        "googleAvailabilityCalendarIds",
        "timeZone",
      ];
      const filteredUpdates: Record<string, any> = {};
      for (const key of allowedFields) {
        if (key in updates) {
          filteredUpdates[key] = (updates as any)[key];
        }
      }
      const nullableCalendarKeys: (keyof typeof updates)[] = ["googleCalendarId", "googleRefreshToken"];
      for (const key of nullableCalendarKeys) {
        if (filteredUpdates[key] === null) {
          filteredUpdates[key] = undefined;
        }
      }
      await ctx.db.patch(id, { ...filteredUpdates, updatedAt: Date.now() });
      return await ctx.db.get(id);
    }

    const { id, ...updates } = args;
    const nullableKeys: (keyof typeof updates)[] = [
      "email",
      "bio",
      "tagline",
      "profileImageUrl",
      "profileImageUploadPath",
      "socials",
      "googleCalendarId",
      "googleRefreshToken",
      "discordVoiceChannelUrl",
      "legacyInstructorRef",
    ];
    for (const key of nullableKeys) {
      if ((updates as any)[key] === null) {
        (updates as any)[key] = undefined;
      }
    }
    await ctx.db.patch(id, { ...(updates as any), updatedAt: Date.now() });
    return await ctx.db.get(id);
  },
});

/** Soft-deletes an instructor by setting deletedAt to the current timestamp. Requires admin role. */
export const deleteInstructor = mutation({
  args: { id: v.id("instructors") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const user = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
      .first();
    if (user?.role !== "admin") throw new Error("Forbidden");
    await ctx.db.patch(args.id, { deletedAt: Date.now() });
  },
});

/** Permanently hard-deletes an instructor. Use with caution - this is irreversible. Requires admin role. */
export const hardDeleteInstructor = mutation({
  args: { id: v.id("instructors") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const user = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
      .first();
    if (user?.role !== "admin") throw new Error("Forbidden");
    await ctx.db.delete(args.id);
  },
});

/** Decrements the oneOnOne or group inventory for an instructor by 1. */
export const decrementInventory = mutation({
  args: { 
    id: v.id("instructors"), 
    type: v.union(v.literal("oneOnOne"), v.literal("group")) 
  },
  handler: async (ctx, args) => {
    const instructor = await ctx.db.get(args.id);
    if (!instructor) {
      throw new Error("Instructor not found");
    }
    
    const field = args.type === "oneOnOne" ? "oneOnOneInventory" : "groupInventory";
    const currentValue = instructor[field] as number;
    
    if (currentValue <= 0) {
      throw new Error("No inventory available");
    }
    
    await ctx.db.patch(args.id, { [field]: currentValue - 1 });
    return await ctx.db.get(args.id);
  },
});

/** Increments the oneOnOne or group inventory for an instructor by 1. */
export const incrementInventory = mutation({
  args: { 
    id: v.id("instructors"), 
    type: v.union(v.literal("oneOnOne"), v.literal("group")) 
  },
  handler: async (ctx, args) => {
    const instructor = await ctx.db.get(args.id);
    if (!instructor) {
      throw new Error("Instructor not found");
    }
    
    const field = args.type === "oneOnOne" ? "oneOnOneInventory" : "groupInventory";
    const currentValue = instructor[field] as number;
    
    await ctx.db.patch(args.id, { [field]: currentValue + 1 });
    return await ctx.db.get(args.id);
  },
});

/** Creates a testimonial for an instructor profile. Admin role enforced. */
export const createTestimonial = mutation({
  args: {
    instructorId: v.id("instructors"),
    name: v.string(),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const user = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
      .first();
    if (user?.role !== "admin") throw new Error("Forbidden");

    const id = await ctx.db.insert("instructorTestimonials", {
      instructorId: args.instructorId,
      name: args.name,
      text: args.text,
      createdAt: Date.now(),
    });
    const testimonial = await ctx.db.get(id);
    if (!testimonial) throw new Error("Failed to create testimonial");
    return testimonial;
  },
});

/** Creates a student result with an image URL for an instructor profile. Admin role enforced. */
export const createStudentResult = mutation({
  args: {
    instructorId: v.id('instructors'),
    imageUrl: v.string(),
    imageUploadPath: v.optional(v.string()),
    studentName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const user = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
      .first();
    if (user?.role !== "admin") throw new Error("Forbidden");

    const id = await ctx.db.insert('studentResults', {
      instructorId: args.instructorId,
      imageUrl: args.imageUrl,
      imageUploadPath: args.imageUploadPath,
      studentName: args.studentName,
    });
    const result = await ctx.db.get(id);
    if (!result) throw new Error("Failed to create student result");

    return result;
  },
});

export const createStudentResultWithStorage = mutation({
  args: {
    instructorId: v.id('instructors'),
    imageUrl: v.string(),
    imageStorageId: v.string(),
    studentName: v.optional(v.string()),
    createdBy: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const user = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
      .first();
    if (user?.role !== "admin") throw new Error("Forbidden");

    const id = await ctx.db.insert('studentResults', {
      instructorId: args.instructorId,
      imageUrl: args.imageUrl,
      imageStorageId: args.imageStorageId,
      studentName: args.studentName,
      createdBy: args.createdBy,
      createdAt: Date.now(),
    });
    const result = await ctx.db.get(id);
    if (!result) throw new Error("Failed to create student result");

    return result;
  },
});

/** Idempotent upsert for instructor profiles, keyed on slug. */
export const upsertInstructorProfile = mutation({
  args: {
    slug: v.string(),
    name: v.string(),
    tagline: v.optional(v.string()),
    bio: v.optional(v.string()),
    specialties: v.optional(v.array(v.string())),
    background: v.optional(v.array(v.string())),
    profileImageUrl: v.optional(v.string()),
    portfolioImages: v.optional(v.array(v.string())),
    socials: v.optional(v.any()),
    isActive: v.boolean(),
    isNew: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('instructorProfiles')
      .withIndex('by_slug', (q) => q.eq('slug', args.slug))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        name: args.name,
        tagline: args.tagline,
        bio: args.bio,
        specialties: args.specialties,
        background: args.background,
        profileImageUrl: args.profileImageUrl,
        portfolioImages: args.portfolioImages,
        socials: args.socials,
        isActive: args.isActive,
        isNew: args.isNew,
      });
      return existing._id;
    }

    return await ctx.db.insert('instructorProfiles', {
      slug: args.slug,
      name: args.name,
      tagline: args.tagline,
      bio: args.bio,
      specialties: args.specialties,
      background: args.background,
      profileImageUrl: args.profileImageUrl,
      portfolioImages: args.portfolioImages,
      socials: args.socials,
      isActive: args.isActive,
      isNew: args.isNew,
    });
  },
});

/** Idempotent upsert for instructor testimonials, keyed on instructorId + name + text. */
export const upsertInstructorTestimonial = mutation({
  args: {
    instructorId: v.string(),
    name: v.string(),
    text: v.string(),
    role: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('instructorTestimonials')
      .withIndex('by_instructorId', (q) => q.eq('instructorId', args.instructorId))
      .filter((q) => q.and(
        q.eq(q.field('name'), args.name),
        q.eq(q.field('text'), args.text)
      ))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        role: args.role,
      });
      return existing._id;
    }

    return await ctx.db.insert('instructorTestimonials', {
      instructorId: args.instructorId,
      name: args.name,
      text: args.text,
      role: args.role,
    });
  },
});

/** Idempotent upsert for student results, keyed on instructorId + imageUrl. */
export const upsertStudentResult = mutation({
  args: {
    instructorId: v.string(),
    imageUrl: v.string(),
    studentName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('studentResults')
      .withIndex('by_instructorId', (q) => q.eq('instructorId', args.instructorId))
      .filter((q) => q.eq(q.field('imageUrl'), args.imageUrl))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        studentName: args.studentName,
        createdAt: Date.now(),
      });
      return existing._id;
    }

    const id = await ctx.db.insert('studentResults', {
      instructorId: args.instructorId,
      imageUrl: args.imageUrl,
      studentName: args.studentName,
      createdAt: Date.now(),
    });

    return id;
  },
});

type ImageType = "profile" | "portfolio" | "result";

function buildStorageKey(instructorSlug: string, type: ImageType, storageId: string): string {
  const typeFolder = type === "profile" ? "profile" : type === "portfolio" ? "portfolio" : "results";
  return `instructors/${instructorSlug}/${typeFolder}/${storageId}`;
}

export const generateInstructorUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

export const uploadInstructorProfileImage = mutation({
  args: {
    instructorId: v.id("instructors"),
    storageId: v.string(),
    contentType: v.string(),
  },
  handler: async (ctx, args) => {
    const instructor = await ctx.db.get(args.instructorId);
    if (!instructor || !instructor.slug) {
      throw new Error("Instructor not found or missing slug");
    }

    const storageKey = buildStorageKey(instructor.slug, "profile", args.storageId);
    const url = await ctx.storage.getUrl(args.storageId as Id<"_storage">);
    if (!url) {
      throw new Error("Failed to get URL for storage ID");
    }

    await ctx.db.patch(args.instructorId, {
      profileImageUrl: url,
      profileImageStorageId: args.storageId,
    });

    return { storageId: args.storageId, url, storageKey };
  },
});

export const uploadInstructorPortfolioImage = mutation({
  args: {
    instructorId: v.id("instructors"),
    storageId: v.string(),
    contentType: v.string(),
    index: v.number(),
  },
  handler: async (ctx, args) => {
    const instructor = await ctx.db.get(args.instructorId);
    if (!instructor || !instructor.slug) {
      throw new Error("Instructor not found or missing slug");
    }

    const url = await ctx.storage.getUrl(args.storageId as Id<"_storage">);
    if (!url) {
      throw new Error("Failed to get URL for storage ID");
    }

    const currentPortfolio = instructor.portfolioImages ?? [];
    const currentStorageIds = instructor.portfolioImageStorageIds ?? [];

    const newPortfolioImages = [...currentPortfolio];
    const newStorageIds = [...currentStorageIds];

    while (newPortfolioImages.length <= args.index) {
      newPortfolioImages.push("");
      newStorageIds.push("");
    }

    newPortfolioImages[args.index] = url;
    newStorageIds[args.index] = args.storageId;

    await ctx.db.patch(args.instructorId, {
      portfolioImages: newPortfolioImages,
      portfolioImageStorageIds: newStorageIds,
    });

    return { storageId: args.storageId, url, index: args.index };
  },
});

export const uploadStudentResultImage = mutation({
  args: {
    studentResultId: v.id("studentResults"),
    storageId: v.string(),
    contentType: v.string(),
  },
  handler: async (ctx, args) => {
    const studentResult = await ctx.db.get(args.studentResultId);
    if (!studentResult) {
      throw new Error("Student result not found");
    }

    const url = await ctx.storage.getUrl(args.storageId as Id<"_storage">);
    if (!url) {
      throw new Error("Failed to get URL for storage ID");
    }

    await ctx.db.patch(args.studentResultId, {
      imageUrl: url,
      imageStorageId: args.storageId,
    });

    return { storageId: args.storageId, url };
  },
});

export const updateInstructorProfileImage = mutation({
  args: {
    instructorId: v.id("instructors"),
    storageId: v.string(),
  },
  handler: async (ctx, args) => {
    const instructor = await ctx.db.get(args.instructorId);
    if (!instructor) {
      throw new Error("Instructor not found");
    }

    const url = await ctx.storage.getUrl(args.storageId as Id<"_storage">);
    if (!url) {
      throw new Error("Failed to get URL for storage ID");
    }

    await ctx.db.patch(args.instructorId, {
      profileImageStorageId: args.storageId,
      profileImageUrl: url,
    });

    return { storageId: args.storageId, url };
  },
});

export const updateInstructorPortfolioImage = mutation({
  args: {
    instructorId: v.id("instructors"),
    storageId: v.string(),
    index: v.number(),
  },
  handler: async (ctx, args) => {
    const instructor = await ctx.db.get(args.instructorId);
    if (!instructor) {
      throw new Error("Instructor not found");
    }

    const url = await ctx.storage.getUrl(args.storageId as Id<"_storage">);
    if (!url) {
      throw new Error("Failed to get URL for storage ID");
    }

    const currentStorageIds = instructor.portfolioImageStorageIds ?? [];
    const newStorageIds = [...currentStorageIds];

    while (newStorageIds.length <= args.index) {
      newStorageIds.push("");
    }
    newStorageIds[args.index] = args.storageId;

    const currentUrls = instructor.portfolioImages ?? [];
    const newUrls = [...currentUrls];
    while (newUrls.length <= args.index) {
      newUrls.push("");
    }
    newUrls[args.index] = url;

    await ctx.db.patch(args.instructorId, {
      portfolioImageStorageIds: newStorageIds,
      portfolioImages: newUrls,
    });

    return { storageId: args.storageId, url, index: args.index };
  },
});

export const updateInstructorProfileStorageId = mutation({
  args: {
    instructorId: v.id("instructors"),
    storageId: v.string(),
    url: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const user = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
      .first();
    if (user?.role !== "admin") throw new Error("Forbidden");
    await ctx.db.patch(args.instructorId, {
      profileImageStorageId: args.storageId,
      profileImageUrl: args.url,
    });
    return { storageId: args.storageId, url: args.url };
  },
});

export const updateInstructorPortfolioStorageIds = mutation({
  args: {
    instructorId: v.id("instructors"),
    storageIds: v.array(v.string()),
    urls: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const user = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
      .first();
    if (user?.role !== "admin") throw new Error("Forbidden");
    await ctx.db.patch(args.instructorId, {
      portfolioImageStorageIds: args.storageIds,
      portfolioImages: args.urls,
    });
    return { storageIds: args.storageIds, urls: args.urls };
  },
});

export const updateStudentResultStorageId = mutation({
  args: {
    studentResultId: v.id("studentResults"),
    storageId: v.string(),
    url: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const user = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
      .first();
    if (user?.role !== "admin") throw new Error("Forbidden");

    const studentResult = await ctx.db.get(args.studentResultId);
    if (!studentResult) throw new Error("Student result not found");

    await ctx.db.patch(args.studentResultId, {
      imageStorageId: args.storageId,
      imageUrl: args.url,
    });

    return { storageId: args.storageId, url: args.url };
  },
});

export const updateInstructorProfileStorageIdForProfile = mutation({
  args: {
    slug: v.string(),
    storageId: v.string(),
    url: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const user = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
      .first();
    if (user?.role !== "admin") throw new Error("Forbidden");
    const profile = await ctx.db
      .query("instructorProfiles")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();

    if (!profile) {
      throw new Error("Instructor profile not found");
    }

    await ctx.db.patch(profile._id, {
      profileImageStorageId: args.storageId,
      profileImageUrl: args.url,
    });
    return { storageId: args.storageId, url: args.url };
  },
});

export const updateInstructorPortfolioStorageIdsForProfile = mutation({
  args: {
    slug: v.string(),
    storageIds: v.array(v.string()),
    urls: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const user = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
      .first();
    if (user?.role !== "admin") throw new Error("Forbidden");
    const profile = await ctx.db
      .query("instructorProfiles")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();

    if (!profile) {
      throw new Error("Instructor profile not found");
    }

    await ctx.db.patch(profile._id, {
      portfolioImageStorageIds: args.storageIds,
      portfolioImages: args.urls,
    });
    return { storageIds: args.storageIds, urls: args.urls };
  },
});

/** Returns all testimonials for a given instructor. */
export const getTestimonialsByInstructorId = query({
  args: { instructorId: v.id("instructors") },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return [];
    }
    return await ctx.db
      .query("instructorTestimonials")
      .withIndex("by_instructorId", (q) => q.eq("instructorId", args.instructorId))
      .collect();
  },
});

/** Returns all student results for a given instructor. */
export const getStudentResultsByInstructorId = query({
  args: { instructorId: v.id("instructors") },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return [];
    }
    return await ctx.db
      .query("studentResults")
      .withIndex("by_instructorId", (q) => q.eq("instructorId", args.instructorId))
      .collect();
  },
});

/** Returns a testimonial by ID, or null if not found/not owned by instructor. */
export const getTestimonialById = query({
  args: { id: v.id("instructorTestimonials"), instructorId: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return null;
    }
    const testimonial = await ctx.db.get(args.id);
    if (!testimonial || testimonial.instructorId !== args.instructorId) {
      return null;
    }
    return testimonial;
  },
});

export const getStudentResultById = query({
  args: { id: v.id("studentResults"), instructorId: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return null;
    }
    const result = await ctx.db.get(args.id);
    if (!result || result.instructorId !== args.instructorId) {
      return null;
    }
    return result;
  },
});

/** Updates instructor scheduling settings (timeZone, workingHours, and availability options). Requires admin role or self. */
export const updateInstructorSchedulingSettings = mutation({
  args: {
    id: v.id("instructors"),
    timeZone: v.optional(v.string()),
    workingHours: v.optional(v.any()),
    bufferMinutesBetweenSessions: v.optional(v.number()),
    minBookingLeadMinutes: v.optional(v.number()),
    maxBookingAdvanceDays: v.optional(v.number()),
    blockedDateRanges: v.optional(v.array(v.object({
      start: v.string(),
      end: v.string(),
      label: v.optional(v.string()),
    }))),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    
    const user = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
      .first();
    
    if (!user || (user.role !== "admin" && user.role !== "instructor")) {
      throw new Error("Forbidden");
    }
    
    if (user.role === "instructor") {
      const instructor = await ctx.db.get(args.id);
      if (!instructor || instructor.userId !== identity.subject) {
        throw new Error("Forbidden");
      }
    }
    
    const { id, ...updates } = args;
    await ctx.db.patch(id, updates);
    return await ctx.db.get(id);
  },
});

/** Returns students with session pack info for an instructor. */
export const getInstructorStudentsWithSessionInfo = query({
  args: { instructorId: v.id("instructors") },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return [];
    }
    
    const sessionPacks = await ctx.db
      .query("sessionPacks")
      .withIndex("by_instructorId", (q) => q.eq("instructorId", args.instructorId))
      .collect();
    
    const studentsMap = new Map<string, {
      userId: string;
      sessionPackId: string;
      totalSessions: number;
      remainingSessions: number;
      expiresAt: number | null;
      status: string;
    }>();
    
    for (const pack of sessionPacks) {
      if (!studentsMap.has(pack.userId) || pack.status === "active") {
        studentsMap.set(pack.userId, {
          userId: pack.userId,
          sessionPackId: pack._id,
          totalSessions: pack.totalSessions,
          remainingSessions: pack.remainingSessions,
          expiresAt: pack.expiresAt ?? null,
          status: pack.status,
        });
      }
    }
    
    const result = await Promise.all(
      Array.from(studentsMap.values()).map(async (m) => {
        const user = await ctx.db
          .query("users")
          .withIndex("by_userId", (q) => q.eq("userId", m.userId))
          .first();
        
        const sessions = await ctx.db
          .query("sessions")
          .withIndex("by_studentId", (q) => q.eq("studentId", m.userId))
.filter((q) => q.eq(q.field("instructorId"), args.instructorId))
          .collect();
        
        const completedSessions = sessions.filter(s => s.status === "completed");
        const lastSession = completedSessions.length > 0
          ? completedSessions.sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))[0]
          : null;
        
        return {
          userId: m.userId,
          email: user?.email ?? null,
          sessionPackId: m.sessionPackId,
          totalSessions: m.totalSessions,
          remainingSessions: m.remainingSessions,
          expiresAt: m.expiresAt,
          status: m.status,
          lastSessionCompletedAt: lastSession?.completedAt ?? null,
          completedSessionCount: completedSessions.length,
        };
      })
    );
    
    return result;
  },
});

/** Returns the session count for a user's session pack with an instructor. */
export const getUserSessionCountForInstructor = query({
  args: { userId: v.string(), instructorId: v.id("instructors") },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return null;
    }
    
    const sessionPacks = await ctx.db
      .query("sessionPacks")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .filter((q) => q.eq(q.field("instructorId"), args.instructorId))
      .collect();
    
    if (sessionPacks.length === 0) {
      return null;
    }
    
    const activePacks = sessionPacks.filter(p => p.status === "active");
    const pack = activePacks.length > 0 ? activePacks[0] : sessionPacks[0];
    
    return {
      sessionPackId: pack._id,
      totalSessions: pack.totalSessions,
      remainingSessions: pack.remainingSessions,
      expiresAt: pack.expiresAt ?? null,
      status: pack.status,
    };
  },
});

/** Returns detailed info about a student with all their sessions for an instructor. */
export const getStudentDetails = query({
  args: { 
    instructorId: v.id("instructors"),
    studentId: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return null;
    }

    const instructor = await ctx.db.get(args.instructorId);
    if (!instructor || instructor.userId !== user.tokenIdentifier) {
      return null;
    }

    const studentUser = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", args.studentId))
      .first();

    if (!studentUser) {
      return null;
    }

    const sessionPacks = await ctx.db
      .query("sessionPacks")
      .withIndex("by_userId", (q) => q.eq("userId", args.studentId))
      .filter((q) => q.eq(q.field("instructorId"), args.instructorId))
      .collect();

    const activePacks = sessionPacks.filter(p => p.status === "active");
    const pack = activePacks.length > 0 ? activePacks[0] : sessionPacks[0];

    const allSessions = await ctx.db
      .query("sessions")
      .withIndex("by_instructorId", (q) => q.eq("instructorId", args.instructorId))
      .filter((q) => q.eq(q.field("studentId"), args.studentId))
      .collect();

    const sortedSessions = allSessions.sort((a, b) => b.scheduledAt - a.scheduledAt);

    return {
      userId: args.studentId,
      email: studentUser.email,
      firstName: studentUser.firstName ?? null,
      lastName: studentUser.lastName ?? null,
      timeZone: studentUser.timeZone ?? null,
      sessionPack: pack ? {
        id: pack._id,
        totalSessions: pack.totalSessions,
        remainingSessions: pack.remainingSessions,
        expiresAt: pack.expiresAt ?? null,
        status: pack.status,
      } : null,
      sessions: sortedSessions.map(s => ({
        id: s._id,
        scheduledAt: s.scheduledAt,
        completedAt: s.completedAt ?? null,
        canceledAt: s.canceledAt ?? null,
        status: s.status,
        notes: s.notes ?? null,
        cancelReason: s.cancelReason ?? null,
      })),
    };
  },
});

export const getInstructorByEmailInternal = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("instructors")
      .withIndex("by_email", (q) => q.eq("email", args.email.toLowerCase()))
      .collect();
  },
});

export const getInstructorBasicById = internalQuery({
  args: { id: v.id("instructors") },
  handler: async (ctx, args) => {
    const instructor = await ctx.db.get(args.id);
    if (!instructor) return null;
    return {
      name: instructor.name ?? null,
      userId: instructor.userId ?? null,
    };
  },
});

export const getPendingStudentInvitationsByEmail = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    try {
      const invitations = (await ctx.db
        .query("studentInvitations" as any)
        .withIndex("by_email" as any)
        .filter((q) => q.eq(q.field("email"), args.email.toLowerCase()))
        .collect()) as unknown as StudentInvitationDoc[];

      return invitations.filter(
        inv => inv.status === "pending" && inv.expiresAt > now
      );
    } catch (err) {
      console.error("getPendingStudentInvitationsByEmail: invitation query failed", err);
      // Gracefully degrade until schema/codegen is updated to remove casts
      return [];
    }
  },
});

/** Deletes a testimonial by ID. Requires admin role or instructor ownership. */
export const deleteTestimonial = mutation({
  args: { id: v.id("instructorTestimonials") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    
    const user = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
      .first();
    
    if (!user || (user.role !== "admin" && user.role !== "instructor")) {
      throw new Error("Forbidden");
    }
    
    const testimonial = await ctx.db.get(args.id);
    if (!testimonial) throw new Error("Testimonial not found");
    
    if (user.role === "instructor") {
      const instructor = await ctx.db
        .query("instructors")
        .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
        .first();
      if (!instructor || instructor._id !== testimonial.instructorId) {
        throw new Error("Forbidden");
      }
    }
    
    await ctx.db.delete(args.id);
    return { success: true };
  },
});

/** Deletes a student result by ID. Requires admin role or instructor ownership. */
export const deleteStudentResult = mutation({
  args: { id: v.id("studentResults") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    
    const user = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
      .first();
    
    if (!user || (user.role !== "admin" && user.role !== "instructor")) {
      throw new Error("Forbidden");
    }
    
    const studentResult = await ctx.db.get(args.id);
    if (!studentResult) throw new Error("Student result not found");
    
    if (user.role === "instructor") {
      const instructor = await ctx.db
        .query("instructors")
        .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
        .first();
      if (!instructor || instructor._id !== studentResult.instructorId) {
        throw new Error("Forbidden");
      }
    }
    
    await ctx.db.delete(args.id);

    return { success: true };
  },
});

/** Checks seat availability for an instructor (public endpoint). */
export const checkSeatAvailability = query({
  args: { instructorId: v.id("instructors") },
  handler: async (ctx, args) => {
    const instructor = await ctx.db.get(args.instructorId);
    if (!instructor) {
      throw new Error("Instructor not found");
    }

    const activeSeats = await ctx.db
      .query("seatReservations")
      .withIndex("by_instructorId_status", (q) =>
        q.eq("instructorId", args.instructorId).eq("status", "active")
      )
      .collect();

    const maxSeats = instructor.oneOnOneInventory ?? 0;
    const activeCount = activeSeats.length;
    const remainingSeats = Math.max(0, maxSeats - activeCount);

    return {
      available: remainingSeats > 0,
      activeSeats: activeCount,
      maxSeats,
      remainingSeats,
    };
  },
});

/** Updates inventory fields for an instructor. Requires admin role. */
export const updateInstructorInventory = mutation({
  args: {
    id: v.id("instructors"),
    oneOnOneInventory: v.optional(v.number()),
    groupInventory: v.optional(v.number()),
    maxActiveStudents: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    const user = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
      .first();
    if (user?.role !== "admin") throw new Error("Forbidden");

    const { id, ...updates } = args;
    const filteredUpdates: Record<string, number> = {};
    if (updates.oneOnOneInventory !== undefined) filteredUpdates.oneOnOneInventory = updates.oneOnOneInventory;
    if (updates.groupInventory !== undefined) filteredUpdates.groupInventory = updates.groupInventory;
    if (updates.maxActiveStudents !== undefined) filteredUpdates.maxActiveStudents = updates.maxActiveStudents;

    if (Object.keys(filteredUpdates).length === 0) {
      throw new Error("No valid fields to update");
    }

    await ctx.db.patch(id, { ...filteredUpdates, updatedAt: Date.now() });
    return await ctx.db.get(id);
  },
});

export const unlinkInstructorByUserId = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const instructor = await ctx.db
      .query("instructors")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();

    if (!instructor) {
      return { unlinked: false, reason: "No instructor found with matching userId", userId: args.userId };
    }

    await ctx.db.patch(instructor._id, { userId: undefined, updatedAt: Date.now() });
    return {
      unlinked: true,
      instructorId: instructor._id,
      instructorName: instructor.name ?? null,
      userId: args.userId,
    };
  },
});

type UnlinkInstructorResult =
  | { unlinked: true; instructorId: Id<"instructors">; instructorName: string | null; userId: string }
  | { unlinked: false; reason: string; userId: string };

export const unlinkClerkUserFromInstructor = internalAction({
  args: { userId: v.string() },
  handler: async (ctx, args): Promise<UnlinkInstructorResult> => {
    const result = await ctx.runMutation(internal.instructors.unlinkInstructorByUserId, { userId: args.userId });
    return result as UnlinkInstructorResult;
  },
});

export const linkInstructorToLegacyMentor = internalMutation({
  args: {
    instructorId: v.id("instructors"),
    legacyInstructorRef: v.optional(v.string()),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const updates: Record<string, any> = {
      userId: args.userId,
      updatedAt: Date.now(),
    };
    if (args.legacyInstructorRef) {
      updates.legacyInstructorRef = args.legacyInstructorRef;
    }
    await ctx.db.patch(args.instructorId, updates);
    return { success: true };
  },
});

export const acceptStudentInvitation = internalMutation({
  args: {
    email: v.string(),
    instructorId: v.id("instructors"),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    let invitation: StudentInvitationDoc | null = null;
    try {
      invitation = (await ctx.db
        .query("studentInvitations" as any)
        .withIndex("by_email_instructorId" as any)
        .filter((q) => q.and(
          q.eq(q.field("email"), args.email.toLowerCase()),
          q.eq(q.field("instructorId"), args.instructorId),
          q.eq(q.field("status"), "pending"),
          q.gt(q.field("expiresAt"), now)
        ))
        .first()) as unknown as StudentInvitationDoc | null;
    } catch (err) {
      console.error("acceptStudentInvitation: invitation query failed", err);
      return { accepted: false, reason: "Invitation lookup unavailable" };
    }

    if (!invitation) {
      return { accepted: false, reason: "No pending invitation found" };
    }

    await ctx.db.patch(invitation._id, {
      status: "accepted",
    });

    return { accepted: true, invitationId: invitation._id as Id<any> };
  },
});

type LinkResult = {
  linked: boolean;
  reason?: string;
  instructorId?: Id<"instructors">;
  instructorName?: string | null;
  legacyInstructorRef?: string;
  email?: string;
  userId?: string;
  invitationId?: Id<any>;
  needsSessionPack?: boolean;
};

export const linkClerkUserToInstructor = internalAction({
  args: {
    userId: v.string(),
    email: v.string(),
  },
  handler: async (ctx, args): Promise<{ instructorLinking: LinkResult; studentLinking: LinkResult }> => {
    const { userId, email } = args;

    if (!email || typeof email !== "string") {
      return {
        instructorLinking: { linked: false, reason: "No email provided" },
        studentLinking: { linked: false, reason: "No email provided" },
      };
    }

    const normalizedEmail = email.toLowerCase();

    const instructorsWithEmail = await ctx.runQuery(
      internal.instructors.getInstructorByEmailInternal,
      { email: normalizedEmail }
    );

    let instructorResult: LinkResult = { linked: false, reason: "No instructor found with matching email", email };

    if (instructorsWithEmail.length > 0) {
      const instructor = instructorsWithEmail[0];

      // If userId is set and different, check if it's a placeholder (admin-*) that should be updated
      if (instructor.userId && instructor.userId !== userId && !instructor.userId.startsWith("admin-")) {
        instructorResult = { linked: false, reason: "Instructor already linked to a different Clerk user", instructorId: instructor._id };
      } else {
        // Update with the Clerk userId (handles placeholder userIds like "admin-slug")
        await ctx.runMutation(internal.instructors.linkInstructorToLegacyMentor, {
          instructorId: instructor._id,
          legacyInstructorRef: (instructor as any).legacyInstructorRef ?? (instructor as any).legacyId,
          userId,
        });

        instructorResult = {
          linked: true,
          instructorId: instructor._id,
          instructorName: instructor.name ?? null,
          userId,
          legacyInstructorRef: ((instructor as any).legacyInstructorRef ?? (instructor as any).legacyId) ?? undefined,
          email,
        };
      }
    } else if (process.env.CLERK_AUTO_CREATE_INSTRUCTOR === "true") {
      // Check if instructor already exists by userId (could have been created by handleClerkUserCreated)
      const existingByUserId = await ctx.runQuery(
        internal.instructors.getInstructorByUserIdInternal,
        { userId }
      );

      if (existingByUserId) {
        // Already created by handleClerkUserCreated, just link
        await ctx.runMutation(internal.instructors.linkInstructorToLegacyMentor, {
          instructorId: existingByUserId._id,
          legacyInstructorRef: (existingByUserId as any).legacyInstructorRef ?? (existingByUserId as any).legacyId,
          userId,
        });

        instructorResult = {
          linked: true,
          instructorId: existingByUserId._id,
          instructorName: existingByUserId.name ?? null,
          userId,
          legacyInstructorRef: ((existingByUserId as any).legacyInstructorRef ?? (existingByUserId as any).legacyId) ?? undefined,
          email: normalizedEmail,
        };
      } else {
        // Auto-create instructor if none found and feature flag is enabled
        const nameFromEmail = normalizedEmail.split("@")[0].replace(/[^a-z0-9]/gi, " ").trim().split(/\s+/).map((part, i) => i === 0 ? part.charAt(0).toUpperCase() + part.slice(1) : part).join(" ") || normalizedEmail;

        // Don't create instructor if we don't have at least name or email
        if (!nameFromEmail && !normalizedEmail) {
          instructorResult = { linked: false, reason: "Cannot create instructor: no name or email available", email: normalizedEmail };
        } else {
          const instructorId = await ctx.runMutation(internal.instructors.createInstructorInternal, {
            userId,
            name: nameFromEmail || undefined,
            email: normalizedEmail,
            isActive: true,
            isNew: true,
          });

          instructorResult = {
            linked: true,
            instructorId: instructorId as Id<"instructors">,
            instructorName: nameFromEmail || null,
            userId,
            email: normalizedEmail,
          };
        }
      }
    }

    const pendingInvitations = await ctx.runQuery(
      internal.instructors.getPendingStudentInvitationsByEmail,
      { email: normalizedEmail }
    );

    let studentResult: LinkResult = { linked: false, reason: "No pending student invitation found", email };

    if (pendingInvitations.length > 0) {
      const pendingInvitation = pendingInvitations[0];
      await ctx.runMutation(internal.instructors.acceptStudentInvitation, {
        email: normalizedEmail,
        instructorId: pendingInvitation.instructorId,
      });

      studentResult = {
        linked: true,
        invitationId: pendingInvitation._id as Id<any>,
        legacyInstructorRef: pendingInvitation.instructorId.toString(),
        email,
        needsSessionPack: true,
      };
    }

    return {
      instructorLinking: instructorResult,
      studentLinking: studentResult,
    };
  },
});

export const getInstructorByUserIdInternal = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("instructors")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();
  },
});

export const createInstructorInternal = internalMutation({
  args: {
    userId: v.string(),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    isActive: v.boolean(),
    isNew: v.boolean(),
  },
  handler: async (ctx, args) => {
    if (!args.name && !args.email) {
      throw new Error("At least one of name or email is required");
    }
    return await ctx.db.insert("instructors", {
      userId: args.userId,
      name: args.name ?? undefined,
      email: args.email ?? undefined,
      isActive: args.isActive,
      isNew: args.isNew,
      maxActiveStudents: 10,
      oneOnOneInventory: 0,
      groupInventory: 0,
    });
  },
});

export const deactivateInstructorInternal = internalMutation({
  args: { instructorId: v.id("instructors") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.instructorId, {
      isActive: false,
      updatedAt: Date.now(),
    });
    return { success: true };
  },
});

export const backfillInstructorUserId = mutation({
  args: {
    instructorId: v.id("instructors"),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const instructor = await ctx.db.get(args.instructorId);
    if (!instructor) {
      throw new Error("Instructor not found");
    }
    await ctx.db.patch(args.instructorId, {
      userId: args.userId,
      updatedAt: Date.now(),
    });
    return { success: true };
  },
});

export const createInstructorForClerkUser = action({
  args: {
    userId: v.string(),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    secret: v.string(),
  },
  handler: async (ctx, args): Promise<{ success: boolean; instructorId?: Id<"instructors">; reason?: string }> => {
    if (args.secret !== process.env.CONVEX_SERVER_SHARED_SECRET) {
      console.error("createInstructorForClerkUser: Invalid secret");
      return { success: false, reason: "Invalid secret" };
    }

    const existing = await ctx.runQuery(
      internal.instructors.getInstructorByUserIdInternal,
      { userId: args.userId }
    );

    if (existing) {
      console.log("createInstructorForClerkUser: Instructor already exists", args.userId);
      await ctx.runMutation(internal.users.setUserRoleTrusted, {
        userId: args.userId,
        role: "instructor",
      });
      console.log("createInstructorForClerkUser: Updated user role to instructor", args.userId);
      return { success: true, instructorId: existing._id, reason: "Already exists" };
    }

    const instructorId = await ctx.runMutation(internal.instructors.createInstructorInternal, {
      userId: args.userId,
      name: args.name,
      email: args.email,
      isActive: true,
      isNew: true,
    });

    console.log("createInstructorForClerkUser: Created instructor", args.userId, instructorId);

    await ctx.runMutation(internal.users.setUserRoleTrusted, {
      userId: args.userId,
      role: "instructor",
    });
    console.log("createInstructorForClerkUser: Set user role to instructor", args.userId);

    return { success: true, instructorId };
  },
});

export const deactivateInstructorByUserId = action({
  args: {
    userId: v.string(),
    secret: v.string(),
  },
  handler: async (ctx, args): Promise<{ success: boolean; instructorId?: Id<"instructors">; reason?: string }> => {
    if (args.secret !== process.env.CONVEX_SERVER_SHARED_SECRET) {
      console.error("deactivateInstructorByUserId: Invalid secret");
      return { success: false, reason: "Invalid secret" };
    }

    const instructor = await ctx.runQuery(
      internal.instructors.getInstructorByUserIdInternal,
      { userId: args.userId }
    );

    if (!instructor) {
      console.log("deactivateInstructorByUserId: No instructor found", args.userId);
      return { success: false, reason: "No instructor found" };
    }

    await ctx.runMutation(internal.instructors.deactivateInstructorInternal, {
      instructorId: instructor._id,
    });

    console.log("deactivateInstructorByUserId: Deactivated instructor", args.userId, instructor._id);

    return { success: true, instructorId: instructor._id };
  },
});

// Structural type for studentInvitations to avoid reliance on TableNames when
// generated types are stale in certain build environments.
type StudentInvitationDoc = {
  _id: Id<any>;
  _creationTime: number;
  email: string;
  instructorId: Id<"instructors">;
  clerkInvitationId?: string;
  expiresAt: number;
  status: "pending" | "accepted" | "expired" | "cancelled";
  deletedAt?: number;
  legacyId?: string;
};
