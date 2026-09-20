import { query, mutation } from "./_generated/server";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import type { Id } from "./_generated/dataModel";

async function isAdminUser(ctx: QueryCtx, userId: string): Promise<boolean> {
  const userByUserId = await ctx.db
    .query("users")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .first();
  if (userByUserId?.role === "admin") return true;
  const userByClerkId = await ctx.db
    .query("users")
    .withIndex("by_clerkId", (q) => q.eq("clerkId", userId))
    .first();
  return userByClerkId?.role === "admin";
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
  activeStudentCount: number;
  totalCompletedSessions: number;
};

/**
 * Fetches all instructors with their email addresses for admin listing.
 * Requires admin authentication.
 * Returns instructors sorted by creation time.
 */
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

/**
 * Fetches instructors for admin listing with search and pagination.
 * Includes active student count and total completed sessions per instructor.
 * Requires admin authentication.
 */
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

    // Exclude soft-deleted (deletedAt != null) and explicitly inactive
    // (isActive === false) instructors. Convex indexes do not support
    // "not-equal" filtering, so we collect then filter. The admin
    // listing is small enough that the post-filter is fine; if it ever
    // grows, add a `by_deletedAt` partial index or a denormalized
    // `isListed` boolean.
    instructors = instructors.filter((i) => !i.deletedAt && i.isActive !== false);

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

    const results: InstructorForAdmin[] = await Promise.all(
      sortedInstructors.map(async (instructor) => {
        const activeStudentCount = seatReservations.filter(
          sr => sr.instructorId === instructor._id && sr.status === "active"
        ).length;

        const totalCompletedSessions = sessions.filter(
          s => s.instructorId === instructor._id && s.status === "completed"
        ).length;

        const profileImageUrl = instructor.profileImageStorageId
          ? (await ctx.storage.getUrl(instructor.profileImageStorageId as Id<"_storage">)) ?? instructor.profileImageUrl
          : instructor.profileImageUrl;

        return {
          id: instructor._id,
          name: instructor.name ?? null,
          slug: instructor.slug ?? null,
          email: instructor.email ?? null,
          userId: instructor.userId ?? null,
          bio: instructor.bio ?? null,
          profileImageUrl: profileImageUrl ?? null,
          isActive: instructor.isActive ?? true,
          createdAt: instructor._creationTime,
          activeStudentCount,
          totalCompletedSessions,
        };
      })
    );

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

/**
 * Fetches admin dashboard statistics including active students, revenue metrics.
 * Returns current month, last month, and year-to-date revenue with change percentage.
 * Requires admin authentication.
 */
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

    let totalActiveStudents = 0;
    for (const packId of sessionPackIds) {
      const pack = await ctx.db.get(packId as Id<"sessionPacks">);
      if (pack && pack.status === "active") {
        totalActiveStudents++;
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
      totalActiveStudents,
      revenueThisMonth: revenueThisMonth / 100,
      revenueLastMonth: revenueLastMonth / 100,
      revenueChange: Math.round(revenueChange * 10) / 10,
      revenueThisYear: revenueThisYear / 100,
      hasRevenueData,
      hasStudentData: totalActiveStudents > 0,
      hasHistoricalRevenue: revenueLastMonth > 0,
    };
  },
});

