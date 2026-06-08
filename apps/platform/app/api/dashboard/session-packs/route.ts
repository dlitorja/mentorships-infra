import { NextResponse } from "next/server";
import { getUser, requireDbUser } from "@/lib/auth";
import { api } from "@/convex/_generated/api";
import { getConvexClient } from "@/lib/convex";

export const dynamic = "force-dynamic";

/**
 * GET /api/dashboard/session-packs
 * Returns the current user's session packs with instructor details.
 * Requires authenticated user. Returns up to 100 packs with remaining sessions.
 */
export async function GET() {
  try {
    const user = await requireDbUser();
    const convex = getConvexClient();

    const result = await convex.query(api.sessionPacks.getUserSessionPacksWithInstructors, {
      userId: user.id,
      limit: 100,
      offset: 0,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error fetching session packs:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch session packs" },
      { status: 500 }
    );
  }
}