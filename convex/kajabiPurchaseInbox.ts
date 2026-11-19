import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";

/**
 * Email-intake queue for Kajabi purchase confirmations.
 *
 * The current Kajabi plan does not expose webhooks, so `support@` is a
 * recipient on each offer. Resend receives the confirmation, an Inngest poll
 * parses it and calls `upsertFromEmail`, and an admin approves the onboarding
 * from `/admin/kajabi-purchases`.
 *
 * Approval never happens implicitly: an email only creates a `pending` row.
 */

const PURCHASE_STATUS = v.union(
  v.literal("pending"),
  v.literal("approved"),
  v.literal("dismissed")
);

async function requireStaff(
  ctx: QueryCtx | MutationCtx
): Promise<{ subject: string }> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Unauthorized");
  const user = await ctx.db
    .query("users")
    .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
    .first();
  if (!user || (user.role !== "admin" && user.role !== "support")) {
    throw new Error("Forbidden: admin or support role required");
  }
  return identity as { subject: string };
}

/**
 * Idempotent upsert called by the Resend inbox poll (bearer-auth HTTP).
 * Dedupes on the Resend email id and, when present, the Kajabi purchase id,
 * so forwarding the same confirmation twice does not create two rows.
 */
export const upsertFromEmail = internalMutation({
  args: {
    resendEmailId: v.string(),
    resendThreadId: v.optional(v.string()),
    fromAddress: v.string(),
    subject: v.string(),
    receivedAt: v.number(),
    offerTitle: v.string(),
    purchaseType: v.union(
      v.literal("one-on-one"),
      v.literal("group"),
      v.literal("unknown")
    ),
    instructorName: v.optional(v.string()),
    studentName: v.optional(v.string()),
    studentEmail: v.optional(v.string()),
    kajabiPurchaseId: v.optional(v.string()),
    kajabiContactId: v.optional(v.string()),
    rawText: v.string(),
  },
  handler: async (ctx, args) => {
    const byEmail = await ctx.db
      .query("kajabiPurchaseInbox")
      .withIndex("by_resendEmailId", (q) =>
        q.eq("resendEmailId", args.resendEmailId)
      )
      .first();
    if (byEmail) {
      return { purchaseId: byEmail._id, inserted: false, status: byEmail.status };
    }

    if (args.kajabiPurchaseId) {
      const byPurchase = await ctx.db
        .query("kajabiPurchaseInbox")
        .withIndex("by_kajabiPurchaseId", (q) =>
          q.eq("kajabiPurchaseId", args.kajabiPurchaseId)
        )
        .first();
      if (byPurchase) {
        return {
          purchaseId: byPurchase._id,
          inserted: false,
          status: byPurchase.status,
        };
      }
    }

    const now = Date.now();
    const purchaseId = await ctx.db.insert("kajabiPurchaseInbox", {
      resendEmailId: args.resendEmailId,
      resendThreadId: args.resendThreadId,
      fromAddress: args.fromAddress,
      subject: args.subject,
      receivedAt: args.receivedAt,
      offerTitle: args.offerTitle,
      purchaseType: args.purchaseType,
      instructorName: args.instructorName,
      studentName: args.studentName,
      studentEmail: args.studentEmail,
      kajabiPurchaseId: args.kajabiPurchaseId,
      kajabiContactId: args.kajabiContactId,
      rawText: args.rawText.slice(0, 20_000),
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });

    return { purchaseId, inserted: true, status: "pending" as const };
  },
});

export const listPurchases = query({
  args: {
    status: PURCHASE_STATUS,
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireStaff(ctx);
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 100);
    const rows = await ctx.db
      .query("kajabiPurchaseInbox")
      .withIndex("by_status_createdAt", (q) => q.eq("status", args.status))
      .order("desc")
      .take(limit);

    return rows.map((row) => ({
      _id: row._id,
      subject: row.subject,
      receivedAt: row.receivedAt,
      offerTitle: row.offerTitle,
      purchaseType: row.purchaseType,
      instructorName: row.instructorName,
      studentName: row.studentName,
      studentEmail: row.studentEmail,
      kajabiPurchaseId: row.kajabiPurchaseId,
      status: row.status,
      onboardingId: row.onboardingId,
      createdAt: row.createdAt,
    }));
  },
});

export const getPurchase = query({
  args: { id: v.id("kajabiPurchaseInbox") },
  handler: async (ctx, args) => {
    await requireStaff(ctx);
    return await ctx.db.get(args.id);
  },
});

export const dismissPurchase = mutation({
  args: {
    id: v.id("kajabiPurchaseInbox"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await requireStaff(ctx);
    const row = await ctx.db.get(args.id);
    if (!row) throw new Error("Purchase not found");
    if (row.status === "approved") {
      throw new Error("This purchase is already approved");
    }
    await ctx.db.patch(args.id, {
      status: "dismissed",
      dismissedByUserId: identity.subject,
      dismissedAt: Date.now(),
      dismissReason: args.reason,
      updatedAt: Date.now(),
    });
    return { ok: true as const };
  },
});

export type KajabiPurchaseInboxDoc = Doc<"kajabiPurchaseInbox">;
export type KajabiPurchaseInboxId = Id<"kajabiPurchaseInbox">;