type StudentWithSessionInfo = {
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

/**
 * Fetches students (session pack holders) for admin listing with search and filters.
 * Returns paginated results with instructor details and session pack info.
 * Requires admin authentication.
 */
export const getStudentsForAdmin = query({
  args: {
    search: v.optional(v.string()),
    instructorId: v.optional(v.string()),
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

    const packsQuery = args.instructorId
      ? ctx.db
          .query("sessionPacks")
          .withIndex("by_instructorId", (q) => q.eq("instructorId", (args.instructorId as any)))
      : ctx.db.query("sessionPacks");
    let sessionPacks = await packsQuery.collect();

    if (args.instructorId) {
      sessionPacks = sessionPacks.filter(sp => sp.instructorId === (args.instructorId as any));
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

    const studentsMap = new Map<string, {
      userId: string;
      email: string | null;
      sessionPacks: Array<{
        id: string;
        instructorId: string;
        instructorName: string | null;
        instructorSlug: string | null;
        totalSessions: number;
        remainingSessions: number;
        purchasedAt: number;
        expiresAt: number | null;
        status: string;
      }>;
    }>();

    for (const pack of sessionPacks) {
      if (!studentsMap.has(pack.userId)) {
        const user = await ctx.db
          .query("users")
          .withIndex("by_userId", (q) => q.eq("userId", pack.userId))
          .first();
        studentsMap.set(pack.userId, {
          userId: pack.userId,
          email: user?.email ?? null,
          sessionPacks: [],
        });
      }
      let instructor: { name?: string | undefined; slug?: string | undefined } | null = null;
      try {
        instructor = await ctx.db.get(pack.instructorId);
      } catch {
        instructor = null;
      }
      studentsMap.get(pack.userId)!.sessionPacks.push({
        id: pack._id,
        instructorId: pack.instructorId,
        instructorName: instructor?.name ?? null,
        instructorSlug: instructor?.slug ?? null,
        totalSessions: pack.totalSessions,
        remainingSessions: pack.remainingSessions,
        purchasedAt: pack.purchasedAt,
        expiresAt: pack.expiresAt ?? null,
        status: pack.status,
      });
    }

    const total = studentsMap.size;
    const page = args.page ?? 1;
    const pageSize = args.pageSize ?? 20;
    const offset = (page - 1) * pageSize;

    const items = Array.from(studentsMap.values())
      .sort((a, b) => (b.sessionPacks[0]?.purchasedAt ?? 0) - (a.sessionPacks[0]?.purchasedAt ?? 0))
      .slice(offset, offset + pageSize);

    return { items, total, page, pageSize };
  },
});

/**
 * PR admin-mirror #4 (port /admin/instructors to Convex):
 *
 * Admin-gated queries + mutations that mirror the Drizzle
 * `packages/db/src/lib/queries/admin.ts` shapes consumed by
 * `apps/marketing/app/admin/instructors/page.tsx` and the
 * `InstructorsTable` client component. These replace the previous
 * Supabase `getAllInstructorsWithStats` (the source of the
 * `operator does not exist: text = uuid` 500) and the related
 * `/api/admin/instructors/*` and `/api/admin/session-counts` routes.
 *
 * Read patterns:
 * - Instructors: `by_deletedAt` partial index + `.take(N)` for
 *   bounded listing reads. We deliberately do NOT include
 *   `totalCompletedSessions` here — computing that requires a
 *   sessions scan that doesn't fit a 50-row listing page. The
 *   per-instructor detail view (`getInstructorWithStudents`) covers
 *   it for the expanded row.
 * - Seats: `by_instructorId_status` per-instructor (listing) or
 *   `by_instructorId` (detail) — bounded to the page's instructor
 *   IDs.
 * - Session packs: `by_instructorId` for the detail view; the full
 *   CSV export (`getFullAdminCsvData`) is the only place that
 *   collects globally, and only on explicit click (not on mount).
 *
 * Mutation writes happen transactionally inside a single Convex
 * function so increment/decrement cannot interleave with the status
 * flip from "depleted" → "active" or vice versa.
 */

type InstructorStudentRow = {
  userId: string;
  email: string | null;
  sessionPackId: Id<"sessionPacks">;
  totalSessions: number;
  remainingSessions: number;
  status: "active" | "depleted" | "expired" | "refunded";
  expiresAt: number | null;
  lastSessionCompletedAt: number | null;
  completedSessionCount: number;
  seatStatus: "active" | "grace" | "released";
  seatExpiresAt: number | null;
};

type InstructorWithStats = {
  instructorId: string;
  userId: string;
  email: string;
  bio: string | null;
  oneOnOneInventory: number;
  groupInventory: number;
  maxActiveStudents: number;
  activeStudentCount: number;
  createdAt: number;
};

type InstructorWithStudents = InstructorWithStats & {
  students: InstructorStudentRow[];
};

type FullAdminReportRow = {
  instructorEmail: string | null;
  studentEmail: string | null;
  totalSessions: number;
  remainingSessions: number;
  packStatus: "active" | "depleted" | "expired" | "refunded";
  packExpiresAt: number | null;
  lastSessionDate: number | null;
  completedSessionsCount: number;
  seatStatus: "active" | "grace" | "released";
};

async function requireAdmin(ctx: QueryCtx | MutationCtx): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Unauthorized");
  if (!(await isAdminUser(ctx, identity.subject))) throw new Error("Forbidden");
  return identity.subject;
}

export const getInstructorsWithStatsForAdmin = query({
  args: {
    search: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    page: InstructorWithStats[];
    isDone: boolean;
    continueCursor: string;
  }> => {
    await requireAdmin(ctx);

    // Greptile: cursor-based pagination via `paginate()` so
    // subsequent pages don't repeat the first window. The
    // `by_deletedAt` partial index covers the active-instructor
    // filter; `paginate()` handles cursor + ordering.
    //
    // We allow the client to specify up to `numItems` directly (no
    // server-side clamp) so a search request can fetch a 500-row
    // window in one round-trip and apply the email filter locally,
    // instead of paginating the raw unfiltered list. The Convex
    // `paginate` per-call row read is bounded by `numItems`.
    const numItems = args.paginationOpts.numItems ?? 50;

    const result = await ctx.db
      .query("instructors")
      .withIndex("by_deletedAt", (q) => q.eq("deletedAt", undefined))
      .paginate({ ...args.paginationOpts, numItems });

    const rows = result.page;

    const userIds = Array.from(
      new Set(rows.map((i) => i.userId).filter((u): u is string => !!u))
    );
    const users = userIds.length
      ? await Promise.all(
          userIds.map(async (uid) =>
            ctx.db.query("users").withIndex("by_userId", (q) => q.eq("userId", uid)).first()
          )
        )
      : [];
    const emailByUserId = new Map<string, string>();
    for (const u of users) {
      if (u?.email && u.userId) emailByUserId.set(u.userId, u.email);
    }

    // Per-instructor active-student counts via the
    // `by_instructorId_status` index (bounded to this page's IDs).
    const seatsByInstructor = new Map<string, number>();
    await Promise.all(
      rows.map(async (i) => {
        const seats = await ctx.db
          .query("seatReservations")
          .withIndex("by_instructorId_status", (q) =>
            q.eq("instructorId", i._id).eq("status", "active")
          )
          .collect();
        seatsByInstructor.set(i._id, new Set(seats.map((s) => s.sessionPackId)).size);
      })
    );

    const enriched: InstructorWithStats[] = rows
      .map((i) => {
        const userId = i.userId ?? "";
        return {
          instructorId: i._id,
          userId,
          email: (userId && emailByUserId.get(userId)) ?? i.email ?? "",
          bio: i.bio ?? null,
          oneOnOneInventory: (i as any).oneOnOneInventory ?? 0,
          groupInventory: (i as any).groupInventory ?? 0,
          maxActiveStudents: (i as any).maxActiveStudents ?? 0,
          activeStudentCount: seatsByInstructor.get(i._id) ?? 0,
          createdAt: i._creationTime,
        };
      })
      .filter((row) => !!row.userId && !!row.email);

    const search = args.search?.trim().toLowerCase();
    const filtered = search
      ? enriched.filter((r) => r.email.toLowerCase().includes(search))
      : enriched;

    return {
      page: filtered,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

export const getInstructorWithStudents = query({
  args: { instructorId: v.id("instructors") },
  handler: async (ctx, args): Promise<InstructorWithStudents | null> => {
    await requireAdmin(ctx);

    const instructor = await ctx.db.get(args.instructorId);
    if (!instructor || instructor.deletedAt != null) return null;

    const userId = instructor.userId ?? "";
    const user = userId
      ? await ctx.db.query("users").withIndex("by_userId", (q) => q.eq("userId", userId)).first()
      : null;

    // Both reads are scoped by `by_instructorId`, not global scans.
    const seats = await ctx.db
      .query("seatReservations")
      .withIndex("by_instructorId", (q) => q.eq("instructorId", args.instructorId))
      .collect();

    const sessionPacks = await ctx.db
      .query("sessionPacks")
      .withIndex("by_instructorId", (q) => q.eq("instructorId", args.instructorId))
      .collect();

    // A session pack without a seat reservation is NOT an active
    // student — it could be a deleted reservation, an unscheduled
    // purchase, or a test row. Greptile P1: hide orphaned packs.
    const seatsByPackId = new Map(seats.map((sr) => [sr.sessionPackId, sr]));
    const enrolledPacks = sessionPacks.filter((p) => seatsByPackId.has(p._id));

    // Aggregate completed sessions per pack via the
    // `by_sessionPackId` index (sessions has no by_instructorId
    // index, so we scope the scan per pack).
    const completedByPack = new Map<Id<"sessionPacks">, { count: number; lastAt: number | null }>();
    await Promise.all(
      enrolledPacks.map(async (p) => {
        const completed = await ctx.db
          .query("sessions")
          .withIndex("by_sessionPackId", (q) => q.eq("sessionPackId", p._id))
          .filter((q) => q.eq(q.field("status"), "completed"))
          .collect();
        const lastAt = completed.reduce<number | null>(
          (acc, s) => (acc == null ? (s.completedAt ?? null) : Math.max(acc, s.completedAt ?? 0)),
          null
        );
        completedByPack.set(p._id, { count: completed.length, lastAt });
      })
    );

    const studentUserIds = Array.from(new Set(enrolledPacks.map((p) => p.userId)));
    const studentUsers = await Promise.all(
      studentUserIds.map((uid) =>
        ctx.db.query("users").withIndex("by_userId", (q) => q.eq("userId", uid)).first()
      )
    );
    const emailByUserId = new Map<string, string>();
    for (const u of studentUsers) {
      if (u?.email && u.userId) emailByUserId.set(u.userId, u.email);
    }

    const students: InstructorStudentRow[] = enrolledPacks.map((p) => {
      const completed = completedByPack.get(p._id);
      const seat = seatsByPackId.get(p._id)!;
      return {
        userId: p.userId,
        email: emailByUserId.get(p.userId) ?? null,
        sessionPackId: p._id,
        totalSessions: p.totalSessions,
        remainingSessions: p.remainingSessions,
        status: p.status,
        expiresAt: p.expiresAt ?? null,
        lastSessionCompletedAt: completed?.lastAt ?? null,
        completedSessionCount: completed?.count ?? 0,
        seatStatus: seat.status,
        seatExpiresAt: seat.seatExpiresAt ?? null,
      };
    });

    return {
      instructorId: instructor._id,
      userId,
      email: user?.email ?? instructor.email ?? "",
      bio: instructor.bio ?? null,
      oneOnOneInventory: (instructor as any).oneOnOneInventory ?? 0,
      groupInventory: (instructor as any).groupInventory ?? 0,
      maxActiveStudents: (instructor as any).maxActiveStudents ?? 0,
      activeStudentCount: seats.filter((sr) => sr.status === "active").length,
      createdAt: instructor._creationTime,
      students: students.sort((a, b) => b.sessionPackId.localeCompare(a.sessionPackId)),
    };
  },
});

export const getFullAdminCsvData = query({
  args: {
    // Cache-busting nonce — the client passes a fresh value on each
    // export click so TanStack Query doesn't reuse the previous
    // result (the Convex adapter sets `staleTime: Infinity`).
    nonce: v.optional(v.number()),
  },
  handler: async (ctx, _args): Promise<FullAdminReportRow[]> => {
    await requireAdmin(ctx);

    const sessionPacks = await ctx.db.query("sessionPacks").collect();
    // Greptile P1: only export packs that have an enrollment seat.
    // Orphaned packs (no reservation) shouldn't appear as students.
    const seatPackIds = new Set(
      (await ctx.db.query("seatReservations").collect()).map((sr) => sr.sessionPackId)
    );
    const seatsByPackId = new Map(
      (await ctx.db.query("seatReservations").collect()).map((sr) => [sr.sessionPackId, sr])
    );
    const allCompleted = await ctx.db
      .query("sessions")
      .withIndex("by_status", (q) => q.eq("status", "completed"))
      .collect();

    const instructors = await ctx.db
      .query("instructors")
      .withIndex("by_deletedAt", (q) => q.eq("deletedAt", undefined))
      .collect();
    const instructorById = new Map(instructors.map((i) => [i._id, i]));

    // Index users + emails.
    const allUsers = await ctx.db.query("users").collect();
    const emailByUserId = new Map<string, string>();
    for (const u of allUsers) {
      if (u.email && u.userId) emailByUserId.set(u.userId, u.email);
    }

    const completedByPack = new Map<Id<"sessionPacks">, { count: number; lastAt: number | null }>();
    for (const s of allCompleted) {
      if (!s.sessionPackId) continue;
      const cur = completedByPack.get(s.sessionPackId) ?? { count: 0, lastAt: null };
      cur.count += 1;
      cur.lastAt = cur.lastAt == null ? (s.completedAt ?? null) : Math.max(cur.lastAt, s.completedAt ?? 0);
      completedByPack.set(s.sessionPackId, cur);
    }

    const rows: FullAdminReportRow[] = sessionPacks
      .filter((p) => seatPackIds.has(p._id))
      .map((p) => {
        const seat = seatsByPackId.get(p._id)!;
        const instructor = instructorById.get(p.instructorId);
        const instructorUserId = instructor?.userId ?? "";
        const completed = completedByPack.get(p._id);
        return {
          instructorEmail: (instructorUserId && emailByUserId.get(instructorUserId)) ?? instructor?.email ?? null,
          studentEmail: emailByUserId.get(p.userId) ?? null,
          totalSessions: p.totalSessions,
          remainingSessions: p.remainingSessions,
          packStatus: p.status,
          packExpiresAt: p.expiresAt ?? null,
          lastSessionDate: completed?.lastAt ?? null,
          completedSessionsCount: completed?.count ?? 0,
          seatStatus: seat.status,
        };
      });

    return rows.sort((a, b) => (b.lastSessionDate ?? 0) - (a.lastSessionDate ?? 0));
  },
});

export const incrementRemainingSessions = mutation({
  args: { sessionPackId: v.id("sessionPacks") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const pack = await ctx.db.get(args.sessionPackId);
    if (!pack) throw new Error("Session pack not found");

    const newRemaining = pack.remainingSessions + 1;
    // Atomic flip from "depleted" → "active" when recharging a depleted
    // pack back to a positive balance. Mirrors the Drizzle
    // `incrementRemainingSessions` behavior.
    const newStatus = pack.status === "depleted" && newRemaining > 0 ? "active" : pack.status;
    await ctx.db.patch(pack._id, {
      remainingSessions: newRemaining,
      status: newStatus,
    });
    return { remainingSessions: newRemaining, status: newStatus };
  },
});

export const decrementRemainingSessions = mutation({
  args: { sessionPackId: v.id("sessionPacks") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const pack = await ctx.db.get(args.sessionPackId);
    if (!pack) throw new Error("Session pack not found");

    const newRemaining = Math.max(pack.remainingSessions - 1, 0);
    // Greptile P1: only flip to `depleted` when the pack was active.
    // Packs already in a terminal state (`refunded`, `expired`)
    // must NOT be moved to `depleted` — that erases the terminal
    // status an admin sees in the expanded view.
    const newStatus =
      newRemaining <= 0 && (pack.status === "active" || pack.status === "depleted")
        ? "depleted"
        : pack.status;
    await ctx.db.patch(pack._id, {
      remainingSessions: newRemaining,
      status: newStatus,
    });
    return { remainingSessions: newRemaining, status: newStatus };
  },
});
