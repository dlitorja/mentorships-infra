import { query, mutation, internalMutation, internalAction, internalQuery, action } from "./_generated/server";
import { internal, api } from "./_generated/api";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { resolveActiveWorkspaceForPair } from "./workspaces";
import { writeAuditLog } from "./auditLog";

/**
 * True if `id` matches the Clerk user ID format. Clerk user IDs always
 * start with `user_` followed by base62 characters
 * (e.g. `user_2abcDEF...`). Any other value (e.g. `seed-${slug}` or
 * `admin-${slug}` placeholders written by seed/admin-sync scripts)
 * is treated as a placeholder, safe to overwrite with a real Clerk
 * user ID when the user signs in.
 *
 * Discriminating by format instead of by prefix list is the most
 * correct fix: any future placeholder convention is also covered
 * without maintenance.
 */
const CLERK_USER_ID_PATTERN = /^user_[a-zA-Z0-9]+$/;
function isClerkUserId(id: string | undefined): boolean {
  return typeof id === "string" && CLERK_USER_ID_PATTERN.test(id);
}

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
  // `portfolioImages` is the canonical display list. `portfolioImageStorageIds`
  // should be the same length and index-aligned, but legacy data and the
  // admin edit form's "remove image" path historically only patched
  // `portfolioImages`, leaving orphaned storage IDs behind. We must NOT
  // trust positional pairing when the lengths diverge — those orphan IDs
  // resolve to fresh Convex storage URLs and would surface deleted images.
  //
  // - Lengths match: pair by index, prefer the fresh storage URL.
  // - Lengths diverge: ignore storage IDs entirely, return the canonical URLs.
  if (!fallbackUrls || fallbackUrls.length === 0) return fallbackUrls;
  if (!storageIds || storageIds.length !== fallbackUrls.length) return fallbackUrls;
  const urls = await Promise.all(
    fallbackUrls.map(async (url, i) => {
      const sid = storageIds[i];
      if (!sid) return url;
      const fresh = await ctx.storage.getUrl(sid as Id<"_storage">);
      return fresh ?? url;
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

    // PR 4: `instructors` is the only source of truth — the legacy
    // `instructorProfiles` table has been dropped from the schema.
    const instructors = await ctx.db.query("instructors").collect();

    const instructorsNeedingProfileMigration = instructors.filter(
      (i) => i.profileImageUrl && !i.profileImageStorageId
    ).length;

    const instructorsNeedingPortfolioMigration = instructors.filter(
      (i) => i.portfolioImages &&
      i.portfolioImages.length > 0 &&
      (!i.portfolioImageStorageIds || i.portfolioImageStorageIds.length < i.portfolioImages.length)
    ).length;

    const instructorsWithStorageId = instructors.filter((i) => i.profileImageStorageId).length;

    return {
      instructorsNeedingProfileMigration,
      instructorsNeedingPortfolioMigration,
      instructorsWithStorageId,
      totalInstructors: instructors.length,
    };
  },
});

