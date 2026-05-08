import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { requireRoleForApi } from "@/lib/auth-helpers";
import { getAdminStats } from "@mentorships/db";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    await requireRoleForApi("admin");

    const stats = await getAdminStats();

    return NextResponse.json(stats);
  } catch (error) {
    console.error("Error fetching admin stats:", error);

    if (error instanceof Error && error.message.includes("Unauthorized")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch stats" },
      { status: 500 }
    );
  }
}