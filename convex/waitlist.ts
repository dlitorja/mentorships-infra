import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const getWaitlistForInstructor = query({
  args: {
    instructorSlug: v.string(),
    mentorshipType: v.optional(v.union(v.literal("oneOnOne"), v.literal("group"))),
  },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return [];
    }

    let q = ctx.db
      .query("marketingWaitlist")
      .withIndex("by_instructorSlug_mentorshipType", (q) =>
        q.eq("instructorSlug", args.instructorSlug)
      );

    if (args.mentorshipType) {
      return await q.filter((q) => q.eq(q.field("mentorshipType"), args.mentorshipType)).collect();
    }
    return await q.collect();
  },
});

export const getWaitlistCounts = query({
  args: { instructorSlug: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return { oneOnOne: 0, group: 0 };
    }

    const entries = await ctx.db
      .query("marketingWaitlist")
      .withIndex("by_instructorSlug_mentorshipType", (q) =>
        q.eq("instructorSlug", args.instructorSlug)
      )
      .collect();

    const counts = { oneOnOne: 0, group: 0 };
    for (const entry of entries) {
      if (entry.mentorshipType === "oneOnOne") {
        counts.oneOnOne++;
      } else {
        counts.group++;
      }
    }
    return counts;
  },
});

export const getWaitlistStatus = query({
  args: {
    email: v.string(),
    instructorSlug: v.string(),
  },
  handler: async (ctx, args) => {
    const entry = await ctx.db
      .query("marketingWaitlist")
      .withIndex("by_email_instructorSlug", (q) =>
        q.eq("email", args.email).eq("instructorSlug", args.instructorSlug)
      )
      .first();

    if (!entry) {
      return { onWaitlist: false, mentorshipType: null };
    }

    return {
      onWaitlist: true,
      mentorshipType: entry.mentorshipType,
      notifiedAt: entry.notifiedAt,
      createdAt: entry.createdAt,
    };
  },
});

export const addToWaitlist = mutation({
  args: {
    email: v.string(),
    instructorSlug: v.string(),
    mentorshipType: v.union(v.literal("oneOnOne"), v.literal("group")),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("marketingWaitlist")
      .withIndex("by_email_instructorSlug", (q) =>
        q.eq("email", args.email).eq("instructorSlug", args.instructorSlug)
      )
      .first();

    if (existing) {
      if (existing.mentorshipType === args.mentorshipType) {
        return { success: false, message: "Already on waitlist for this type", existingId: existing._id };
      }
      await ctx.db.patch(existing._id, { mentorshipType: args.mentorshipType });
      return { success: true, message: "Updated waitlist type", existingId: existing._id };
    }

    const id = await ctx.db.insert("marketingWaitlist", {
      email: args.email,
      instructorSlug: args.instructorSlug,
      mentorshipType: args.mentorshipType,
      createdAt: Date.now(),
    });
    return { success: true, message: "Added to waitlist", id };
  },
});

export const removeFromWaitlist = mutation({
  args: { id: v.id("marketingWaitlist") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
    return { success: true };
  },
});

export const removeMultipleFromWaitlist = mutation({
  args: { ids: v.array(v.id("marketingWaitlist")) },
  handler: async (ctx, args) => {
    for (const id of args.ids) {
      await ctx.db.delete(id);
    }
    return { success: true, count: args.ids.length };
  },
});

export const removeByEmail = mutation({
  args: {
    email: v.string(),
    instructorSlug: v.string(),
    mentorshipType: v.optional(v.union(v.literal("oneOnOne"), v.literal("group"))),
  },
  handler: async (ctx, args) => {
    const entries = await ctx.db
      .query("marketingWaitlist")
      .withIndex("by_email_instructorSlug", (q) =>
        q.eq("email", args.email).eq("instructorSlug", args.instructorSlug)
      )
      .collect();

    let deleted = 0;
    for (const entry of entries) {
      if (!args.mentorshipType || entry.mentorshipType === args.mentorshipType) {
        await ctx.db.delete(entry._id);
        deleted++;
      }
    }
    return { success: true, count: deleted };
  },
});

export const markNotified = mutation({
  args: { ids: v.array(v.id("marketingWaitlist")) },
  handler: async (ctx, args) => {
    for (const id of args.ids) {
      await ctx.db.patch(id, { notifiedAt: Date.now() });
    }
    return { success: true, count: args.ids.length };
  },
});

export const markNotifiedByInstructor = mutation({
  args: {
    instructorSlug: v.string(),
    mentorshipType: v.optional(v.union(v.literal("oneOnOne"), v.literal("group"))),
  },
  handler: async (ctx, args) => {
    const entries = await ctx.db
      .query("marketingWaitlist")
      .withIndex("by_instructorSlug_mentorshipType", (q) =>
        q.eq("instructorSlug", args.instructorSlug)
      )
      .collect();

    let count = 0;
    for (const entry of entries) {
      if ((!args.mentorshipType || entry.mentorshipType === args.mentorshipType) && !entry.notifiedAt) {
        await ctx.db.patch(entry._id, { notifiedAt: Date.now() });
        count++;
      }
    }
    return { success: true, count };
  },
});

export const getUnnotifiedWaitlist = query({
  args: {
    instructorSlug: v.string(),
    mentorshipType: v.optional(v.union(v.literal("oneOnOne"), v.literal("group"))),
  },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return [];
    }

    const entries = await ctx.db
      .query("marketingWaitlist")
      .withIndex("by_instructorSlug_mentorshipType", (q) =>
        q.eq("instructorSlug", args.instructorSlug)
      )
      .collect();

    return entries.filter((entry) => {
      if (!args.mentorshipType || entry.mentorshipType === args.mentorshipType) {
        return entry.notifiedAt === undefined;
      }
      return false;
    });
  },
});