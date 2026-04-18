import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const getProductById = query({
  args: { id: v.id("products") },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return null;
    }
    return await ctx.db.get(args.id);
  },
});

export const getMentorProducts = query({
  args: { mentorId: v.id("mentors") },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return [];
    }
    return await ctx.db
      .query("products")
      .withIndex("by_mentorId", (q) => q.eq("mentorId", args.mentorId))
      .collect();
  },
});

export const getActiveProducts = query({
  handler: async (ctx) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return [];
    }
    return await ctx.db
      .query("products")
      .withIndex("by_active", (q) => q.eq("active", true))
      .collect();
  },
});

export const getProductByStripePriceId = query({
  args: { stripePriceId: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return null;
    }
    return await ctx.db
      .query("products")
      .withIndex("by_stripePriceId", (q) => q.eq("stripePriceId", args.stripePriceId))
      .first();
  },
});

export const createProduct = mutation({
  args: {
    mentorId: v.id("mentors"),
    title: v.string(),
    description: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    price: v.string(),
    currency: v.optional(v.string()),
    sessionsPerPack: v.optional(v.number()),
    validityDays: v.optional(v.number()),
    stripePriceId: v.optional(v.string()),
    stripeProductId: v.optional(v.string()),
    paypalProductId: v.optional(v.string()),
    mentorshipType: v.optional(v.string()),
    active: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("products", {
      ...args,
      currency: args.currency ?? "usd",
      sessionsPerPack: args.sessionsPerPack ?? 4,
      validityDays: args.validityDays ?? 30,
      mentorshipType: args.mentorshipType ?? "one-on-one",
      active: args.active ?? true,
    });
  },
});

export const updateProduct = mutation({
  args: {
    id: v.id("products"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    price: v.optional(v.string()),
    sessionsPerPack: v.optional(v.number()),
    validityDays: v.optional(v.number()),
    stripePriceId: v.optional(v.string()),
    stripeProductId: v.optional(v.string()),
    paypalProductId: v.optional(v.string()),
    mentorshipType: v.optional(v.string()),
    active: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    await ctx.db.patch(id, updates);
    return await ctx.db.get(id);
  },
});

export const deleteProduct = mutation({
  args: { id: v.id("products") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { deletedAt: Date.now() });
  },
});

export const deactivateProduct = mutation({
  args: { id: v.id("products") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { active: false });
    return await ctx.db.get(args.id);
  },
});

export const activateProduct = mutation({
  args: { id: v.id("products") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { active: true });
    return await ctx.db.get(args.id);
  },
});
