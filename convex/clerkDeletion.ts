import { mutation, internalMutation, internalAction } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";

async function deleteClerkUser(clerkUserId: string): Promise<void> {
  const clerkSecretKey = process.env.CLERK_SECRET_KEY;
  if (!clerkSecretKey) {
    throw new Error("CLERK_SECRET_KEY is not set");
  }

  const response = await fetch(`https://api.clerk.com/v1/users/${clerkUserId}`, {
    method: "DELETE",
    headers: {
      "Authorization": `Bearer ${clerkSecretKey}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok && response.status !== 404) {
    const errorText = await response.text();
    throw new Error(`Clerk API error: ${response.status} ${errorText}`);
  }
}

export const addPendingClerkDeletion = mutation({
  args: {
    clerkUserId: v.string(),
    instructorId: v.id("instructors"),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("pendingClerkDeletions")
      .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", args.clerkUserId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        attempts: (existing.attempts ?? 0) + 1,
        lastError: args.error,
      });
      return existing._id;
    }

    return await ctx.db.insert("pendingClerkDeletions", {
      clerkUserId: args.clerkUserId,
      instructorId: args.instructorId,
      attempts: 1,
      lastError: args.error,
      createdAt: Date.now(),
    });
  },
});

export const claimPendingClerkDeletions = internalMutation({
  args: { limit: v.number(), lockTtlMs: v.number() },
  handler: async (ctx, args) => {
    const staleBefore = Date.now() - args.lockTtlMs;
    const all = await ctx.db.query("pendingClerkDeletions").collect();

    const pending = all.filter((p) => p.attempts === undefined || p.attempts < 3);
    const claimed = pending.slice(0, args.limit);

    return claimed.map((p) => ({
      clerkUserId: p.clerkUserId,
      instructorId: p.instructorId,
      attempts: p.attempts ?? 0,
    }));
  },
});

export const deletePendingClerkDeletion = internalMutation({
  args: { clerkUserId: v.string() },
  handler: async (ctx, args) => {
    const pending = await ctx.db
      .query("pendingClerkDeletions")
      .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", args.clerkUserId))
      .first();

    if (pending) {
      await ctx.db.delete(pending._id);
    }
  },
});

export const markClerkDeletionFailed = internalMutation({
  args: {
    clerkUserId: v.string(),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const pending = await ctx.db
      .query("pendingClerkDeletions")
      .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", args.clerkUserId))
      .first();

    if (pending) {
      await ctx.db.patch(pending._id, {
        attempts: (pending.attempts ?? 0) + 1,
        lastError: args.error,
      });
    }
  },
});

export const processPendingClerkDeletions = internalAction({
  args: {},
  handler: async (ctx) => {
    const claimed = await ctx.runMutation(internal.clerkDeletion.claimPendingClerkDeletions, {
      limit: 25,
      lockTtlMs: 10 * 60 * 1000,
    });

    for (const item of claimed) {
      try {
        await deleteClerkUser(item.clerkUserId);
        console.log(`[processPendingClerkDeletions] Successfully deleted Clerk user: ${item.clerkUserId}`);

        await ctx.runMutation(internal.clerkDeletion.deletePendingClerkDeletion, {
          clerkUserId: item.clerkUserId,
        });
      } catch (error) {
        console.error(`[processPendingClerkDeletions] Failed to delete Clerk user ${item.clerkUserId}:`, error);

        await ctx.runMutation(internal.clerkDeletion.markClerkDeletionFailed, {
          clerkUserId: item.clerkUserId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  },
});