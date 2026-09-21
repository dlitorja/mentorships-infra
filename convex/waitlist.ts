import { query, mutation, internalMutation, internalQuery } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { RateLimiter, HOUR } from "@convex-dev/rate-limiter";
import { components } from "./_generated/api";

const rateLimiter = new RateLimiter(components.rateLimiter, {
  marketingWaitlistJoin: {
    kind: "fixed window",
    rate: 10,
    period: HOUR,
  },
});

async function isAdminUser(ctx: QueryCtx, userId: string): Promise<boolean> {
  const dbUser = await ctx.db
    .query("users")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .first();
  if (dbUser?.role === "admin") {
    return true;
  }

  const identity = await ctx.auth.getUserIdentity();
  const metadata = identity?.metadata as { role?: string; email?: string } | undefined;
  if (metadata?.role === "admin") {
    return true;
  }

  const allowlistRaw =
    process.env.MARKETING_ADMIN_EMAILS ?? process.env.ADMIN_EMAILS ?? "admin@huckleberry.art";
  const allowlist = allowlistRaw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const callerEmail = (metadata?.email ?? identity?.email ?? "").toLowerCase();
  if (callerEmail && allowlist.includes(callerEmail)) {
    return true;
  }

  return false;
}

/** Returns waitlist entries for an instructor, optionally filtered by mentorship type.
 * Admin-gated via isAdminUser, which accepts three sources of admin:
 *  - Convex `users.role === "admin"` (synced via Clerk webhook)
 *  - Clerk JWT `publicMetadata.role === "admin"`
 *  - Caller email in the MARKETING_ADMIN_EMAILS env var (or ADMIN_EMAILS
 *    fallback, default "admin@huckleberry.art"), matching the marketing
 *    route layer's allowlist in apps/marketing/lib/auth.ts.
 * The three sources together guarantee the same admin definition at the
 * Convex boundary as at the route boundary, so an allowlist-only operator
 * is not denied by an inconsistent role check.
 */
export const getWaitlistForInstructor = query({
  args: {
    instructorSlug: v.string(),
    mentorshipType: v.optional(v.union(v.literal("oneOnOne"), v.literal("group"))),
  },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return [];
    }
    const isAdmin = await isAdminUser(ctx, user.subject);
    if (!isAdmin) {
      return [];
    }

    let q = ctx.db
      .query("marketingWaitlist")
      .withIndex("by_instructorSlug_mentorshipType", (q) =>
        q.eq("instructorSlug", args.instructorSlug)
      );

    if (args.mentorshipType) {
      return await q.filter((q) => q.eq(q.field("mentorshipType"), args.mentorshipType)).collect();
    }
    return await q.collect();
  },
});

/** Returns the count of oneOnOne and group waitlist entries for an instructor. */
export const getWaitlistCounts = query({
  args: { instructorSlug: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return { oneOnOne: 0, group: 0 };
    }
    const isAdmin = await isAdminUser(ctx, user.subject);
    if (!isAdmin) {
      return { oneOnOne: 0, group: 0 };
    }

    const entries = await ctx.db
      .query("marketingWaitlist")
      .withIndex("by_instructorSlug_mentorshipType", (q) =>
        q.eq("instructorSlug", args.instructorSlug)
      )
      .collect();

    const counts = { oneOnOne: 0, group: 0 };
    for (const entry of entries) {
      if (entry.mentorshipType === "oneOnOne") {
        counts.oneOnOne++;
      } else {
        counts.group++;
      }
    }
    return counts;
  },
});

/** Checks whether an email is on an instructor's waitlist and returns its status. */
export const getWaitlistStatus = query({
  args: {
    email: v.string(),
    instructorSlug: v.string(),
  },
  handler: async (ctx, args) => {
    const entry = await ctx.db
      .query("marketingWaitlist")
      .withIndex("by_email_instructorSlug", (q) =>
        q.eq("email", args.email).eq("instructorSlug", args.instructorSlug)
      )
      .first();

    if (!entry) {
      return { onWaitlist: false, mentorshipType: null };
    }

    return {
      onWaitlist: true,
      mentorshipType: entry.mentorshipType,
      notifiedAt: entry.notifiedAt,
      createdAt: entry.createdAt,
    };
  },
});

