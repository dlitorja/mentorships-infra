import { NextResponse } from "next/server";
import { requireAuth, isUnauthorizedError } from "@/lib/auth";
import { api } from "@/convex/_generated/api";
import { ConvexHttpClient } from "convex/browser";

function getConvexClient() {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
  }
  return new ConvexHttpClient(convexUrl);
}

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
    const userId = await requireAuth();
    const convex = getConvexClient();

    const packs = await convex.query(api.sessionPacks.getUserActiveSessionPacks, {
      userId,
    });

    return NextResponse.json({
      success: true,
      packs,
    });
  } catch (error) {
    console.error("Error fetching user session packs:", error);

    if (isUnauthorizedError(error)) {
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