type BackfillSummary = {
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

    // PR 3: `instructors` is the canonical source. Iterate directly — there is
    // no separate profile table to consult.
    const instructors = await ctx.runQuery(
      api.instructors.listInstructorsInternal,
      {} as any
    );

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

    // Backfill profile images and portfolio images for every instructor
    for (const inst of instructors as any[]) {
      if (processedCount >= maxItems) break;
      if (!inst?._id) continue;
      try {
        // Profile image
        if (!inst.profileImageStorageId && inst.profileImageUrl) {
          const src = absoluteUrl(baseUrl, inst.profileImageUrl);
          if (src && !args.dryRun) {
            const uploaded = await uploadFromUrl(src);
            if (!("error" in uploaded)) {
              await ctx.runMutation(
                api.instructors.updateInstructorProfileStorageId,
                {
                  instructorId: inst._id,
                  storageId: uploaded.storageId,
                  url: uploaded.url,
                } as any
              );
              summary.processedInstructors += 1;
            } else {
              summary.errors.push({ kind: "profile", id: inst.slug || inst._id, message: `upload failed for ${src}: ${uploaded.error}` });
            }
          }
          processedCount++;
        }

        // Portfolio images
        const urls: string[] = (inst.portfolioImages ?? []) as string[];
        const sids: string[] = (inst.portfolioImageStorageIds ?? []) as string[];
        const toProcess: number[] = urls.map((_, i) => i).filter((i) => !sids[i] && urls[i]);
        if (toProcess.length > 0) {
          const newUrls = [...urls];
          const newSids = [...sids];
          for (const i of toProcess) {
            if (processedCount >= maxItems) break;
            const src = absoluteUrl(baseUrl, urls[i]);
            if (src && !args.dryRun) {
              const uploaded = await uploadFromUrl(src);
              if (!("error" in uploaded)) {
                newUrls[i] = uploaded.url;
                newSids[i] = uploaded.storageId;
                summary.processedPortfolioImages += 1;
              } else {
                summary.errors.push({ kind: "portfolio", id: `${inst.slug || inst._id}[${i}]`, message: `upload failed for ${src}: ${uploaded.error}` });
              }
            }
            processedCount++;
          }
          if (!args.dryRun && toProcess.length > 0) {
            await ctx.runMutation(
              api.instructors.updateInstructorPortfolioStorageIds,
              {
                instructorId: inst._id,
                storageIds: newSids,
                urls: newUrls,
              } as any
            );
          }
        }
      } catch (e) {
        summary.errors.push({ kind: "instructor", id: inst.slug || inst._id, message: e instanceof Error ? e.message : String(e) });
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
 * Internal writers for instructor image/profile fields. The legacy
 * `instructorProfiles` table has been dropped (PR 4), so these helpers now
 * patch `instructors` only. They remain as internal mutations because callers
 * (e.g. `backfillImagesForSlugs`) are actions that can't write to the DB
 * directly.
 */

/**
 * Appends a portfolio image (URL + storageId) to the `instructors` row.
 * Throws when the instructor row is missing.
 */
export const internalAtomicAddPortfolioImage = internalMutation({
  args: {
    instructorId: v.id("instructors"),
    url: v.string(),
    storageId: v.string(),
  },
  // Explicit return type avoids the module self-reference cycle that arises
  // when callers in the same file do `return await ctx.runMutation(internal.X)`.
  returns: v.object({
    storageId: v.string(),
    url: v.string(),
    index: v.number(),
  }),
  handler: async (ctx, args): Promise<{ storageId: string; url: string; index: number }> => {
    const instructor = await ctx.db.get(args.instructorId);
    if (!instructor) throw new Error("Instructor not found");

    const currentUrls = instructor.portfolioImages ?? [];
    const newUrls = [...currentUrls, args.url];
    const newStorageIds = [...(instructor.portfolioImageStorageIds ?? []), args.storageId];

    await ctx.db.patch(args.instructorId, {
      portfolioImages: newUrls,
      portfolioImageStorageIds: newStorageIds,
    });

    return {
      storageId: args.storageId,
      url: args.url,
      index: currentUrls.length,
    };
  },
});

/**
 * Replaces the full portfolio image list (URLs + storageIds) on `instructors`.
 * Used by the admin upload route which reads the current list client-side and
 * writes back the appended version.
 */
export const internalAtomicSetPortfolioImages = internalMutation({
  args: {
    instructorId: v.id("instructors"),
    urls: v.array(v.string()),
    storageIds: v.array(v.string()),
  },
  returns: v.object({
    urls: v.array(v.string()),
    storageIds: v.array(v.string()),
  }),
  handler: async (ctx, args): Promise<{ urls: string[]; storageIds: string[] }> => {
    const instructor = await ctx.db.get(args.instructorId);
    if (!instructor) throw new Error("Instructor not found");

    await ctx.db.patch(args.instructorId, {
      portfolioImages: args.urls,
      portfolioImageStorageIds: args.storageIds,
    });

    return { urls: args.urls, storageIds: args.storageIds };
  },
});

/**
 * Sets the profile picture (URL + storageId) on `instructors`.
 * Replaces the bodies of addInstructorProfileImage and updateInstructorProfileStorageId.
 */
export const internalAtomicSetProfileImage = internalMutation({
  args: {
    instructorId: v.id("instructors"),
    url: v.string(),
    storageId: v.string(),
  },
  returns: v.object({
    url: v.string(),
    storageId: v.string(),
  }),
  handler: async (ctx, args): Promise<{ url: string; storageId: string }> => {
    const instructor = await ctx.db.get(args.instructorId);
    if (!instructor) throw new Error("Instructor not found");

    await ctx.db.patch(args.instructorId, {
      profileImageUrl: args.url,
      profileImageStorageId: args.storageId,
    });

    return { storageId: args.storageId, url: args.url };
  },
});

/**
 * Patches profile fields on `instructors` and stamps `updatedAt`. All writes
 * happen inside a single transaction; callers don't need any outer
 * `ctx.db.patch` calls.
 */
export const internalAtomicUpdateProfileFields = internalMutation({
  args: {
    instructorId: v.id("instructors"),
    fields: v.any(),
  },
  returns: v.object({
    updatedFields: v.array(v.string()),
  }),
  handler: async (
    ctx,
    args
  ): Promise<{ updatedFields: string[] }> => {
    const instructor = await ctx.db.get(args.instructorId);
    if (!instructor) throw new Error("Instructor not found");

    const fields = (args.fields ?? {}) as Record<string, unknown>;
    const instructorsPatch: Record<string, unknown> = { updatedAt: Date.now(), ...fields };

    if (Object.keys(fields).length === 0) {
      await ctx.db.patch(args.instructorId, { updatedAt: Date.now() } as Partial<Doc<"instructors">>);
      return { updatedFields: [] };
    }

    await ctx.db.patch(args.instructorId, instructorsPatch as Partial<Doc<"instructors">>);

    return { updatedFields: Object.keys(fields) };
  },
});

/**
 * Full-update internal helper used by the admin `updateInstructor` mutation.
 * Writes all provided fields plus `updatedAt` to `instructors` in a single
 * transaction. Callers do not need any outer `ctx.db.patch` calls.
 */
export const internalAtomicFullUpdateInstructor = internalMutation({
  args: {
    instructorId: v.id("instructors"),
    fields: v.any(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const instructor = await ctx.db.get(args.instructorId);
    if (!instructor) throw new Error("Instructor not found");

    const allFields = (args.fields ?? {}) as Record<string, unknown>;
    const instructorsPatch: Record<string, unknown> = {
      updatedAt: Date.now(),
      ...allFields,
    };
    await ctx.db.patch(args.instructorId, instructorsPatch as Partial<Doc<"instructors">>);

    return null;
  },
});

/**
 * Internal backfill scoped to specific slugs.
 * Fetches images from a source site, uploads to Convex Storage, and updates the `instructors` table.
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

    // PR 3: `instructors` is the canonical source; iterate directly.
    const instructors = await ctx.runQuery(
      internal.instructors.listInstructorsAll,
      {}
    );

    const allowed = new Set(args.slugs.map((s) => s.trim()).filter(Boolean));

    // Process selected slugs
    for (const inst of (instructors as any[])) {
      if (processedCount >= maxItems) break;
      const slug: string | undefined = inst.slug;
      if (!slug || !allowed.has(slug)) continue;
      if (!inst?._id) continue;
      try {
        // Profile image
        if (!inst.profileImageStorageId && inst.profileImageUrl) {
          const src = abs(inst.profileImageUrl);
          if (src) {
            const uploaded = await uploadFromUrl(src);
            if (!("error" in uploaded)) {
              await ctx.runMutation(
                internal.instructors.internalAtomicSetProfileImage,
                {
                  instructorId: inst._id,
                  storageId: uploaded.storageId,
                  url: uploaded.url,
                } as any
              );
              summary.processedInstructors += 1;
            } else {
              summary.errors.push({ kind: "profile", id: slug, message: `upload failed for ${src}: ${uploaded.error}` });
            }
          }
          processedCount++;
        }

        // Portfolio images
        const urls: string[] = (inst.portfolioImages ?? []) as string[];
        const sids: string[] = (inst.portfolioImageStorageIds ?? []) as string[];
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
                summary.errors.push({ kind: "portfolio", id: `${slug}[${i}]`, message: `upload failed for ${src}: ${uploaded.error}` });
              }
            }
            processedCount++;
          }
          if (toProcess.length > 0) {
            await ctx.runMutation(
              internal.instructors.internalAtomicSetPortfolioImages,
              {
                instructorId: inst._id,
                storageIds: newSids,
                urls: newUrls,
              } as any
            );
          }
        }
      } catch (e) {
        summary.errors.push({ kind: "instructor", id: slug, message: e instanceof Error ? e.message : String(e) });
        summary.skipped += 1;
      }
    }

    if (args.includeStudentResults !== false) {
      const studentResults = await ctx.runQuery(internal.instructors.listStudentResultsAll, {});
      // PR 3: only include student results whose instructor slug is in the
      // allowed set. `instructors._id` is the canonical reference; iterate
      // the already-loaded instructor list to collect their ids.
      const allowedInstructorIds = new Set(
        (instructors as any[])
          .filter((i) => i?.slug && allowed.has(i.slug))
          .map((i) => i._id)
          .filter(Boolean)
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
  const userByUserId = await ctx.db
    .query("users")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .first();
  if (userByUserId?.role === "admin") return true;
  const userByClerkId = await ctx.db
    .query("users")
    .withIndex("by_clerkId", (q) => q.eq("clerkId", userId))
    .first();
  return userByClerkId?.role === "admin";
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

/** Returns the instructor document matching the given slug. */
export const getInstructorBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const instructor = await ctx.db
      .query("instructors")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();
    if (!instructor) return null;
    if (instructor.isListed === false) return null;

    const profileImageUrl = await getFreshProfileUrl(
      ctx,
      instructor.profileImageStorageId,
      instructor.profileImageUrl
    );
    const portfolioImages = await getFreshPortfolioUrls(
      ctx,
      instructor.portfolioImageStorageIds,
      instructor.portfolioImages
    );

    // PR 3: explicitly allow-list the public-facing fields. The query is
    // unauthenticated (public instructor profile pages), so we must NOT spread
    // the full `instructors` document — that would leak calendar, Discord,
    // scheduling metadata, and other operational fields to the public.
    return {
      _id: instructor._id,
      _creationTime: instructor._creationTime,
      slug: instructor.slug,
      userId: instructor.userId,
      name: instructor.name,
      email: instructor.email,
      tagline: instructor.tagline,
      bio: instructor.bio,
      specialties: instructor.specialties,
      background: instructor.background,
      socials: instructor.socials,
      profileImageUrl,
      portfolioImages,
      profileImageStorageId: instructor.profileImageStorageId,
      profileImageUploadPath: instructor.profileImageUploadPath,
      isActive: instructor.isActive,
      isNew: instructor.isNew,
      legacyInstructorRef: instructor.legacyInstructorRef,
      instructorId: instructor._id,
      oneOnOneInventory: (instructor as any).oneOnOneInventory ?? 0,
      groupInventory: (instructor as any).groupInventory ?? 0,
      useKajabiCheckout: (instructor as any).useKajabiCheckout ?? false,
      kajabiCheckoutUrlOneOnOne: (instructor as any).kajabiCheckoutUrlOneOnOne,
      kajabiCheckoutUrlGroup: (instructor as any).kajabiCheckoutUrlGroup,
    };
  },
});

// PR #convex-egress-5: cap public/admin instructor listings and return a
// narrow shape so we don't stream full portfolios to listing pages.
const DEFAULT_INSTRUCTOR_LIST_LIMIT = 100;

// Hard upper bound on the limit arg accepted by public instructor-listing
// queries. Even though the Next.js /api/admin/instructors route clamps
// pageSize to 500, this query is also callable directly from authenticated
// admin clients, so the trust boundary must enforce the cap itself.
const MAX_PUBLIC_INSTRUCTOR_LIST_LIMIT = 500;

type InstructorListItem = {
  _id: Id<"instructors">;
  _creationTime: number;
  userId?: string;
  name?: string;
  slug?: string;
  email?: string;
  tagline?: string;
  bio?: string;
  profileImageUrl?: string;
  specialties?: string[];
  isActive?: boolean;
  isNew?: boolean;
  isListed?: boolean;
  oneOnOneInventory?: number;
  groupInventory?: number;
  maxActiveStudents?: number;
  activeStudentCount?: number;
  createdAt?: number;
  deletedAt?: number;
  isCompletelySoldOut?: boolean;
};

async function toInstructorListItem(
  ctx: QueryCtx,
  inst: Doc<"instructors">,
  extra?: { isCompletelySoldOut?: boolean; activeStudentCount?: number }
): Promise<InstructorListItem> {
  const profileImageUrl = await getFreshProfileUrl(
    ctx,
    inst.profileImageStorageId,
    inst.profileImageUrl
  );
  return {
    _id: inst._id,
    _creationTime: inst._creationTime,
    userId: inst.userId,
    name: inst.name,
    slug: inst.slug,
    email: inst.email,
    tagline: inst.tagline,
    bio: inst.bio,
    profileImageUrl,
    specialties: inst.specialties,
    isActive: inst.isActive,
    isNew: inst.isNew,
    isListed: inst.isListed,
    oneOnOneInventory: (inst as any).oneOnOneInventory ?? 0,
    groupInventory: (inst as any).groupInventory ?? 0,
    maxActiveStudents: (inst as any).maxActiveStudents,
    activeStudentCount: extra?.activeStudentCount,
    createdAt: inst._creationTime,
    deletedAt: inst.deletedAt,
    isCompletelySoldOut: extra?.isCompletelySoldOut,
  };
}

/** Returns all non-deleted instructors. Requires authentication. */
export const listInstructors = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return [];
    }
    const limit = args.limit ?? DEFAULT_INSTRUCTOR_LIST_LIMIT;
    const instructors = await ctx.db
      .query("instructors")
      .withIndex("by_deletedAt", (q) => q.eq("deletedAt", undefined))
      .take(limit);
    return Promise.all(
      instructors.map(async (inst) => toInstructorListItem(ctx, inst))
    );
  },
});

