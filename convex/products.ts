import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

/** Returns a single product by ID, or null if not authenticated. */
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

/** Returns all products belonging to a specific instructor. */
export const getInstructorProducts = query({
  args: { mentorId: v.id("instructors") },
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

/** Returns all products marked as active (requires auth). */
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

/** Returns a product matching the given Stripe price ID. */
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

/** Returns all active products without requiring authentication. */
export const getPublicActiveProducts = query({
  handler: async (ctx) => {
    return await ctx.db
      .query("products")
      .withIndex("by_active", (q) => q.eq("active", true))
      .collect();
  },
});

/** Returns products for a given instructor without requiring authentication. */
export const getProductsByInstructorId = query({
  args: { mentorId: v.id("instructors") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("products")
      .withIndex("by_mentorId", (q) => q.eq("mentorId", args.mentorId))
      .collect();
  },
});

/** Returns products for an instructor, optionally filtered by mentorship type (no auth). */
export const getProductsByInstructorAndType = query({
  args: {
    mentorId: v.id("instructors"),
    mentorshipType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const products = await ctx.db
      .query("products")
      .withIndex("by_mentorId", (q) => q.eq("mentorId", args.mentorId))
      .collect();

    if (args.mentorshipType) {
      return products.filter((p) => p.mentorshipType === args.mentorshipType);
    }
    return products;
  },
});

/** Returns a product with instructor info for admin (requires auth). */
export const getProductForAdmin = query({
  args: { id: v.id("products") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    const product = await ctx.db.get(args.id);
    if (!product) return null;

    let instructorName = "Unknown Instructor";
    if (product.mentorId) {
      const instructor = await ctx.db
        .query("instructors")
        .filter((q) => q.eq(q.field("mentorId"), product.mentorId))
        .first();
      if (instructor?.name) {
        instructorName = instructor.name;
      }
    }

    return {
      ...product,
      instructorName,
    };
  },
});

/** Creates a new product with the given details. */
export const createProduct = mutation({
  args: {
    mentorId: v.id("instructors"),
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

/** Updates an existing product's fields and returns the updated document. */
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

/** Soft-deletes a product by setting its deletedAt timestamp. */
export const deleteProduct = mutation({
  args: { id: v.id("products") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { deletedAt: Date.now() });
  },
});

/** Deactivates a product by setting active to false and returns the updated document. */
export const deactivateProduct = mutation({
  args: { id: v.id("products") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { active: false });
    return await ctx.db.get(args.id);
  },
});

/** Activates a product by setting active to true and returns the updated document. */
export const activateProduct = mutation({
  args: { id: v.id("products") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { active: true });
    return await ctx.db.get(args.id);
  },
});
