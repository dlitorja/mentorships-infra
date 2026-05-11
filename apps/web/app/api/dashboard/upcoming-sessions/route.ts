import { NextResponse } from "next/server";
import { requireDbUser } from "@/lib/auth";
import { api } from "@/convex/_generated/api";
import { getConvexClient } from "@/lib/convex";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireDbUser();
    const convex = getConvexClient();

    const sessions = await convex.query(api.sessions.getUpcomingSessionsWithInstructor, {
      studentId: user.id,
      limit: 5,
    });

    return NextResponse.json(sessions);
  } catch (error) {
    console.error("Error fetching upcoming sessions:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch upcoming sessions" },
      { status: 500 }
    );
  }
}