/** Returns active instructors with inventory, excluding sensitive fields. Requires authentication. */
export const getActiveInstructors = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return [];
    }
    const limit = args.limit ?? DEFAULT_INSTRUCTOR_LIST_LIMIT;
    const instructors = await ctx.db
      .query("instructors")
      .withIndex("by_deletedAt", (q) => q.eq("deletedAt", undefined))
      .filter((q) => q.gt(q.field("oneOnOneInventory"), 0))
      .take(limit);
    return Promise.all(
      instructors.map(async (inst) => toInstructorListItem(ctx, inst))
    );
  },
});

/** Returns publicly available instructors (non-deleted), with a computed sold-out flag per their active offerings. */
export const getPublicInstructors = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = args.limit ?? DEFAULT_INSTRUCTOR_LIST_LIMIT;
    // Fetch non-deleted, active instructors. Treat undefined isActive as active (legacy data).
    const publicVisible = await ctx.db
      .query("instructors")
      .withIndex("by_deletedAt", (q) => q.eq("deletedAt", undefined))
      .filter((q) => q.neq(q.field("isActive"), false))
      .filter((q) => q.neq(q.field("isListed"), false))
      .take(limit);

    return Promise.all(
      publicVisible.map(async (inst) => {
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

        return toInstructorListItem(ctx, inst, { isCompletelySoldOut });
      })
    );
  },
});

