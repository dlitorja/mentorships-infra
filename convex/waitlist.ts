import {
  query,
  mutation,
  action,
  internalMutation,
  internalQuery,
  env,
} from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { RateLimiter, HOUR } from "@convex-dev/rate-limiter";
import { components } from "./_generated/api";
import { api } from "./_generated/api";

const rateLimiter = new RateLimiter(components.rateLimiter, {
  marketingWaitlistJoin: {
    kind: "fixed window",
    rate: 10,
    period: HOUR,
  },
  // Global write-side cap sized to be well above legitimate peak
  // traffic for the marketing site (across all instructor pages).
  // addToWaitlist is unauthenticated, so the per-(email, slug) bucket
  // is bypassable by rotating either value; the global bucket caps
  // total joins across all callers to keep a single attacker from
  // filling durable Convex storage. The 5,000/hour figure is chosen
  // high enough that a single attacker submitting ~5,000 distinct
  // valid subscriptions in one hour is impractical from a browser
  // (form-submit rate-limited client-side too), while still bounding
  // the unbounded durable-write surface.
  marketingWaitlistJoinGlobal: {
    kind: "fixed window",
    rate: 5000,
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
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return { onWaitlist: false, mentorshipType: null };
    }
    const isAdmin = await isAdminUser(ctx, identity.subject);
    const emailLower = args.email.toLowerCase();
    const identityEmail = (identity.email ?? "").toLowerCase();
    if (!isAdmin && identityEmail !== emailLower) {
      return { onWaitlist: false, mentorshipType: null };
    }

    const entry = await ctx.db
      .query("marketingWaitlist")
      .withIndex("by_email_instructorSlug", (q) =>
        q.eq("email", emailLower).eq("instructorSlug", args.instructorSlug)
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

/** Creates a new waitlist entry. Idempotent per (email, instructorSlug, mentorshipType) triple.
 *
 * Public mutation so server-side callers (apps/platform/app/api/waitlist/route.ts,
 * the web app's hook, and the platform app's hook) can still call it directly.
 * Marketing client callers MUST go through `actionAddToWaitlist` instead, which
 * runs this mutation after a successful Cloudflare Turnstile siteverify.
 */
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

    await rateLimiter.limit(ctx, "marketingWaitlistJoinGlobal", {
      key: "global",
      throws: true,
    });
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

const TURNSTILE_ACTION = "waitlist_signup";

function hostnameMatches(hostname: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    if (pattern.startsWith("*.")) {
      const suffix = pattern.slice(1);
      if (hostname.endsWith(suffix) && hostname.length > suffix.length) {
        return true;
      }
    } else if (hostname === pattern) {
      return true;
    }
  }
  return false;
}

/** Public action: siteverify a Turnstile token, then run `addToWaitlist`.
 *
 * Unauthenticated callers (e.g. the marketing app's student-facing waitlist
 * form) MUST go through this action rather than calling `addToWaitlist`
 * directly: a bare mutation has no caller-bound rate-limit key, so a single
 * attacker could rotate `email` to flood `marketingWaitlist`. The Turnstile
 * token proves a real browser solved a CAPTCHA, which bounds writes to
 * solvable CAPTCHAs per attacker.
 *
 * Action verification checks (any failure throws ConvexError):
 *   1. TURNSTILE_SECRET_KEY is configured server-side.
 *   2. siteverify returns `success: true`.
 *   3. siteverify `action` equals `waitlist_signup` (defends against
 *      cross-action token reuse — a token minted for a different action
 *      can't pass).
 *   4. siteverify `hostname` matches TURNSTILE_ALLOWED_HOSTNAMES
 *      (default: localhost,127.0.0.1,*.huckleberry.art). Cloudflare's
 *      siteverify returns the host the visitor solved the CAPTCHA from,
 *      so an attacker minting a token on `attacker.example` can't replay
 *      it against our endpoints.
 *
 * The per-(email, slug) and global rate-limiter buckets in `addToWaitlist`
 * stay as defense in depth — Turnstile tokens are one-time but a single
 * CAPTCHA can still be solved and replayed across many distinct emails
 * before the bucket expires.
 */
export const actionAddToWaitlist = action({
  args: {
    email: v.string(),
    instructorSlug: v.string(),
    mentorshipType: v.union(v.literal("oneOnOne"), v.literal("group")),
    turnstileToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const secret = env.TURNSTILE_SECRET_KEY;
    if (!secret) {
      throw new ConvexError("Turnstile not configured");
    }

    if (!args.turnstileToken) {
      throw new ConvexError("Turnstile token required");
    }

    const formData = new FormData();
    formData.append("secret", secret);
    formData.append("response", args.turnstileToken);

    const verifyRes = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        body: formData,
      }
    );

    if (!verifyRes.ok) {
      throw new ConvexError("Turnstile verification request failed");
    }

    const result = (await verifyRes.json()) as {
      success: boolean;
      action?: string;
      hostname?: string;
      "error-codes"?: string[];
    };

    if (!result.success) {
      throw new ConvexError(
        `Turnstile rejected: ${result["error-codes"]?.join(",") ?? "unknown"}`
      );
    }

    if (result.action !== TURNSTILE_ACTION) {
      throw new ConvexError("Turnstile action mismatch");
    }

    const allowedHostnames = (
      env.TURNSTILE_ALLOWED_HOSTNAMES ?? "localhost,127.0.0.1,*.huckleberry.art"
    )
      .split(",")
      .map((s: string) => s.trim())
      .filter(Boolean);

    if (!result.hostname || !hostnameMatches(result.hostname, allowedHostnames)) {
      throw new ConvexError("Turnstile hostname not allowed");
    }

    const result_add: {
      success: boolean;
      message: string;
      existingId?: Id<"marketingWaitlist">;
      id?: Id<"marketingWaitlist">;
    } = await ctx.runMutation(api.waitlist.addToWaitlist, {
      email: args.email,
      instructorSlug: args.instructorSlug,
      mentorshipType: args.mentorshipType,
    });

    return result_add;
  },
});

