import { NextResponse } from "next/server";
import { requireDbUser } from "@/lib/auth";
import { getUserActiveSessionPacks } from "@mentorships/db";

/**
 * GET /api/session-packs/me
 * Get all active session packs for the current authenticated user
 * 
 * Response:
 * {
 *   success: true,
 *   packs: SessionPack[]
 * }
 */
export async function GET() {
  try {
    const user = await requireDbUser();

    const packs = await getUserActiveSessionPacks(user.id);

    return NextResponse.json({
      success: true,
      packs,
    });
  } catch (error) {
    console.error("Error fetching user session packs:", error);

    if (error instanceof Error && error.message.includes("Unauthorized")) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    return NextResponse.json(
      { error: "Failed to fetch session packs" },
      { status: 500 }
    );
  }
}

