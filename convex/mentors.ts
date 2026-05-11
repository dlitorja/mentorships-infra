import { internalQuery, internalMutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * @deprecated This module is deprecated. The mentors table is no longer used for Clerk user linking.
 * Instructors are now directly linked to Clerk users via the `userId` field on the instructors table.
 * This file is retained for potential historical data migration purposes only.
 */

export const getMentorByUserId = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("mentors")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();
  },
});

export const getOrCreateMentor = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("mentors")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();

    if (existing) {
      return existing._id;
    }

    return await ctx.db.insert("mentors", {
      userId: args.userId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});

export const deleteMentorByUserId = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const mentor = await ctx.db
      .query("mentors")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();

    if (mentor) {
      await ctx.db.delete(mentor._id);
      return { success: true, deletedId: mentor._id };
    }

    return { success: false, deletedId: null };
  },
});