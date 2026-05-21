import { NextResponse } from "next/server";
import { requireRoleForApi } from "@/lib/auth-helpers";
import { isUnauthorizedError, isForbiddenError } from "@/lib/errors";

export async function GET(): Promise<NextResponse> {
  try {
    await requireRoleForApi("admin");

    return NextResponse.json({
      totalActiveMentees: 0,
      revenueThisMonth: 0,
      revenueLastMonth: 0,
      revenueChange: 0,
      revenueThisYear: 0,
      hasRevenueData: false,
      hasMenteeData: false,
      hasHistoricalRevenue: false,
    });
  } catch (error) {
    console.error("Error fetching admin stats:", error);
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Forbidden: Admin role required" }, { status: 403 });
    }
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
