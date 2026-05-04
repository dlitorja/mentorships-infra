import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";

async function isAdminUser(ctx: QueryCtx, userId: string): Promise<boolean> {
  const user = await ctx.db
    .query("users")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .first();
  return user?.role === "admin";
}

type MentorWithEmail = {
  id: Id<"instructors">;
  userId: string | null;
  email: string | null;
  maxActiveStudents: number | null;
  oneOnOneInventory: number | null;
  groupInventory: number | null;
  createdAt: number | null;
};

export const getAllMentors = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const isAdmin = await isAdminUser(ctx, identity.subject);
    if (!isAdmin) return [];

    const instructors = await ctx.db.query("instructors").collect();

    const results: MentorWithEmail[] = await Promise.all(
      instructors.map(async (instructor) => {
        let email: string | null = null;
        if (instructor.userId) {
          const user = await ctx.db
            .query("users")
            .withIndex("by_userId", (q) => q.eq("userId", instructor.userId!))
            .first();
          email = user?.email ?? null;
        }
        return {
          id: instructor._id,
          userId: instructor.userId ?? null,
          email,
          maxActiveStudents: instructor.maxActiveStudents ?? null,
          oneOnOneInventory: instructor.oneOnOneInventory ?? null,
          groupInventory: instructor.groupInventory ?? null,
          createdAt: instructor._creationTime,
        };
      })
    );

    return results.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  },
});

function getStartOfMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
}

function getStartOfLastMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() - 1, 1).getTime();
}

function getStartOfYear(date: Date): number {
  return new Date(date.getFullYear(), 0, 1).getTime();
}

export const getStats = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const isAdmin = await isAdminUser(ctx, identity.subject);
    if (!isAdmin) throw new Error("Forbidden");

    const now = new Date();
    const startOfMonth = getStartOfMonth(now);
    const startOfLastMonth = getStartOfLastMonth(now);
    const startOfYear = getStartOfYear(now);

    const activeSeatReservations = await ctx.db
      .query("seatReservations")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();

    const sessionPackIds = new Set<string>();
    for (const seat of activeSeatReservations) {
      if (seat.sessionPackId) {
        sessionPackIds.add(seat.sessionPackId);
      }
    }

    let totalActiveMentees = 0;
    for (const packId of sessionPackIds) {
      const pack = await ctx.db.get(packId as Id<"sessionPacks">);
      if (pack && pack.status === "active") {
        totalActiveMentees++;
      }
    }

    const allPayments = await ctx.db
      .query("payments")
      .withIndex("by_status", (q) => q.eq("status", "completed"))
      .filter((q) => q.gte(q.field("_creationTime"), startOfYear))
      .collect();

    let revenueThisMonth = 0;
    let revenueLastMonth = 0;
    let revenueThisYear = 0;
    let hasRevenueData = false;

    for (const payment of allPayments) {
      const amount = parseFloat(payment.amount) || 0;
      const createdAt = payment._creationTime;

      if (amount > 0) {
        hasRevenueData = true;
      }

      if (createdAt >= startOfYear) {
        revenueThisYear += amount;
      }

      if (createdAt >= startOfMonth) {
        revenueThisMonth += amount;
      } else if (createdAt >= startOfLastMonth && createdAt < startOfMonth) {
        revenueLastMonth += amount;
      }
    }

    let revenueChange = 0;
    if (revenueLastMonth > 0) {
      revenueChange = ((revenueThisMonth - revenueLastMonth) / revenueLastMonth) * 100;
    } else if (revenueThisMonth > 0) {
      revenueChange = 100;
    }

    return {
      totalActiveMentees,
      revenueThisMonth: revenueThisMonth / 100,
      revenueLastMonth: revenueLastMonth / 100,
      revenueChange: Math.round(revenueChange * 10) / 10,
      revenueThisYear: revenueThisYear / 100,
      hasRevenueData,
      hasMenteeData: totalActiveMentees > 0,
      hasHistoricalRevenue: revenueLastMonth > 0,
    };
  },
});