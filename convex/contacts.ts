import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

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