/** Creates a new waitlist entry. Idempotent per (email, instructorSlug, mentorshipType) triple. */
export const addToWaitlist = mutation({
  args: {
    email: v.string(),
    instructorSlug: v.string(),
    mentorshipType: v.union(v.literal("oneOnOne"), v.literal("group")),
  },
  handler: async (ctx, args) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(args.email)) {
      throw new ConvexError("Invalid email address");
    }
    const emailLower = args.email.toLowerCase();
    const instructorSlug = args.instructorSlug?.trim() || "general";

    const existing = await ctx.db
      .query("marketingWaitlist")
      .withIndex("by_email_and_instructorSlug_and_mentorshipType", (q) =>
        q
          .eq("email", emailLower)
          .eq("instructorSlug", instructorSlug)
          .eq("mentorshipType", args.mentorshipType)
      )
      .first();

    if (existing) {
      return {
        success: false,
        message: "Already on waitlist for this type",
        existingId: existing._id,
      };
    }

    await rateLimiter.limit(ctx, "marketingWaitlistJoin", {
      key: `${emailLower}|${instructorSlug}`,
      throws: true,
    });

    const id = await ctx.db.insert("marketingWaitlist", {
      email: emailLower,
      instructorSlug,
      mentorshipType: args.mentorshipType,
      createdAt: Date.now(),
    });
    return { success: true, message: "Added to waitlist", id };
  },
});

/** Deletes a single waitlist entry by ID. */
export const removeFromWaitlist = mutation({
  args: { id: v.id("marketingWaitlist") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
    return { success: true };
  },
});

/** Deletes multiple waitlist entries by their IDs. Admin-gated via
 * isAdminUser (see the rationale in getWaitlistForInstructor). The
 * mutation throws Forbidden for non-admin callers so the admin route's
 * success path is preserved while the Convex boundary still enforces
 * the same admin policy.
 */
export const removeMultipleFromWaitlist = mutation({
  args: { ids: v.array(v.id("marketingWaitlist")) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const isAdmin = await isAdminUser(ctx, identity.subject);
    if (!isAdmin) throw new Error("Forbidden");
    for (const id of args.ids) {
      await ctx.db.delete(id);
    }
    return { success: true, count: args.ids.length };
  },
});

/** Deletes waitlist entries matching an email and instructor, optionally filtered by mentorship type. */
export const removeByEmail = mutation({
  args: {
    email: v.string(),
    instructorSlug: v.string(),
    mentorshipType: v.optional(v.union(v.literal("oneOnOne"), v.literal("group"))),
  },
  handler: async (ctx, args) => {
    const entries = await ctx.db
      .query("marketingWaitlist")
      .withIndex("by_email_instructorSlug", (q) =>
        q.eq("email", args.email).eq("instructorSlug", args.instructorSlug)
      )
      .collect();

    let deleted = 0;
    for (const entry of entries) {
      if (!args.mentorshipType || entry.mentorshipType === args.mentorshipType) {
        await ctx.db.delete(entry._id);
        deleted++;
      }
    }
    return { success: true, count: deleted };
  },
});

/** Deletes all waitlist entries for a given instructor slug. Admin-gated
 * via isAdminUser (see the rationale in getWaitlistForInstructor). The
 * apps/marketing route additionally constrains the slug to
 * TEST_INSTRUCTOR_SLUG, but defense in depth at the Convex boundary
 * prevents a non-admin from invoking the mutation directly.
 */
export const removeByInstructorSlug = mutation({
  args: { instructorSlug: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const isAdmin = await isAdminUser(ctx, identity.subject);
    if (!isAdmin) throw new Error("Forbidden");

    const entries = await ctx.db
      .query("marketingWaitlist")
      .withIndex("by_instructorSlug_mentorshipType", (q) =>
        q.eq("instructorSlug", args.instructorSlug)
      )
      .collect();

    for (const entry of entries) {
      await ctx.db.delete(entry._id);
    }
    return { success: true, count: entries.length };
  },
});

/** Marks multiple waitlist entries as notified by their IDs. */
export const markNotified = mutation({
  args: { ids: v.array(v.id("marketingWaitlist")) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const isAdmin = await isAdminUser(ctx, identity.subject);
    if (!isAdmin) throw new Error("Forbidden");
    for (const id of args.ids) {
      await ctx.db.patch(id, { notifiedAt: Date.now() });
    }
    return { success: true, count: args.ids.length };
  },
});

