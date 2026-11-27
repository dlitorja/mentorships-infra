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

    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_userId_createdAt", (q) => q.eq("userId", identity.subject))
      .order("desc")
      .take(limit * 3);

    return rows.filter((row) => row.readAt === undefined).slice(0, limit);
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
    if (row.readAt !== undefined) return row;

    await ctx.db.patch(row._id, { readAt: Date.now() });
    return await ctx.db.get(row._id);
  },
});

/** Marks every unread notification for the caller read. */
export const markAllRead = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_userId_createdAt", (q) => q.eq("userId", identity.subject))
      .order("desc")
      .take(200);

    const now = Date.now();
    let updated = 0;
    for (const row of rows) {
      if (row.readAt !== undefined) continue;
      await ctx.db.patch(row._id, { readAt: now });
      updated += 1;
    }
    return { updated };
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
      .withIndex("by_userId_createdAt", (q) => q.eq("userId", args.userId))
      .collect();
    return rows.filter((row) => row.readAt === undefined).length;
  },
});
