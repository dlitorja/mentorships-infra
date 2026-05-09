import { mutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

export const migrateUserIdentity = mutation({
  args: {
    userId: v.string(),
    provider: v.union(v.literal("discord")),
    providerUserId: v.string(),
    connectedAt: v.optional(v.number()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existingByUserProvider = await ctx.db
      .query("userIdentities")
      .withIndex("by_userId_provider", (q) =>
        q.eq("userId", args.userId).eq("provider", args.provider)
      )
      .first();

    if (existingByUserProvider) {
      const updates: Record<string, unknown> = {};
      if (args.providerUserId) updates.providerUserId = args.providerUserId;
      if (args.connectedAt) updates.connectedAt = args.connectedAt;
      if (args.updatedAt) updates.updatedAt = args.updatedAt;

      if (Object.keys(updates).length > 0) {
        await ctx.db.patch(existingByUserProvider._id, updates);
      }
      return { action: "updated", id: existingByUserProvider._id };
    }

    const existingByProviderUser = await ctx.db
      .query("userIdentities")
      .withIndex("by_providerUserId", (q) => q.eq("providerUserId", args.providerUserId))
      .first();

    if (existingByProviderUser) {
      const updates: Record<string, unknown> = {};
      if (args.userId) updates.userId = args.userId;
      if (args.connectedAt) updates.connectedAt = args.connectedAt;

      if (Object.keys(updates).length > 0) {
        await ctx.db.patch(existingByProviderUser._id, updates);
      }
      return { action: "updated", id: existingByProviderUser._id };
    }

    const insertResult = await ctx.db.insert("userIdentities", {
      userId: args.userId,
      provider: args.provider,
      providerUserId: args.providerUserId,
      connectedAt: args.connectedAt ?? undefined,
      createdAt: args.createdAt ?? undefined,
      updatedAt: args.updatedAt ?? undefined,
    });

    return { action: "inserted", id: insertResult };
  },
});

export const getByUserIdAndProvider = internalQuery({
  args: {
    userId: v.string(),
    provider: v.union(v.literal("discord")),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("userIdentities")
      .withIndex("by_userId_provider", (q) =>
        q.eq("userId", args.userId).eq("provider", args.provider)
      )
      .first();
  },
});