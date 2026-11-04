import { internalMutation, internalQuery, mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { v } from "convex/values";

/**
 * Migrates a user identity (e.g., Discord) from legacy system.
 * Handles both userId+provider and providerUserId lookup for conflict resolution.
 */
export const migrateUserIdentity = internalMutation({
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

async function upsertIdentity(
  ctx: MutationCtx,
  args: {
    userId: string;
    provider: "discord";
    providerUserId: string;
  }
) {
  const existing = await ctx.db
    .query("userIdentities")
    .withIndex("by_userId_provider", (q) =>
      q.eq("userId", args.userId).eq("provider", args.provider)
    )
    .first();

  if (existing) {
    return existing;
  }

  const insertResult = await ctx.db.insert("userIdentities", {
    userId: args.userId,
    provider: args.provider,
    providerUserId: args.providerUserId,
    connectedAt: Date.now(),
  });

  return {
    _id: insertResult,
    userId: args.userId,
    provider: args.provider,
    providerUserId: args.providerUserId,
  };
}

/**
 * Server-side upsert for Inngest onboarding workers. Callers use the
 * bearer `/user-identities/upsert` endpoint.
 */
export const upsertUserIdentityInternal = internalMutation({
  args: {
    userId: v.string(),
    provider: v.union(v.literal("discord")),
    providerUserId: v.string(),
  },
  handler: async (ctx, args) => {
    return await upsertIdentity(ctx, args);
  },
});

/**
 * Links the authenticated caller's Discord identity to their own Clerk
 * user id. Used by the user-facing Discord role sync route; the caller
 * cannot choose another user's id.
 */
export const linkMyDiscordIdentity = mutation({
  args: { providerUserId: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    return await upsertIdentity(ctx, {
      userId: identity.subject,
      provider: "discord",
      providerUserId: args.providerUserId,
    });
  },
});

/**
 * Internal query to fetch a user identity by userId and provider.
 * Server-side only - not exposed to public API.
 */
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