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

type InstructorWithEmail = {
  id: Id<"instructors">;
  userId: string | null;
  email: string | null;
  maxActiveStudents: number | null;
  oneOnOneInventory: number | null;
  groupInventory: number | null;
  createdAt: number | null;
};

type InstructorForAdmin = {
  id: Id<"instructors">;
  name: string | null;
  slug: string | null;
  email: string | null;
  userId: string | null;
  bio: string | null;
  profileImageUrl: string | null;
  isActive: boolean;
  createdAt: number;
  activeMenteeCount: number;
  totalCompletedSessions: number;
};

export const getAllInstructors = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const isAdmin = await isAdminUser(ctx, identity.subject);
    if (!isAdmin) return [];

    const instructors = await ctx.db.query("instructors").collect();

    const results: InstructorWithEmail[] = await Promise.all(
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

export const getInstructorsForAdmin = query({
  args: {
    search: v.optional(v.string()),
    page: v.optional(v.number()),
    pageSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { items: [], total: 0, page: 1, pageSize: 50 };
    const isAdmin = await isAdminUser(ctx, identity.subject);
    if (!isAdmin) return { items: [], total: 0, page: 1, pageSize: 50 };

    let instructors = await ctx.db.query("instructors").collect();

    if (args.search) {
      const searchLower = args.search.toLowerCase();
      instructors = instructors.filter(i => {
        const nameMatch = i.name?.toLowerCase().includes(searchLower);
        const emailMatch = i.email?.toLowerCase().includes(searchLower);
        const slugMatch = i.slug?.toLowerCase().includes(searchLower);
        return nameMatch || emailMatch || slugMatch;
      });
    }

    const total = instructors.length;

    const page = args.page ?? 1;
    const pageSize = args.pageSize ?? 50;
    const offset = (page - 1) * pageSize;

    const sortedInstructors = instructors
      .sort((a, b) => b._creationTime - a._creationTime)
      .slice(offset, offset + pageSize);

    const seatReservations = await ctx.db.query("seatReservations").collect();
    const sessions = await ctx.db.query("sessions").collect();

    const results: InstructorForAdmin[] = sortedInstructors.map(instructor => {
      const activeMenteeCount = seatReservations.filter(
        sr => sr.instructorId === instructor._id && sr.status === "active"
      ).length;

      const totalCompletedSessions = sessions.filter(
        s => s.instructorId === instructor._id && s.status === "completed"
      ).length;

      return {
        id: instructor._id,
        name: instructor.name ?? null,
        slug: instructor.slug ?? null,
        email: instructor.email ?? null,
        userId: instructor.userId ?? null,
        bio: instructor.bio ?? null,
        profileImageUrl: instructor.profileImageUrl ?? null,
        isActive: instructor.isActive ?? true,
        createdAt: instructor._creationTime,
        activeMenteeCount,
        totalCompletedSessions,
      };
    });

    return { items: results, total, page, pageSize };
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

type MenteeWithSessionInfo = {
  id: string;
  userId: string;
  email: string | null;
  instructorId: Id<"instructors">;
  instructorName: string | null;
  instructorSlug: string | null;
  totalSessions: number;
  remainingSessions: number;
  purchasedAt: number;
  expiresAt: number | null;
  status: "active" | "depleted" | "expired" | "refunded";
  createdAt: number;
};

// Removed legacy mentee-named endpoint to enforce naming consistency

// New naming-compliant alias for admin UI: students instead of mentees
export const getStudentsForAdmin = query({
  args: {
    search: v.optional(v.string()),
    instructorId: v.optional(v.id("instructors")),
    status: v.optional(v.union(v.literal("active"), v.literal("depleted"), v.literal("expired"), v.literal("refunded"))),
    expiresAfter: v.optional(v.number()),
    expiresBefore: v.optional(v.number()),
    purchasedAfter: v.optional(v.number()),
    purchasedBefore: v.optional(v.number()),
    remainingMin: v.optional(v.number()),
    remainingMax: v.optional(v.number()),
    page: v.optional(v.number()),
    pageSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { items: [], total: 0, page: 1, pageSize: 20 };
    const isAdmin = await isAdminUser(ctx, identity.subject);
    if (!isAdmin) return { items: [], total: 0, page: 1, pageSize: 20 };

    let sessionPacks = await ctx.db.query("sessionPacks").collect();

    if (args.instructorId) {
      sessionPacks = sessionPacks.filter(sp => sp.instructorId === args.instructorId);
    }

    if (args.search) {
      const searchLower = args.search.toLowerCase();
      const userIds = new Set<string>();
      const users = await ctx.db.query("users").collect();
      for (const user of users) {
        if (user.email?.toLowerCase().includes(searchLower)) {
          userIds.add(user.userId);
        }
      }
      sessionPacks = sessionPacks.filter(sp => userIds.has(sp.userId));
    }

    if (args.status) {
      sessionPacks = sessionPacks.filter(sp => sp.status === args.status);
    }

    if (args.expiresAfter) {
      sessionPacks = sessionPacks.filter(sp => (sp.expiresAt ?? 0) >= args.expiresAfter!);
    }
    if (args.expiresBefore) {
      sessionPacks = sessionPacks.filter(sp => (sp.expiresAt ?? Number.MAX_SAFE_INTEGER) <= args.expiresBefore!);
    }

    if (args.purchasedAfter) {
      sessionPacks = sessionPacks.filter(sp => sp.purchasedAt >= args.purchasedAfter!);
    }
    if (args.purchasedBefore) {
      sessionPacks = sessionPacks.filter(sp => sp.purchasedAt <= args.purchasedBefore!);
    }

    if (args.remainingMin !== undefined) {
      sessionPacks = sessionPacks.filter(sp => sp.remainingSessions >= (args.remainingMin as number));
    }
    if (args.remainingMax !== undefined) {
      sessionPacks = sessionPacks.filter(sp => sp.remainingSessions <= (args.remainingMax as number));
    }

    const total = sessionPacks.length;
    const page = args.page ?? 1;
    const pageSize = args.pageSize ?? 20;
    const offset = (page - 1) * pageSize;

    const sortedPacks = sessionPacks
      .sort((a, b) => b._creationTime - a._creationTime)
      .slice(offset, offset + pageSize);

    const items = await Promise.all(
      sortedPacks.map(async (pack) => {
        const user = await ctx.db
          .query("users")
          .withIndex("by_userId", (q) => q.eq("userId", pack.userId))
          .first();
        const instructor = await ctx.db.get(pack.instructorId);

        return {
          id: pack._id,
          userId: pack.userId,
          email: user?.email ?? null,
          instructorId: pack.instructorId,
          instructorName: instructor?.name ?? null,
          instructorSlug: instructor?.slug ?? null,
          totalSessions: pack.totalSessions,
          remainingSessions: pack.remainingSessions,
          purchasedAt: pack.purchasedAt,
          expiresAt: pack.expiresAt ?? null,
          status: pack.status,
          createdAt: pack._creationTime,
        };
      })
    );

    return { items, total, page, pageSize };
  },
});
