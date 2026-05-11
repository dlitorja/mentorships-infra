import { NextResponse } from "next/server";
import { requireRoleForApi } from "@/lib/auth-helpers";

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
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (error instanceof Error && error.message.includes("Forbidden")) {
      return NextResponse.json({ error: "Forbidden: Admin role required" }, { status: 403 });
    }
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}