/** Returns all non-deleted instructors for admin with inventory data, excluding sensitive fields. */
export const getInstructorsForAdmin = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      throw new Error("Unauthorized");
    }
    const isAdmin = await isAdminUser(ctx, user.subject);
    if (!isAdmin) {
      throw new Error("Forbidden");
    }
    const limit = args.limit ?? DEFAULT_INSTRUCTOR_LIST_LIMIT;
    const instructors = await ctx.db
      .query("instructors")
      .withIndex("by_deletedAt", (q) => q.eq("deletedAt", undefined))
      .take(limit);

    const seatReservations = await ctx.db.query("seatReservations").collect();

    return Promise.all(
      instructors.map(async (inst) => {
        const activeStudentCount = seatReservations.filter(
          (sr) => sr.instructorId === inst._id && sr.status === "active"
        ).length;
        return toInstructorListItem(ctx, inst, { activeStudentCount });
      })
    );
  },
});

/**
 * Returns non-deleted instructors who have completed Clerk user creation.
 * A row qualifies when its `userId` is a real Clerk user ID (matches the
 * `user_…` pattern), so placeholder values like `admin-${slug}` are excluded.
 *
 * Used by the edit-instructor form's "Instructor ID" dropdown so admins can
 * only reference instructors who are actually live in Clerk. The admin
 * instructors list page still uses `getInstructorsForAdmin` (every row,
 * regardless of Clerk state).
 *
 * The scan is bounded: it paginates the `by_deletedAt` index (rows where
 * `deletedAt === undefined`) in fixed-size pages, applies the connected
 * filter per row, and stops once `limit` rows have been collected. Walking
 * the deletedAt index keeps the read cost proportional to the size of the
 * current active instructor set, not the historical Clerk-linked set.
 */
