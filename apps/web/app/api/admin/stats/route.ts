import { NextRequest, NextResponse } from "next/server";
import { db, sessionPacks, seatReservations, eq, sql, and, gte, lt } from "@mentorships/db";
import { requireRoleForApi } from "@/lib/auth-helpers";
import { isUnauthorizedError, isForbiddenError } from "@mentorships/db";

function getStartOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function getStartOfLastMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() - 1, 1);
}

function getEndOfLastMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 0);
}

function getStartOfYear(date: Date): Date {
  return new Date(date.getFullYear(), 0, 1);
}

/**
 * GET /api/admin/stats
 * Get admin dashboard statistics
 */
export async function GET(_req: NextRequest) {
  try {
    await requireRoleForApi("admin");

    const now = new Date();
    const startOfMonth = getStartOfMonth(now);
    const startOfLastMonth = getStartOfLastMonth(now);
    const _endOfLastMonth = getEndOfLastMonth(now);
    const startOfYear = getStartOfYear(now);

    // Total Active Mentees - count of active session packs with active seat reservations
    const activeMenteesResult = await db
      .select({ count: sql<number>`count(distinct ${sessionPacks.id})` })
      .from(sessionPacks)
      .innerJoin(seatReservations, and(eq(seatReservations.sessionPackId, sessionPacks.id), eq(seatReservations.status, "active")))
      .where(eq(sessionPacks.status, "active"));

    const totalActiveMentees = Number(activeMenteesResult[0]?.count || 0);

    // Revenue This Month (completed payments)
    const revenueThisMonthResult = await db
      .select({ total: sql<number>`COALESCE(SUM(${payments.amount}), 0)` })
      .from(payments)
      .where(and(
        eq(payments.status, "completed"),
        gte(payments.createdAt, startOfMonth)
      ));

    const revenueThisMonth = Number(revenueThisMonthResult[0]?.total || 0);

    // Revenue Last Month (for comparison)
    const revenueLastMonthResult = await db
      .select({ total: sql<number>`COALESCE(SUM(${payments.amount}), 0)` })
      .from(payments)
      .where(and(
        eq(payments.status, "completed"),
        gte(payments.createdAt, startOfLastMonth),
        lt(payments.createdAt, startOfMonth)
      ));

    const revenueLastMonth = Number(revenueLastMonthResult[0]?.total || 0);

    // Revenue Change percentage
    let revenueChange = 0;
    if (revenueLastMonth > 0) {
      revenueChange = ((revenueThisMonth - revenueLastMonth) / revenueLastMonth) * 100;
    } else if (revenueThisMonth > 0) {
      revenueChange = 100; // New revenue this month with nothing last month
    }

    // Revenue This Year
    const revenueThisYearResult = await db
      .select({ total: sql<number>`COALESCE(SUM(${payments.amount}), 0)` })
      .from(payments)
      .where(and(
        eq(payments.status, "completed"),
        gte(payments.createdAt, startOfYear)
      ));

    const revenueThisYear = Number(revenueThisYearResult[0]?.total || 0);

    // Check if any revenue data exists (for historical comparison)
    const hasRevenueDataResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(payments)
      .where(eq(payments.status, "completed"));

    const hasRevenueData = Number(hasRevenueDataResult[0]?.count || 0) > 0;
    const hasHistoricalRevenue = revenueLastMonth > 0;

    // Check if any mentee data exists
    const hasMenteeData = totalActiveMentees > 0;

    return NextResponse.json({
      totalActiveMentees,
      revenueThisMonth: revenueThisMonth / 100,
      revenueLastMonth: revenueLastMonth / 100,
      revenueChange: Math.round(revenueChange * 10) / 10,
      revenueThisYear: revenueThisYear / 100,
      hasRevenueData,
      hasMenteeData,
      hasHistoricalRevenue,
    });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Forbidden: Admin role required" }, { status: 403 });
    }

    console.error("Error fetching admin stats:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch stats" },
      { status: 500 }
    );
  }
}