/**
 * PR 7: admin digest Convex port.
 *
 * Replaces the Supabase-backed flow:
 *  - `apps/marketing/app/api/admin/digest-settings/route.ts`
 *  - `apps/marketing/app/api/admin/digest-send/route.ts`
 *  - `apps/marketing/lib/digest-data.ts` (4 Supabase queries)
 *
 * with admin-gated Convex queries and mutations. The action that
 * sends the digest email via Resend lives in `convex/digestActions.ts`
 * (separate file because `"use node"` files may only export actions).
 * See `docs/plans/marketing-convex-admin-mirror.md` §4f for the full
 * spec.
 *
 * Reuses `isAdminUser` from `convex/waitlist.ts` so the digest admin-gate
 * uses the same allowlist-aware definition as the waitlist gate
 * (Convex `users.role`, Clerk JWT role, MARKETING_ADMIN_EMAILS).
 */

import {
  query,
  mutation,
  internalQuery,
  internalMutation,
} from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { isAdminUser } from "./waitlist";

type Frequency = "daily" | "weekly" | "monthly";
type MentorshipType = "oneOnOne" | "group";

const DEFAULT_SETTINGS = {
  enabled: false,
  frequency: "weekly" as Frequency,
  adminEmail: "",
  lastSentAt: null,
  updatedAt: null,
};

/** Returns a normalized default-frequency value used for upsert validation. */
function isValidFrequency(s: string): s is Frequency {
  return s === "daily" || s === "weekly" || s === "monthly";
}

/** Loose RFC-5322-ish email check; mirrors the Supabase `digest-settings` zod schema. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ----------------------------------------------------------------------------
// Queries
// ----------------------------------------------------------------------------

/**
 * Returns the singleton `adminDigestSettings` row, or default settings
 * if no row exists yet. Admin-gated.
 */
export const getAdminDigestSettings = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    if (!(await isAdminUser(ctx, identity.subject))) throw new Error("Forbidden");

    const row = await ctx.db.query("adminDigestSettings").first();
    if (!row) {
      return DEFAULT_SETTINGS;
    }
    return {
      enabled: row.enabled ?? false,
      frequency: (row.frequency ?? "weekly") as Frequency,
      adminEmail: row.adminEmail ?? "",
      lastSentAt: row.lastSentAt ?? null,
      updatedAt: row.updatedAt ?? null,
    };
  },
});

/**
 * Returns inventory status (oneOnOneInventory + groupInventory) for every
 * non-deleted instructor. Used by the digest email's "Inventory Status"
 * section. Admin-gated.
 */
export const getInventoryStatusForDigest = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    if (!(await isAdminUser(ctx, identity.subject))) throw new Error("Forbidden");

    const instructors = await ctx.db
      .query("instructors")
      .withIndex("by_deletedAt", (q) => q.eq("deletedAt", undefined))
      .collect();

    return instructors.map((i) => ({
      instructorSlug: i.slug,
      instructorName: i.name,
      oneOnOneInventory: i.oneOnOneInventory ?? 0,
      groupInventory: i.groupInventory ?? 0,
    }));
  },
});

/**
 * Returns waitlist entries whose `createdAt` falls in
 * `[periodStart, periodEnd]`. Uses the new `by_createdAt` index
 * (PR 7 schema change). Admin-gated.
 */