export const getConnectedInstructorsForAdmin = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      throw new Error("Unauthorized");
    }
    const isAdmin = await isAdminUser(ctx, user.subject);
    if (!isAdmin) {
      throw new Error("Forbidden");
    }
    const limit = Math.min(
      Math.max(1, Math.floor(args.limit ?? DEFAULT_INSTRUCTOR_LIST_LIMIT)),
      MAX_PUBLIC_INSTRUCTOR_LIST_LIMIT
    );
    const pageSize = Math.max(limit * 2, 200);
    const connected: Doc<"instructors">[] = [];
    let cursor: string | null = null;
    while (connected.length < limit) {
      const result = await ctx.db
        .query("instructors")
        .withIndex("by_deletedAt", (q) => q.eq("deletedAt", undefined))
        .paginate({ numItems: pageSize, cursor });
      for (const inst of result.page) {
        if (isClerkUserId(inst.userId)) {
          connected.push(inst);
          if (connected.length >= limit) break;
        }
      }
      if (result.isDone) break;
      cursor = result.continueCursor;
    }

    return Promise.all(
      connected.map(async (inst) => {
        const activeStudentCount = await ctx.db
          .query("seatReservations")
          .withIndex("by_instructorId_status", (q) =>
            q.eq("instructorId", inst._id).eq("status", "active")
          )
          .collect()
          .then((rows) => rows.length);
        return toInstructorListItem(ctx, inst, { activeStudentCount });
      })
    );
  },
});

/** Returns an instructor by slug from the instructors table. */
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
    userId: v.optional(v.string()),
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
    isListed: v.optional(v.boolean()),
    profileImageUrl: v.optional(v.string()),
    profileImageUploadPath: v.optional(v.string()),
    profileImageStorageId: v.optional(v.string()),
    useKajabiCheckout: v.optional(v.boolean()),
    kajabiCheckoutUrlOneOnOne: v.optional(v.string()),
    kajabiCheckoutUrlGroup: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Skip the userId dedup check when no userId is supplied — the
    // index lookup can't match `undefined`. Seed/admin-sync callers
    // intentionally omit userId so the Clerk webhook can claim the
    // row with the real Clerk user ID later.
    let existing = null;
    if (args.userId !== undefined) {
      existing = await ctx.db
        .query("instructors")
        .withIndex("by_userId", (q) => q.eq("userId", args.userId))
        .first();
    }

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
        return existingBySlug._id;
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
      isListed: args.isListed,
      profileImageUrl: args.profileImageUrl ?? undefined,
      profileImageUploadPath: args.profileImageUploadPath ?? undefined,
      profileImageStorageId: args.profileImageStorageId ?? undefined,
      maxActiveStudents: args.maxActiveStudents ?? 10,
      oneOnOneInventory: args.oneOnOneInventory ?? 0,
      groupInventory: args.groupInventory ?? 0,
      useKajabiCheckout: args.useKajabiCheckout,
      kajabiCheckoutUrlOneOnOne: args.kajabiCheckoutUrlOneOnOne,
      kajabiCheckoutUrlGroup: args.kajabiCheckoutUrlGroup,
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
    isListed: v.optional(v.boolean()),
    profileImageUrl: v.optional(v.union(v.string(), v.null())),
    profileImageUploadPath: v.optional(v.union(v.string(), v.null())),
    profileImageStorageId: v.optional(v.string()),
    specialties: v.optional(v.array(v.string())),
    legacyInstructorRef: v.optional(v.union(v.string(), v.null())),
    useKajabiCheckout: v.optional(v.boolean()),
    kajabiCheckoutUrlOneOnOne: v.optional(v.union(v.string(), v.null())),
    kajabiCheckoutUrlGroup: v.optional(v.union(v.string(), v.null())),
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
      "kajabiCheckoutUrlOneOnOne",
      "kajabiCheckoutUrlGroup",
    ];
    for (const key of nullableKeys) {
      if ((updates as any)[key] === null) {
        (updates as any)[key] = undefined;
      }
    }

    // PR 1: delegate the full update to one atomic helper that writes all
    // fields plus `updatedAt` to `instructors` in a single transaction. PR 4
    // removed the legacy `instructorProfiles` table, so this is now a single-
    // table write. No outer writes here — that was the partial-commit risk
    // Greptile flagged on the previous shape (runMutation + outer patch).
    await ctx.runMutation(
      internal.instructors.internalAtomicFullUpdateInstructor,
      {
        instructorId: id,
        fields: updates,
      }
    );
    return await ctx.db.get(id);
  },
});

