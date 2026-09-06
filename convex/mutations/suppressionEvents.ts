import { internalMutation } from "../_generated/server";
import { v } from "convex/values";

export const upsertSuppressionEvent = internalMutation({
  args: {
    kind: v.union(v.literal("bounce"), v.literal("complaint"), v.literal("unsubscribe")),
    email: v.string(),
    domain: v.string(),
    resendId: v.string(),
    bounceType: v.optional(v.string()),
    reason: v.optional(v.string()),
    receivedAt: v.number(),
    occurredAt: v.number(),
    audienceId: v.optional(v.string()),
    raw: v.any(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("suppressionEvents")
      .withIndex("by_resendId_and_kind", (q) =>
        q.eq("resendId", args.resendId).eq("kind", args.kind)
      )
      .first();

    if (existing) {
      return { id: existing._id, created: false };
    }

    const id = await ctx.db.insert("suppressionEvents", args);
    return { id, created: true };
  },
});