/** Marks all unnotified waitlist entries as notified for an instructor, optionally filtered by mentorship type. */
export const markNotifiedByInstructor = mutation({
  args: {
    instructorSlug: v.string(),
    mentorshipType: v.optional(v.union(v.literal("oneOnOne"), v.literal("group"))),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const isAdmin = await isAdminUser(ctx, identity.subject);
    if (!isAdmin) throw new Error("Forbidden");
    const entries = await ctx.db
      .query("marketingWaitlist")
      .withIndex("by_instructorSlug_mentorshipType", (q) =>
        q.eq("instructorSlug", args.instructorSlug)
      )
      .collect();

    let count = 0;
    for (const entry of entries) {
      if ((!args.mentorshipType || entry.mentorshipType === args.mentorshipType) && !entry.notifiedAt) {
        await ctx.db.patch(entry._id, { notifiedAt: Date.now() });
        count++;
      }
    }
    return { success: true, count };
  },
});

/** Returns waitlist entries that have not yet been notified for an instructor, optionally filtered by mentorship type. */
export const getUnnotifiedWaitlist = query({
  args: {
    instructorSlug: v.string(),
    mentorshipType: v.optional(v.union(v.literal("oneOnOne"), v.literal("group"))),
  },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return [];
    }
    const isAdmin = await isAdminUser(ctx, user.subject);
    if (!isAdmin) {
      return [];
    }

    const entries = await ctx.db
      .query("marketingWaitlist")
      .withIndex("by_instructorSlug_mentorshipType", (q) =>
        q.eq("instructorSlug", args.instructorSlug)
      )
      .collect();

    return entries.filter((entry) => {
      if (!args.mentorshipType || entry.mentorshipType === args.mentorshipType) {
        return entry.notifiedAt === undefined;
      }
      return false;
    });
  },
});
/** Server-only (internal) variant of getUnnotifiedWaitlist. Called from the
 * HTTP action in convex/http.ts gated by CONVEX_HTTP_KEY. Not callable from
 * client code because it's an internalQuery.
 *
 * Returns entries for the instructor/type that either (a) have never been
 * notified, or (b) were notified more than 7 days ago. Mirrors the original
 * Supabase filter at apps/marketing/inngest/functions/inventory-changed.ts:56
 * which used `notified.is.false,last_notification_at.lt.${oneWeekAgo}`.
 * The 7-day cooldown prevents duplicate inventory events or closely-spaced
 * availability transitions from re-emailing the same subscribers.
 *
 * The HTTP caller is responsible for de-duplication by email within a single
 * run; the cooldown handles cross-run re-notification.
 */
export const internalGetUnnotifiedWaitlist = internalQuery({
  args: {
    instructorSlug: v.string(),
    mentorshipType: v.optional(v.union(v.literal("oneOnOne"), v.literal("group"))),
  },
  handler: async (ctx, args) => {
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - sevenDaysMs;
    const entries = await ctx.db
      .query("marketingWaitlist")
      .withIndex("by_instructorSlug_mentorshipType", (q) =>
        q.eq("instructorSlug", args.instructorSlug)
      )
      .collect();

    return entries
      .filter((entry) => {
        if (args.mentorshipType && entry.mentorshipType !== args.mentorshipType) {
          return false;
        }
        if (entry.notifiedAt === undefined) return true;
        return entry.notifiedAt < cutoff;
      })
      .map((entry) => ({
        _id: entry._id,
        email: entry.email,
        createdAt: entry.createdAt,
      }));
  },
});

/** Server-only (internal) atomic claim for the notification workers. Picks
 * every eligible row for the instructor/type (same cooldown filter as the
 * read-only query above) and patches notifiedAt = Date.now() in the same
 * mutation. The atomic patch means a concurrent run sees the rows as
 * already-notified and skips them, preventing duplicate emails when two
 * events fire close together for the same offer.
 *
 * The Inngest workers also enforce per-(slug, type) concurrency via the
 * `concurrency` option on createFunction, so this claim is belt-and-
 * suspenders: it works even when events arrive through a path that
 * bypasses Inngest's queue (e.g., manual invoke via the dashboard).
 */
