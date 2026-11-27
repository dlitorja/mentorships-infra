import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";

/**
 * Durable in-app notifications for lifecycle events.
 *
 * The bell already merges ad-hoc call invites and recording-ready rows. Those
 * are ephemeral and have their own read semantics, so they stay separate. This
 * module owns the "something happened in your mentorship" items: a new
 * student, a submitted questionnaire, a renewal reminder, seat grace/release.
 *
 * Every row carries a `dedupeKey`. Inngest steps and webhook deliveries retry,
 * and a retry must not double-post a notification. Convex has no unique index,
 * so `createNotification` reads the key first; the surrounding mutation
 * transaction keeps that read-then-insert atomic.
 */

const kindValidator = v.union(
  v.literal("new_student"),
  v.literal("questionnaire_submitted"),
  v.literal("renewal_due"),
  v.literal("seat_grace"),
  v.literal("seat_released"),
  v.literal("fulfilment_problem")
);

export type NotificationKind =
  | "new_student"
  | "questionnaire_submitted"
  | "renewal_due"
  | "seat_grace"
  | "seat_released"
  | "fulfilment_problem";

type CreateNotificationArgs = {
  userId: string;
  kind: NotificationKind;
  title: string;
  body?: string;
  href?: string;
  dedupeKey: string;
};

/**
 * Inserts a notification unless one with the same `dedupeKey` exists.
 * Callable from mutations directly; the action-facing wrapper is `create`.
 */
export async function createNotification(
  ctx: MutationCtx,
  args: CreateNotificationArgs
): Promise<Doc<"notifications"> | null> {
  const existing = await ctx.db
    .query("notifications")
    .withIndex("by_dedupeKey", (q) => q.eq("dedupeKey", args.dedupeKey))
    .first();

  if (existing) {
    return existing;
  }

  const id = await ctx.db.insert("notifications", {
    userId: args.userId,
    kind: args.kind,
    title: args.title,
    body: args.body,
    href: args.href,
    dedupeKey: args.dedupeKey,
    read: false,
    createdAt: Date.now(),
  });

  return await ctx.db.get(id);
}

/** Service-key wrapper used by Inngest steps (`/notifications/create`). */
export const create = internalMutation({
  args: {
    userId: v.string(),
    kind: kindValidator,
    title: v.string(),
    body: v.optional(v.string()),
    href: v.optional(v.string()),
    dedupeKey: v.string(),
  },
  handler: async (ctx, args) => {
    return await createNotification(ctx, args);
  },
});

/** Unread lifecycle notifications for the signed-in user, newest first. */
export const listUnreadForUser = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    const limit = Math.min(Math.max(args.limit ?? 20, 1), 50);

    // Read straight from the unread index. Taking the newest N of ALL rows
    // first (read + unread) hid older unread items once the new ones were
    // marked read.
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_userId_read_createdAt", (q) =>
        q.eq("userId", identity.subject).eq("read", false)
      )
      .order("desc")
      .collect();

    return rows.slice(0, limit);
  },
});

/** Marks one notification read. Scoped to the caller. */
export const markRead = mutation({
  args: { notificationId: v.id("notifications") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    const row = await ctx.db.get(args.notificationId);
    if (!row) return null;
    if (row.userId !== identity.subject) throw new Error("Forbidden");
    if (row.read) return row;

    await ctx.db.patch(row._id, { read: true, readAt: Date.now() });
    return await ctx.db.get(row._id);
  },
});

/** Marks every unread notification for the caller read. */
export const markAllRead = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    // Collect every unread row instead of the newest 200: a busy bell could
    // leave older rows permanently unread behind the cap.
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_userId_read_createdAt", (q) =>
        q.eq("userId", identity.subject).eq("read", false)
      )
      .collect();

    const now = Date.now();
    for (const row of rows) {
      await ctx.db.patch(row._id, { read: true, readAt: now });
    }
    return { updated: rows.length };
  },
});

/** Internal count for tests/diagnostics. */
export const countUnreadForUser = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity || identity.subject !== args.userId) return null;

    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_userId_read_createdAt", (q) =>
        q.eq("userId", args.userId).eq("read", false)
      )
      .collect();
    return rows.length;
  },
});
