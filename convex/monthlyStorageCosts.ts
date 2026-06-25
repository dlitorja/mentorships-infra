import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { QueryCtx } from "./_generated/server";

async function isAdmin(ctx: QueryCtx, userId: string): Promise<boolean> {
  const user = await ctx.db
    .query("users")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .first();
  return user?.role === "admin";
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      throw new Error("Unauthorized");
    }

    const adminCheck = await isAdmin(ctx, user.subject);
    if (!adminCheck) {
      throw new Error("Admin access required");
    }

    const allCosts = await ctx.db.query("monthlyStorageCosts").collect();
    
    const sorted = allCosts.sort((a, b) => b.month.localeCompare(a.month));
    
    const currentMonth = new Date().toISOString().slice(0, 7);
    const currentRecord = sorted.find((c) => c.month === currentMonth);
    
    return {
      currentMonth: currentRecord ?? {
        month: currentMonth,
        b2StorageCost: 0,
        b2DownloadCost: 0,
        b2ApiCost: 0,
        s3StorageCost: 0,
        s3RetrievalCost: 0,
        totalCost: 0,
        alertSent: false,
        alertThreshold: 5000,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      historical: sorted.filter((c) => c.month !== currentMonth),
    };
  },
});

/**
 * Migrates monthly storage cost data from billing system.
 * Updates existing record if month exists, otherwise creates new.
 */
export const migrateMonthlyStorageCost = mutation({
  args: {
    month: v.string(),
    b2StorageCost: v.optional(v.number()),
    b2DownloadCost: v.optional(v.number()),
    b2ApiCost: v.optional(v.number()),
    s3StorageCost: v.optional(v.number()),
    s3RetrievalCost: v.optional(v.number()),
    totalCost: v.optional(v.number()),
    alertSent: v.optional(v.boolean()),
    alertThreshold: v.optional(v.number()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existingByMonth = await ctx.db
      .query("monthlyStorageCosts")
      .withIndex("by_month", (q) => q.eq("month", args.month))
      .first();

    if (existingByMonth) {
      const updates: Record<string, unknown> = {};
      if (args.b2StorageCost !== undefined) updates.b2StorageCost = args.b2StorageCost;
      if (args.b2DownloadCost !== undefined) updates.b2DownloadCost = args.b2DownloadCost;
      if (args.b2ApiCost !== undefined) updates.b2ApiCost = args.b2ApiCost;
      if (args.s3StorageCost !== undefined) updates.s3StorageCost = args.s3StorageCost;
      if (args.s3RetrievalCost !== undefined) updates.s3RetrievalCost = args.s3RetrievalCost;
      if (args.totalCost !== undefined) updates.totalCost = args.totalCost;
      if (args.alertSent !== undefined) updates.alertSent = args.alertSent;
      if (args.alertThreshold !== undefined) updates.alertThreshold = args.alertThreshold;
      if (args.updatedAt) updates.updatedAt = args.updatedAt;

      if (Object.keys(updates).length > 0) {
        await ctx.db.patch(existingByMonth._id, updates);
      }
      return { action: "updated", id: existingByMonth._id };
    }

    const insertResult = await ctx.db.insert("monthlyStorageCosts", {
      month: args.month,
      b2StorageCost: args.b2StorageCost ?? 0,
      b2DownloadCost: args.b2DownloadCost ?? 0,
      b2ApiCost: args.b2ApiCost ?? 0,
      s3StorageCost: args.s3StorageCost ?? 0,
      s3RetrievalCost: args.s3RetrievalCost ?? 0,
      totalCost: args.totalCost ?? 0,
      alertSent: args.alertSent ?? false,
      alertThreshold: args.alertThreshold ?? 5000,
      createdAt: args.createdAt ?? Date.now(),
      updatedAt: args.updatedAt ?? Date.now(),
    });

    return { action: "inserted", id: insertResult };
  },
});