export const getWaitlistSignupsForPeriod = query({
  args: {
    periodStart: v.number(),
    periodEnd: v.number(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    if (!(await isAdminUser(ctx, identity.subject))) throw new Error("Forbidden");

    const entries = await ctx.db
      .query("marketingWaitlist")
      .withIndex("by_createdAt", (q) =>
        q.gte("createdAt", args.periodStart).lte("createdAt", args.periodEnd)
      )
      .collect();

    return entries.map((e) => ({
      instructorSlug: e.instructorSlug,
      mentorshipType: e.mentorshipType,
      email: e.email,
      createdAt: e.createdAt,
    }));
  },
});

/**
 * Returns waitlist entries whose `notifiedAt` falls in
 * `[periodStart, periodEnd]`. Uses the new `by_notifiedAt` index
 * (PR 7 schema change). The aggregation by
 * `(instructorSlug, mentorshipType)` happens in the action so this
 * query returns the raw row set. Admin-gated.
 */
export const getNotificationsSentForPeriod = query({
  args: {
    periodStart: v.number(),
    periodEnd: v.number(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    if (!(await isAdminUser(ctx, identity.subject))) throw new Error("Forbidden");

    const entries = await ctx.db
      .query("marketingWaitlist")
      .withIndex("by_notifiedAt", (q) =>
        q.gte("notifiedAt", args.periodStart).lte("notifiedAt", args.periodEnd)
      )
      .collect();

    return entries.map((e) => ({
      instructorSlug: e.instructorSlug,
      mentorshipType: e.mentorshipType,
      notifiedAt: e.notifiedAt!,
    }));
  },
});

/**
 * Returns inventory-change log rows whose `changedAt` falls in
 * `[periodStart, periodEnd]`. Uses the new `inventoryChangeLog`
 * table + `by_changedAt` index (PR 7 schema change). Admin-gated.
 */
export const getInventoryChangesForPeriod = query({
  args: {
    periodStart: v.number(),
    periodEnd: v.number(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    if (!(await isAdminUser(ctx, identity.subject))) throw new Error("Forbidden");

    const rows = await ctx.db
      .query("inventoryChangeLog")
      .withIndex("by_changedAt", (q) =>
        q.gte("changedAt", args.periodStart).lte("changedAt", args.periodEnd)
      )
      .collect();

    return rows.map((r) => ({
      instructorSlug: r.instructorSlug,
      mentorshipType: r.mentorshipType,
      changeType: r.changeType,
      oldValue: r.oldValue,
      newValue: r.newValue,
      changedAt: r.changedAt,
    }));
  },
});

// ----------------------------------------------------------------------------
// Internal queries (no auth check) — used by the digest send action
// (`convex/digestActions.ts`). The action is the trust boundary: the
// HTTP endpoint is gated by CONVEX_HTTP_KEY and the public action is
// admin-gated at its entry, so the reads inside the action don't need
// their own per-query admin check. Public (admin-gated) versions above
// stay for UI hooks.
// ----------------------------------------------------------------------------

export const internalGetAdminDigestSettings = internalQuery({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db.query("adminDigestSettings").first();
    if (!row) {
      return DEFAULT_SETTINGS;
    }
    return {
      enabled: row.enabled ?? false,
      frequency: (row.frequency ?? "weekly") as Frequency,
      adminEmail: row.adminEmail ?? "",
      lastSentAt: row.lastSentAt ?? null,
      updatedAt: row.updatedAt ?? null,
    };
  },
});

export const internalGetInventoryStatusForDigest = internalQuery({
  args: {},
  handler: async (ctx) => {
    const instructors = await ctx.db
      .query("instructors")
      .withIndex("by_deletedAt", (q) => q.eq("deletedAt", undefined))
      .collect();

    return instructors.map((i) => ({
      instructorSlug: i.slug,
      instructorName: i.name,
      oneOnOneInventory: i.oneOnOneInventory ?? 0,
      groupInventory: i.groupInventory ?? 0,
    }));
  },
});

export const internalGetWaitlistSignupsForPeriod = internalQuery({
  args: {
    periodStart: v.number(),
    periodEnd: v.number(),
  },
  handler: async (ctx, args) => {
    const entries = await ctx.db
      .query("marketingWaitlist")
      .withIndex("by_createdAt", (q) =>
        q.gte("createdAt", args.periodStart).lte("createdAt", args.periodEnd)
      )
      .collect();

    return entries.map((e) => ({
      instructorSlug: e.instructorSlug,
      mentorshipType: e.mentorshipType,
      email: e.email,
      createdAt: e.createdAt,
    }));
  },
});

export const internalGetNotificationsSentForPeriod = internalQuery({
  args: {
    periodStart: v.number(),
    periodEnd: v.number(),
  },
  handler: async (ctx, args) => {
    const entries = await ctx.db
      .query("marketingWaitlist")
      .withIndex("by_notifiedAt", (q) =>
        q.gte("notifiedAt", args.periodStart).lte("notifiedAt", args.periodEnd)
      )
      .collect();

    return entries.map((e) => ({
      instructorSlug: e.instructorSlug,
      mentorshipType: e.mentorshipType,
      notifiedAt: e.notifiedAt!,
    }));
  },
});

export const internalGetInventoryChangesForPeriod = internalQuery({
  args: {
    periodStart: v.number(),
    periodEnd: v.number(),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("inventoryChangeLog")
      .withIndex("by_changedAt", (q) =>
        q.gte("changedAt", args.periodStart).lte("changedAt", args.periodEnd)
      )
      .collect();

    return rows.map((r) => ({
      instructorSlug: r.instructorSlug,
      mentorshipType: r.mentorshipType,
      changeType: r.changeType,
      oldValue: r.oldValue,
      newValue: r.newValue,
      changedAt: r.changedAt,
    }));
  },
});

// ----------------------------------------------------------------------------
// Mutations
// ----------------------------------------------------------------------------

/**
 * Upserts the singleton `adminDigestSettings` row. Admin-gated.
 * Validates `frequency` and `adminEmail` server-side.
 */
export const upsertAdminDigestSettings = mutation({
  args: {
    enabled: v.boolean(),
    frequency: v.string(),
    adminEmail: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    if (!(await isAdminUser(ctx, identity.subject))) throw new Error("Forbidden");

    if (!isValidFrequency(args.frequency)) {
      throw new ConvexError({
        code: "INVALID_FREQUENCY",
        message: `Invalid frequency: ${args.frequency}`,
      });
    }
    if (!EMAIL_RE.test(args.adminEmail)) {
      throw new ConvexError({
        code: "INVALID_EMAIL",
        message: `Invalid admin email: ${args.adminEmail}`,
      });
    }

    const now = Date.now();
    const existing = await ctx.db.query("adminDigestSettings").first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        enabled: args.enabled,
        frequency: args.frequency,
        adminEmail: args.adminEmail,
        updatedAt: now,
      });
      return {
        id: existing._id,
        enabled: args.enabled,
        frequency: args.frequency,
        adminEmail: args.adminEmail,
        lastSentAt: existing.lastSentAt ?? null,
        updatedAt: now,
      };
    }
    const id = await ctx.db.insert("adminDigestSettings", {
      enabled: args.enabled,
      frequency: args.frequency,
      adminEmail: args.adminEmail,
      lastSentAt: undefined,
      updatedAt: now,
    });
    return {
      id,
      enabled: args.enabled,
      frequency: args.frequency,
      adminEmail: args.adminEmail,
      lastSentAt: null,
      updatedAt: now,
    };
  },
});

