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
  const metadata = identity?.metadata as { role?: string } | undefined;
  if (metadata?.role === "admin") {
    return true;
  }

  return false;
}

/** Returns waitlist entries for an instructor, optionally filtered by mentorship type. */
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

/** Deletes multiple waitlist entries by their IDs. */
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

/** Deletes all waitlist entries for a given instructor slug. Admin-only. */
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
 * Returns ALL entries for the instructor/type (matching the original Supabase
 * behavior) so a user already notified once still gets a follow-up when a new
 * availability window opens. The HTTP caller is responsible for de-duplication
 * by email before sending.
 */
export const internalGetUnnotifiedWaitlist = internalQuery({
  args: {
    instructorSlug: v.string(),
    mentorshipType: v.optional(v.union(v.literal("oneOnOne"), v.literal("group"))),
  },
  handler: async (ctx, args) => {
    const entries = await ctx.db
      .query("marketingWaitlist")
      .withIndex("by_instructorSlug_mentorshipType", (q) =>
        q.eq("instructorSlug", args.instructorSlug)
      )
      .collect();

    return entries
      .filter((entry) => {
        if (!args.mentorshipType || entry.mentorshipType === args.mentorshipType) {
          return true;
        }
        return false;
      })
      .map((entry) => ({
        _id: entry._id,
        email: entry.email,
        createdAt: entry.createdAt,
      }));
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
 * Each entry inserts a new marketingWaitlist row. Existing rows with the
 * same (email, instructorSlug, mentorshipType) triple are silently skipped
 * because the underlying index `by_email_and_instructorSlug_and_mentorshipType`
 * will reject duplicates. Returns the count actually inserted.
 */
export const internalBulkImportWaitlist = internalMutation({
  args: {
    entries: v.array(
      v.object({
        email: v.string(),
        instructorSlug: v.string(),
        mentorshipType: v.union(v.literal("oneOnOne"), v.literal("group")),
        createdAt: v.optional(v.number()),
      })
    ),
  },
  handler: async (ctx, args) => {
    let inserted = 0;
    let skipped = 0;
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
        skipped++;
        continue;
      }
      await ctx.db.insert("marketingWaitlist", {
        email: entry.email,
        instructorSlug: entry.instructorSlug,
        mentorshipType: entry.mentorshipType,
        createdAt: entry.createdAt ?? Date.now(),
      });
      inserted++;
    }
    return { success: true, inserted, skipped };
  },
});

/** Server-only (internal) email normalization. Walks every existing
 * marketingWaitlist row and patches the email field to lowercase. Called by
 * scripts/migrate-marketing-waitlist.ts after the bulk Supabase import to
 * close Greptile Prior-2: the `by_email_and_instructorSlug_and_mentorshipType`
 * index does exact-lowercase lookups, so any mixed-case row already in
 * Convex would otherwise create a phantom duplicate on the next signup.
 */
export const internalNormalizeEmailsToLowercase = internalMutation({
  args: {},
  handler: async (ctx) => {
    let patched = 0;
    const seen = 0;
    const cursor = await ctx.db.query("marketingWaitlist").collect();
    for (const row of cursor) {
      if (row.email !== row.email.toLowerCase()) {
        await ctx.db.patch(row._id, { email: row.email.toLowerCase() });
        patched++;
      }
    }
    return { success: true, scanned: cursor.length, patched };
  },
});