/** Updates an instructor's own profile fields. Requires the caller to be the instructor (userId match). Passing undefined for an optional field removes it from the document. */
export const updateInstructorProfile = mutation({
  args: {
    id: v.id("instructors"),
    name: v.optional(v.string()),
    tagline: v.optional(v.string()),
    bio: v.optional(v.string()),
    specialties: v.optional(v.array(v.string())),
    background: v.optional(v.array(v.string())),
    profileImageUrl: v.optional(v.string()),
    profileImageUploadPath: v.optional(v.string()),
    portfolioImages: v.optional(v.array(v.string())),
    socials: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    const instructor = await ctx.db.get(args.id);
    if (!instructor) throw new Error("Instructor not found");
    if (instructor.userId !== identity.subject) {
      throw new Error("Forbidden");
    }

    const { id, ...updates } = args;
    if (Object.keys(updates).length === 0) {
      return await ctx.db.get(id);
    }

    // PR 1: delegate fully to the atomic helper. PR 4 dropped the legacy
    // `instructorProfiles` table, so this is now a single-table write to
    // `instructors` (fields + `updatedAt`) inside one transaction.
    await ctx.runMutation(
      internal.instructors.internalAtomicUpdateProfileFields,
      {
        instructorId: id,
        fields: updates,
      }
    );
    return await ctx.db.get(id);
  },
});

/** Soft-deletes an instructor by setting deletedAt to the current timestamp. Requires admin role. */
export const deleteInstructor = mutation({
  args: { id: v.id("instructors") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    if (!(await isAdminUser(ctx, identity.subject))) throw new Error("Forbidden");
    await ctx.db.patch(args.id, { deletedAt: Date.now() });
  },
});

