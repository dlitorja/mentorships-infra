import { mutation } from "./_generated/server";
import { v } from "convex/values";

export const migrateDiscordAction = mutation({
  args: {
    type: v.union(
      v.literal("assign_mentee_role"),
      v.literal("dm_instructor_new_signup")
    ),
    subjectUserId: v.string(),
    mentorId: v.optional(v.string()),
    mentorUserId: v.optional(v.string()),
    payload: v.optional(v.any()),
    status: v.optional(v.union(v.literal("pending"), v.literal("processing"), v.literal("done"), v.literal("failed"))),
    attempts: v.optional(v.number()),
    lastError: v.optional(v.string()),
    lockedAt: v.optional(v.number()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existingBySubjectUserId = await ctx.db
      .query("discordActionQueue")
      .withIndex("by_subjectUserId", (q) =>
        q.eq("subjectUserId", args.subjectUserId)
      )
      .first();

    if (existingBySubjectUserId) {
      const updates: Record<string, unknown> = {};
      if (args.type) updates.type = args.type;
      if (args.mentorId !== undefined) updates.mentorId = args.mentorId;
      if (args.mentorUserId !== undefined) updates.mentorUserId = args.mentorUserId;
      if (args.payload !== undefined) updates.payload = args.payload;
      if (args.status) updates.status = args.status;
      if (args.attempts !== undefined) updates.attempts = args.attempts;
      if (args.lastError !== undefined) updates.lastError = args.lastError;
      if (args.lockedAt !== undefined) updates.lockedAt = args.lockedAt;
      if (args.updatedAt) updates.updatedAt = args.updatedAt;

      if (Object.keys(updates).length > 0) {
        await ctx.db.patch(existingBySubjectUserId._id, updates);
      }
      return { action: "updated", id: existingBySubjectUserId._id };
    }

    const insertResult = await ctx.db.insert("discordActionQueue", {
      type: args.type,
      subjectUserId: args.subjectUserId,
      mentorId: args.mentorId ?? undefined,
      mentorUserId: args.mentorUserId ?? undefined,
      payload: args.payload ?? undefined,
      status: args.status ?? "pending",
      attempts: args.attempts ?? 0,
      lastError: args.lastError ?? undefined,
      lockedAt: args.lockedAt ?? undefined,
      createdAt: args.createdAt ?? Date.now(),
      updatedAt: args.updatedAt ?? Date.now(),
    });

    return { action: "inserted", id: insertResult };
  },
});