export const internalClaimWaitlistForNotification = internalMutation({
  args: {
    instructorSlug: v.string(),
    mentorshipType: v.optional(v.union(v.literal("oneOnOne"), v.literal("group"))),
  },
  handler: async (ctx, args) => {
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - sevenDaysMs;
    const entries = await ctx.db
      .query("marketingWaitlist")
      .withIndex("by_instructorSlug_mentorshipType", (q) =>
        q.eq("instructorSlug", args.instructorSlug)
      )
      .collect();

    const eligible = entries.filter((entry) => {
      if (args.mentorshipType && entry.mentorshipType !== args.mentorshipType) {
        return false;
      }
      if (entry.notifiedAt === undefined) return true;
      return entry.notifiedAt < cutoff;
    });

    const claimedAt = Date.now();
    const claimed: Array<{ _id: string; email: string }> = [];
    for (const entry of eligible) {
      await ctx.db.patch(entry._id, { notifiedAt: claimedAt });
      claimed.push({ _id: entry._id, email: entry.email });
    }
    return { success: true, claimedAt, claimed };
  },
});

/** Server-only (internal) release of specific row IDs. Clears notifiedAt
 * back to undefined for each _id listed, but ONLY when the row's current
 * notifiedAt still matches the supplied `claimedAt` (race-safe). Used by
 * the workers via onFailure / partial-success paths when a send failed
 * AFTER the claim was made; the cooldown is restored so the next
 * availability event retries those subscribers instead of suppressing
 * them for the full 7 days.
 */
export const internalReleaseSpecificClaims = internalMutation({
  args: {
    ids: v.array(v.id("marketingWaitlist")),
    claimedAt: v.number(),
  },
  handler: async (ctx, args) => {
    let released = 0;
    let untouched = 0;
    for (const id of args.ids) {
      const row = await ctx.db.get(id);
      if (!row) continue;
      if (row.notifiedAt !== args.claimedAt) {
        untouched++;
        continue;
      }
      await ctx.db.patch(id, { notifiedAt: undefined });
      released++;
    }
    return { success: true, released, untouched };
  },
});

/** Server-only (internal) bulk release of recent claims for a (slug, type).
 * Clears notifiedAt back to undefined for every row whose notifiedAt falls
 * in the supplied [since, until] window. Used by the workers' onFailure
 * hooks when a run fails BEFORE the partial-success path has had a chance
 * to record its claimed ids — at that point the worker has no in-memory
 * list of what it claimed, but it does know the claim happened within the
 * last few minutes. Safe because per-key Inngest concurrency guarantees
 * only one run per (slug, type) at a time, so the window matches exactly
 * that run's claim.
 */
export const internalReleaseRecentClaims = internalMutation({
  args: {
    instructorSlug: v.string(),
    mentorshipType: v.optional(v.union(v.literal("oneOnOne"), v.literal("group"))),
    since: v.number(),
    until: v.number(),
  },
  handler: async (ctx, args) => {
    const entries = await ctx.db
      .query("marketingWaitlist")
      .withIndex("by_instructorSlug_mentorshipType", (q) =>
        q.eq("instructorSlug", args.instructorSlug)
      )
      .collect();

    let released = 0;
    for (const entry of entries) {
      if (entry.notifiedAt === undefined) continue;
      if (entry.notifiedAt < args.since || entry.notifiedAt > args.until) continue;
      if (args.mentorshipType && entry.mentorshipType !== args.mentorshipType) continue;
      await ctx.db.patch(entry._id, { notifiedAt: undefined });
      released++;
    }
    return { success: true, released };
  },
});

/** Server-only (internal) variant of markNotified. Called from the HTTP
 * action in convex/http.ts gated by CONVEX_HTTP_KEY.
 */
export const internalMarkWaitlistNotified = internalMutation({
  args: { ids: v.array(v.id("marketingWaitlist")) },
  handler: async (ctx, args) => {
    let count = 0;
    for (const id of args.ids) {
      await ctx.db.patch(id, { notifiedAt: Date.now() });
      count++;
    }
    return { success: true, count };
  },
});