/**
 * Marks the singleton `adminDigestSettings.lastSentAt = now()`.
 * Called by the `sendAdminDigestEmail` action after a successful
 * Resend send. Internal mutation so the action can call it via
 * `ctx.runMutation` without exposing it on the public API.
 */
export const markAdminDigestSent = internalMutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db.query("adminDigestSettings").first();
    if (!existing) {
      // No-op if the row was deleted between the action's read and this
      // mutation. The action's report still records the email was sent.
      return null;
    }
    const now = Date.now();
    await ctx.db.patch(existing._id, {
      lastSentAt: now,
      updatedAt: now,
    });
    return { lastSentAt: now, updatedAt: now };
  },
});

/**
 * Bulk-imports `inventoryChangeLog` rows from Supabase. Server-only:
 * called by the one-time migration script
 * `scripts/migrate-inventory-change-log.ts`. Gated by CONVEX_HTTP_KEY
 * (the corresponding `httpBulkImportInventoryChangeLog` action in
 * `convex/http.ts` calls this). Idempotent: skips entries that
 * already exist (matched by `legacyId`).
 */
export const internalBulkImportInventoryChangeLog = internalMutation({
  args: {
    entries: v.array(
      v.object({
        instructorSlug: v.string(),
        mentorshipType: v.optional(
          v.union(v.literal("oneOnOne"), v.literal("group"))
        ),
        changeType: v.union(
          v.literal("manual_update"),
          v.literal("kajabi_purchase")
        ),
        oldValue: v.number(),
        newValue: v.number(),
        changedAt: v.number(),
        source: v.optional(v.string()),
        purchaseId: v.optional(v.string()),
        legacyId: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args) => {
    let inserted = 0;
    let skipped = 0;
    let backfilledSource = 0;
    for (const entry of args.entries) {
      if (entry.legacyId) {
        const existing = await ctx.db
          .query("inventoryChangeLog")
          .withIndex("by_legacyId", (q) => q.eq("legacyId", entry.legacyId))
          .first();
        if (existing) {
          // Backfill `source` on rows imported before the field
          // existed (PR 7 dropped the Supabase `changed_by` column).
          // The new script now reads it; patch in place if missing.
          if (entry.source && !existing.source) {
            await ctx.db.patch(existing._id, { source: entry.source });
            backfilledSource++;
          }
          skipped++;
          continue;
        }
      }
      await ctx.db.insert("inventoryChangeLog", {
        instructorSlug: entry.instructorSlug,
        mentorshipType: entry.mentorshipType,
        changeType: entry.changeType,
        oldValue: entry.oldValue,
        newValue: entry.newValue,
        changedAt: entry.changedAt,
        source: entry.source,
        purchaseId: entry.purchaseId,
        legacyId: entry.legacyId,
      });
      inserted++;
    }
    return { success: true, inserted, skipped, backfilledSource };
  },
});

// ----------------------------------------------------------------------------
// Action lives in `convex/digestActions.ts` ("use node" file).
// ----------------------------------------------------------------------------