/** Permanently hard-deletes an instructor. Use with caution - this is irreversible. Requires admin role. */
export const hardDeleteInstructor = mutation({
  args: { id: v.id("instructors") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    if (!(await isAdminUser(ctx, identity.subject))) throw new Error("Forbidden");
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

/** Generates a Convex storage upload URL for an authenticated instructor. */
export const generateAuthenticatedInstructorUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
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

/** Appends a portfolio image to an instructor's portfolio. The index is determined inside the mutation so concurrent appends are handled transactionally. Requires the caller to be the instructor. */
export const addInstructorPortfolioImage = mutation({
  args: {
    instructorId: v.id("instructors"),
    storageId: v.string(),
    contentType: v.optional(v.string()),
  },
  // PR 1: explicit return type breaks the module self-reference cycle that
  // arose when this public mutation started delegating to an internal helper
  // declared in the same file. See INSTRUCTOR_PROFILES_CONSOLIDATION_PLAN.md.
  returns: v.object({
    storageId: v.string(),
    url: v.string(),
    index: v.number(),
  }),
  handler: async (
    ctx,
    args
  ): Promise<{ storageId: string; url: string; index: number }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    const instructor = await ctx.db.get(args.instructorId);
    if (!instructor || !instructor.slug) {
      throw new Error("Instructor not found or missing slug");
    }
    if (instructor.userId !== identity.subject) {
      throw new Error("Forbidden");
    }

    const url = await ctx.storage.getUrl(args.storageId as Id<"_storage">);
    if (!url) {
      throw new Error("Failed to get URL for storage ID");
    }

    // PR 1: delegate to the atomic helper so the `instructors` row is updated
    // in a single transaction. PR 4 removed the dual-write to `instructorProfiles`.
    return await ctx.runMutation(
      internal.instructors.internalAtomicAddPortfolioImage,
      {
        instructorId: args.instructorId,
        url,
        storageId: args.storageId,
      }
    );
  },
});

/** Sets an instructor's profile image. Requires the caller to be the instructor. */
export const addInstructorProfileImage = mutation({
  args: {
    instructorId: v.id("instructors"),
    storageId: v.string(),
    contentType: v.optional(v.string()),
  },
  // PR 1: explicit return type breaks the module self-reference cycle.
  returns: v.object({
    storageId: v.string(),
    url: v.string(),
  }),
  handler: async (ctx, args): Promise<{ storageId: string; url: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    const instructor = await ctx.db.get(args.instructorId);
    if (!instructor || !instructor.slug) {
      throw new Error("Instructor not found or missing slug");
    }
    if (instructor.userId !== identity.subject) {
      throw new Error("Forbidden");
    }

    const url = await ctx.storage.getUrl(args.storageId as Id<"_storage">);
    if (!url) {
      throw new Error("Failed to get URL for storage ID");
    }

    // PR 1: delegate to the atomic helper so both tables are updated in one transaction.
    return await ctx.runMutation(
      internal.instructors.internalAtomicSetProfileImage,
      {
        instructorId: args.instructorId,
        url,
        storageId: args.storageId,
      }
    );
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
  // PR 1: explicit return type breaks the module self-reference cycle.
  returns: v.object({
    storageId: v.string(),
    url: v.string(),
  }),
  handler: async (ctx, args): Promise<{ storageId: string; url: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const user = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
      .first();
    if (user?.role !== "admin") throw new Error("Forbidden");
    // PR 1: delegate to the atomic helper so both tables are updated in one transaction.
    return await ctx.runMutation(
      internal.instructors.internalAtomicSetProfileImage,
      {
        instructorId: args.instructorId,
        url: args.url,
        storageId: args.storageId,
      }
    );
  },
});

export const updateInstructorPortfolioStorageIds = mutation({
  args: {
    instructorId: v.id("instructors"),
    storageIds: v.array(v.string()),
    urls: v.array(v.string()),
  },
  // PR 1: explicit return type breaks the module self-reference cycle.
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const user = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
      .first();
    if (user?.role !== "admin") throw new Error("Forbidden");
    // PR 1: delegate to the atomic helper so both tables are updated in one transaction.
    await ctx.runMutation(internal.instructors.internalAtomicSetPortfolioImages, {
      instructorId: args.instructorId,
      urls: args.urls,
      storageIds: args.storageIds,
    });
    return null;
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

/** Returns public testimonials for active instructors. */
export const getPublicTestimonials = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;

    const publicVisible = await ctx.db
      .query("instructors")
      .withIndex("by_deletedAt", (q) => q.eq("deletedAt", undefined))
      .filter((q) => q.neq(q.field("isActive"), false))
      .collect();

    const instructorIds = new Set(publicVisible.map((i) => i._id));
    const instructorById = new Map(publicVisible.map((i) => [i._id, i]));

    const testimonials = await ctx.db.query("instructorTestimonials").collect();
    const eligible = [];
    for (const t of testimonials) {
      if (!t.instructorId || !instructorIds.has(t.instructorId as Id<"instructors">)) continue;
      const instructor = instructorById.get(t.instructorId as Id<"instructors">);
      if (!instructor) continue;
      eligible.push({
        text: t.text,
        author: t.name,
        role: t.role,
        instructorName: instructor.name,
        instructorSlug: instructor.slug,
      });
    }

    // Shuffle the full eligible set for equal exposure, then limit.
    for (let i = eligible.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [eligible[i], eligible[j]] = [eligible[j], eligible[i]];
    }

    return eligible.slice(0, limit);
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

        const workspace = await resolveActiveWorkspaceForPair(ctx, {
          instructorId: args.instructorId,
          studentUserId: m.userId,
        });

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
          workspaceId: workspace?._id ?? null,
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
    if (!instructor || instructor.userId !== user.subject) {
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

      // If userId is set and different, only refuse if it already
      // matches a real Clerk user ID format. Anything else (the
      // `seed-${slug}` and `admin-${slug}` placeholders written by
      // `seed-instructors.ts` and `httpAdminSyncInventory`, plus
      // any future placeholder convention) is safe to overwrite
      // with the real Clerk user ID — otherwise the existing
      // placeholder would block the instructor from ever signing
      // in as themselves.
      if (instructor.userId && instructor.userId !== userId && isClerkUserId(instructor.userId)) {
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

export const getInstructorByIdInternal = internalQuery({
  args: { instructorId: v.id("instructors") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.instructorId);
  },
});

export const createInstructorInternal = internalMutation({
  args: {
    userId: v.optional(v.string()),
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
  args: {
    instructorId: v.id("instructors"),
    actorId: v.optional(v.string()),
    actorRole: v.optional(v.union(
      v.literal("admin"),
      v.literal("support"),
      v.literal("instructor"),
      v.literal("student"),
      v.literal("system"),
    )),
    audit: v.optional(v.object({
      action: v.string(),
      targetType: v.string(),
      targetId: v.string(),
      details: v.optional(v.string()),
      metadata: v.optional(v.record(v.string(), v.any())),
    })),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.instructorId, {
      isActive: false,
      updatedAt: Date.now(),
    });
    if (args.audit) {
      await writeAuditLog(ctx, {
        actorId: args.actorId ?? "system",
        actorRole: args.actorRole ?? "system",
        action: args.audit.action,
        targetType: args.audit.targetType,
        targetId: args.audit.targetId,
        details: args.audit.details,
        metadata: args.audit.metadata,
      });
    }
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

/**
 * Internal action backing the bearer-auth HTTP endpoint
 * `POST /instructors/create-for-clerk-user` (CONVEX_HTTP_KEY, see
 * `convex/http.ts:httpCreateInstructorForClerkUser`). Contains the
 * full lookup/create/sync logic. Auth is enforced by the HTTP endpoint;
 * no Clerk session required (server-to-server caller). The legacy
 * public `action` wrapper was removed in PR D once PR #669 confirmed
 * all consumers had migrated to the HTTP transport.
 */
export const createInstructorForClerkUserInternal = internalAction({
  args: {
    userId: v.string(),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    instructorId: v.optional(v.id("instructors")),
    actorId: v.optional(v.string()),
    actorRole: v.optional(v.union(v.literal("admin"), v.literal("support"), v.literal("instructor"), v.literal("student"), v.literal("system"))),
  },
  handler: async (ctx, args): Promise<{ success: boolean; instructorId?: Id<"instructors">; reason?: string }> => {
    const actorId = args.actorId ?? "system";
    const actorRole = args.actorRole ?? "system";

    const existing = await ctx.runQuery(
      internal.instructors.getInstructorByUserIdInternal,
      { userId: args.userId }
    );

    if (existing) {
      console.log("createInstructorForClerkUser: Instructor already exists", args.userId);
      await ctx.runMutation(internal.users.setUserRoleTrusted, {
        userId: args.userId,
        role: "instructor",
        actorId,
        actorRole,
        audit: {
          action: "create_instructor_for_clerk_user",
          targetType: "instructor",
          targetId: existing._id,
          details: `Instructor already existed for user ${args.userId}; role synced to instructor`,
        },
      });
      console.log("createInstructorForClerkUser: Updated user role to instructor", args.userId);
      return { success: true, instructorId: existing._id, reason: "Already exists" };
    }

    // Instructors created by the admin dashboard before the Clerk user exists
    // are stored with a placeholder userId (e.g. `admin-<slug>`). When the
    // invited instructor later signs up, link the real Clerk userId to that
    // existing record instead of creating a duplicate.
    //
    // Prefer an invitation-specific instructorId when the Clerk webhook carries
    // one in public metadata; this prevents ambiguous email matches when
    // multiple placeholder records exist for the same address.
    const normalizedEmail = args.email?.toLowerCase().trim();
    if (args.instructorId) {
      const invited = await ctx.runQuery(
        internal.instructors.getInstructorByIdInternal,
        { instructorId: args.instructorId }
      );
      if (invited && !isClerkUserId(invited.userId)) {
        console.log(
          "createInstructorForClerkUser: Linking invited instructor to Clerk user",
          args.userId,
          invited._id
        );
        await ctx.runMutation(api.instructors.backfillInstructorUserId, {
          instructorId: invited._id,
          userId: args.userId,
        });
        await ctx.runMutation(internal.users.setUserRoleTrusted, {
          userId: args.userId,
          role: "instructor",
          actorId,
          actorRole,
          audit: {
            action: "create_instructor_for_clerk_user",
            targetType: "instructor",
            targetId: invited._id,
            details: `Linked invited instructor profile (${invited._id}) to Clerk user ${args.userId}`,
            metadata: { userId: args.userId, email: normalizedEmail, name: args.name },
          },
        });
        return { success: true, instructorId: invited._id, reason: "Linked invited instructor" };
      }
    }

    // Fallback: email-only placeholder lookup for callers that don't have an
    // invitation-specific instructorId (e.g., manual role changes or older
    // Inngest events). This still protects against binding to a Clerk userId.
    if (normalizedEmail) {
      const byEmail = await ctx.runQuery(
        internal.instructors.getInstructorByEmailInternal,
        { email: normalizedEmail }
      );
      const placeholder = byEmail.find((inst) => !isClerkUserId(inst.userId));
      if (placeholder) {
        console.log(
          "createInstructorForClerkUser: Linking existing instructor to Clerk user",
          args.userId,
          placeholder._id
        );
        await ctx.runMutation(api.instructors.backfillInstructorUserId, {
          instructorId: placeholder._id,
          userId: args.userId,
        });
        await ctx.runMutation(internal.users.setUserRoleTrusted, {
          userId: args.userId,
          role: "instructor",
          actorId,
          actorRole,
          audit: {
            action: "create_instructor_for_clerk_user",
            targetType: "instructor",
            targetId: placeholder._id,
            details: `Linked existing instructor profile (${placeholder._id}) to Clerk user ${args.userId}`,
            metadata: { userId: args.userId, email: normalizedEmail, name: args.name },
          },
        });
        return { success: true, instructorId: placeholder._id, reason: "Linked existing instructor" };
      }
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
      actorId,
      actorRole,
      audit: {
        action: "create_instructor_for_clerk_user",
        targetType: "instructor",
        targetId: instructorId,
        details: `Created instructor profile for user ${args.userId}`,
        metadata: { userId: args.userId, email: args.email, name: args.name },
      },
    });
    console.log("createInstructorForClerkUser: Set user role to instructor", args.userId);

    return { success: true, instructorId };
  },
});

/**
 * Internal action backing the bearer-auth HTTP endpoint
 * `POST /instructors/deactivate-by-user-id` (CONVEX_HTTP_KEY, see
 * `convex/http.ts:httpDeactivateInstructorByUserId`). Auth is enforced
 * by the HTTP endpoint; no Clerk session required (server-to-server
 * caller). The legacy public `action` wrapper was removed in PR D
 * once PR #669 confirmed all consumers had migrated to the HTTP
 * transport.
 */
export const deactivateInstructorByUserIdInternal = internalAction({
  args: {
    userId: v.string(),
    actorId: v.optional(v.string()),
    actorRole: v.optional(v.union(v.literal("admin"), v.literal("support"), v.literal("instructor"), v.literal("student"), v.literal("system"))),
  },
  handler: async (ctx, args): Promise<{ success: boolean; instructorId?: Id<"instructors">; reason?: string }> => {
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
      actorId: args.actorId ?? "system",
      actorRole: args.actorRole ?? "system",
      audit: {
        action: "deactivate_instructor_by_user_id",
        targetType: "instructor",
        targetId: instructor._id,
        details: `Deactivated instructor for user ${args.userId}`,
        metadata: { userId: args.userId },
      },
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