/** Server-only (internal) bulk import. Called from the HTTP action in
 * convex/http.ts gated by CONVEX_HTTP_KEY, used by the one-time
 * Supabase → Convex migration script in scripts/migrate-marketing-waitlist.ts.
 *
 * Each entry inserts a new marketingWaitlist row. If an exact existing row
 * is found and the import carries a notifiedAt timestamp while the existing
 * row has none, merge the legacy notification timestamp into the existing
 * row so the seven-day cooldown survives the migration.
 */
export const internalBulkImportWaitlist = internalMutation({
  args: {
    entries: v.array(
      v.object({
        email: v.string(),
        instructorSlug: v.string(),
        mentorshipType: v.union(v.literal("oneOnOne"), v.literal("group")),
        createdAt: v.optional(v.number()),
        notifiedAt: v.optional(v.number()),
      })
    ),
  },
  handler: async (ctx, args) => {
    let inserted = 0;
    let skipped = 0;
    let merged = 0;
    for (const entry of args.entries) {
      const existing = await ctx.db
        .query("marketingWaitlist")
        .withIndex("by_email_and_instructorSlug_and_mentorshipType", (q) =>
          q
            .eq("email", entry.email)
            .eq("instructorSlug", entry.instructorSlug)
            .eq("mentorshipType", entry.mentorshipType)
        )
        .first();
      if (existing) {
        if (entry.notifiedAt !== undefined && existing.notifiedAt === undefined) {
          await ctx.db.patch(existing._id, { notifiedAt: entry.notifiedAt });
          merged++;
        } else {
          skipped++;
        }
        continue;
      }
      await ctx.db.insert("marketingWaitlist", {
        email: entry.email,
        instructorSlug: entry.instructorSlug,
        mentorshipType: entry.mentorshipType,
        createdAt: entry.createdAt ?? Date.now(),
        notifiedAt: entry.notifiedAt,
      });
      inserted++;
    }
    return { success: true, inserted, skipped, merged };
  },
});

/** Server-only (internal) email normalization + duplicate consolidation.
 * Walks every existing marketingWaitlist row, lowercases the email, and
 * deletes any duplicate rows for the resulting (email, instructorSlug,
 * mentorshipType) triple. Called by scripts/migrate-marketing-waitlist.ts
 * after the bulk Supabase import to close Greptile Prior-2: the
 * `by_email_and_instructorSlug_and_mentorshipType` index does exact-
 * lowercase lookups, and any pre-existing mixed-case row would otherwise
 * leave a duplicate durable subscription after normalization.
 *
 * Keep policy: when consolidating duplicates, retain the row with the
 * earliest createdAt so the original signup intent is preserved.
 */
export const internalNormalizeEmailsToLowercase = internalMutation({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("marketingWaitlist").collect();
    let patched = 0;
    let deletedDuplicates = 0;

    const groupedByTriple = new Map<string, Array<{ _id: string; createdAt: number; notifiedAt: number | undefined }>>();
    for (const row of all) {
      if (row.email !== row.email.toLowerCase()) {
        await ctx.db.patch(row._id, { email: row.email.toLowerCase() });
        patched++;
      }
      const key = `${row.email.toLowerCase()}|${row.instructorSlug}|${row.mentorshipType}`;
      const entry = { _id: row._id, createdAt: row.createdAt, notifiedAt: row.notifiedAt };
      const group = groupedByTriple.get(key);
      if (group) {
        group.push(entry);
      } else {
        groupedByTriple.set(key, [entry]);
      }
    }

    for (const [, group] of groupedByTriple) {
      if (group.length <= 1) continue;
      group.sort((a, b) => a.createdAt - b.createdAt);
      const [keeper, ...duplicates] = group;
      if (keeper.notifiedAt === undefined) {
        let earliestNotified: number | undefined;
        for (const dup of duplicates) {
          if (dup.notifiedAt !== undefined && (earliestNotified === undefined || dup.notifiedAt < earliestNotified)) {
            earliestNotified = dup.notifiedAt;
          }
        }
        if (earliestNotified !== undefined) {
          await ctx.db.patch(keeper._id, { notifiedAt: earliestNotified });
        }
      }
      for (const dup of duplicates) {
        await ctx.db.delete(dup._id);
        deletedDuplicates++;
      }
    }

    return { success: true, scanned: all.length, patched, deletedDuplicates };
  },
});