/** Deletes a single waitlist entry by ID. Admin-gated via isAdminUser
 * (see the rationale in getWaitlistForInstructor).
 */
export const removeFromWaitlist = mutation({
  args: { id: v.id("marketingWaitlist") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const isAdmin = await isAdminUser(ctx, identity.subject);
    if (!isAdmin) throw new Error("Forbidden");
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

/** Deletes waitlist entries matching an email and instructor, optionally
 * filtered by mentorship type. Admin-gated via isAdminUser (see the
 * rationale in getWaitlistForInstructor).
 *
 * The email is lowercased before the indexed lookup because marketingWaitlist
 * rows are stored in lowercase (see internalNormalizeEmailsToLowercase) and
 * callers may pass mixed-case input — a mixed-case query would return zero
 * rows and the deletion would silently no-op.
 */
export const removeByEmail = mutation({
  args: {
    email: v.string(),
    instructorSlug: v.string(),
    mentorshipType: v.optional(v.union(v.literal("oneOnOne"), v.literal("group"))),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const isAdmin = await isAdminUser(ctx, identity.subject);
    if (!isAdmin) throw new Error("Forbidden");

    const emailLower = args.email.toLowerCase();
    const entries = await ctx.db
      .query("marketingWaitlist")
      .withIndex("by_email_instructorSlug", (q) =>
        q.eq("email", emailLower).eq("instructorSlug", args.instructorSlug)
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

/** Server-only (internal) variant of markNotified. Called from the HTTP
 * action in convex/http.ts gated by CONVEX_HTTP_KEY.
 *
 * Tolerates rows that were concurrently deleted between the worker's
 * unnotified-read and the mark step: a missing row is skipped instead
 * of aborting the whole transaction, because the seven-day cooldown
 * depends on notifiedAt being set for every surviving row that
 * received an email. A throw inside a Convex transaction rolls back
 * every patch, so the alternative (let db.patch throw) would re-email
 * the surviving delivered rows on the next event.
 */
export const internalMarkWaitlistNotified = internalMutation({
  args: { ids: v.array(v.id("marketingWaitlist")) },
  handler: async (ctx, args) => {
    let marked = 0;
    let skipped = 0;
    for (const id of args.ids) {
      const row = await ctx.db.get(id);
      if (!row) {
        skipped++;
        continue;
      }
      await ctx.db.patch(id, { notifiedAt: Date.now() });
      marked++;
    }
    return { success: true, marked, skipped };
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
        if (
          entry.notifiedAt !== undefined &&
          (existing.notifiedAt === undefined || entry.notifiedAt > existing.notifiedAt)
        ) {
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

/** Server-only (internal) email normalization + duplicate consolidation,
 * paginated so the mutation stays under Convex's per-transaction document
 * limit. Each call processes one page of rows: lowercases mixed-case
 * emails, then queries the (email, slug, type) index to determine whether
 * the current row is the earliest-createdAt keeper for its triple or a
 * duplicate to be deleted. Deleting a duplicate may also patch the
 * keeper's notifiedAt to the LATEST value across the group, so the
 * seven-day cooldown reflects the most recent delivery to the subscriber.
 *
 * Idempotent: re-running with the same cursor chain converges to the
 * canonical (lowercase email, slug, type, earliest createdAt, latest
 * notifiedAt) form. Resume after a transaction failure by passing the
 * last returned cursor. The HTTP caller in scripts/migrate-marketing-waitlist.ts
 * loops until nextCursor is null.
 */
export const internalNormalizeEmailsToLowercase = internalMutation({
  args: {
    cursor: v.union(v.string(), v.null()),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("marketingWaitlist")
      .paginate({ cursor: args.cursor ?? null, numItems: args.limit });

    let patched = 0;
    let deletedDuplicates = 0;

    for (const row of page.page) {
      if (row.email !== row.email.toLowerCase()) {
        await ctx.db.patch(row._id, { email: row.email.toLowerCase() });
        patched++;
      }

      const sameKey = await ctx.db
        .query("marketingWaitlist")
        .withIndex("by_email_and_instructorSlug_and_mentorshipType", (q) =>
          q
            .eq("email", row.email.toLowerCase())
            .eq("instructorSlug", row.instructorSlug)
            .eq("mentorshipType", row.mentorshipType)
        )
        .collect();

      if (sameKey.length <= 1) continue;

      const sorted = sameKey.slice().sort((a, b) => a.createdAt - b.createdAt);
      const keeper = sorted[0];
      const isKeeper = row._id === keeper._id;
      if (!isKeeper) {
        if (
          row.notifiedAt !== undefined &&
          (keeper.notifiedAt === undefined || row.notifiedAt > keeper.notifiedAt)
        ) {
          await ctx.db.patch(keeper._id, { notifiedAt: row.notifiedAt });
        }
        await ctx.db.delete(row._id);
        deletedDuplicates++;
      }
    }

    return {
      success: true,
      scanned: page.page.length,
      patched,
      deletedDuplicates,
      nextCursor: page.continueCursor ?? null,
      isDone: page.isDone,
    };
  },
});
