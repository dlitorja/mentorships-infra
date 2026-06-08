import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

/**
 * Adds a new contact or returns existing contact if email already exists.
 * Normalizes email to lowercase and trims whitespace.
 * Defaults source to "matching_form" if not provided.
 */
export const addContact = mutation({
  args: {
    email: v.string(),
    artGoals: v.optional(v.string()),
    source: v.optional(v.string()),
    optedIn: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const normalizedEmail = args.email.toLowerCase().trim();

    const existing = await ctx.db
      .query("contacts")
      .withIndex("by_email", (q) => q.eq("email", normalizedEmail))
      .first();

    if (existing) {
      return { success: true, contact: existing, created: false };
    }

    const id = await ctx.db.insert("contacts", {
      email: normalizedEmail,
      artGoals: args.artGoals,
      source: args.source ?? "matching_form",
      optedIn: args.optedIn ?? true,
    });

    const inserted = await ctx.db.get(id);
    if (!inserted) throw new Error("Failed to create contact");
    return { success: true, contact: inserted, created: true };
  },
});

/**
 * Fetches a contact by their email address.
 * Returns null if not found.
 */
export const getContactByEmail = query({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const normalizedEmail = args.email.toLowerCase().trim();
    return await ctx.db
      .query("contacts")
      .withIndex("by_email", (q) => q.eq("email", normalizedEmail))
      .first();
  },
});

/**
 * Migrates a contact from legacy system.
 * Updates existing contact if found by email, otherwise creates new.
 */
export const migrateContact = mutation({
  args: {
    email: v.string(),
    artGoals: v.optional(v.string()),
    source: v.optional(v.string()),
    optedIn: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const normalizedEmail = args.email.toLowerCase().trim();

    const existing = await ctx.db
      .query("contacts")
      .withIndex("by_email", (q) => q.eq("email", normalizedEmail))
      .first();

    if (existing) {
      const updates: Record<string, unknown> = {};
      if (args.artGoals !== undefined) updates.artGoals = args.artGoals;
      if (args.source !== undefined) updates.source = args.source;
      if (args.optedIn !== undefined) updates.optedIn = args.optedIn;

      if (Object.keys(updates).length > 0) {
        await ctx.db.patch(existing._id, updates);
      }
      return { action: "updated", id: existing._id };
    }

    const id = await ctx.db.insert("contacts", {
      email: normalizedEmail,
      artGoals: args.artGoals ?? undefined,
      source: args.source ?? undefined,
      optedIn: args.optedIn ?? undefined,
    });

    return { action: "inserted", id };
  },
});