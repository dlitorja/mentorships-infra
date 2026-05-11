import { NextResponse, NextRequest } from "next/server";
import { api } from "@/convex/_generated/api";
import { getConvexClient } from "@/lib/convex";
import { Id } from "@/convex/_generated/dataModel";

/**
 * GET /api/seats/availability/:instructorId
 * Check seat availability for an instructor
 *
 * Public endpoint - no authentication required
 *
 * Response:
 * {
 *   success: true,
 *   available: boolean,
 *   activeSeats: number,
 *   maxSeats: number,
 *   remainingSeats: number
 * }
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ instructorId: string }> }
): Promise<NextResponse> {
  try {
    const { instructorId } = await params;

    if (!instructorId) {
      return NextResponse.json(
        { error: "Instructor ID is required" },
        { status: 400 }
      );
    }

    const convex = getConvexClient();
    const availability = await convex.query(api.instructors.checkSeatAvailability, {
      instructorId: instructorId as Id<"instructors">,
    });

    return NextResponse.json({
      success: true,
      ...availability,
    });
  } catch (error) {
    console.error("Error checking seat availability:", error);

    if (error instanceof Error && error.message.includes("not found")) {
      return NextResponse.json(
        { error: error.message },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { error: "Failed to check seat availability" },
      { status: 500 }
    );
  }
}