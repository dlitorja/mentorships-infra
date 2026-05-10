import { NextResponse } from "next/server";
import { requireDbUser } from "@/lib/auth";
import { api } from "@/convex/_generated/api";
import { getConvexClient } from "@/lib/convex";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireDbUser();
    const convex = getConvexClient();

    const total = await convex.query(api.sessionPacks.getUserTotalRemainingSessions, {
      userId: user.id,
    });

    return NextResponse.json({ total });
  } catch (error) {
    console.error("Error fetching stats:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch stats" },
      { status: 500 }
    );
  }
}