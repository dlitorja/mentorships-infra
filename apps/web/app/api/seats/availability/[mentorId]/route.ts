import { NextResponse } from "next/server";
import { checkSeatAvailability } from "@mentorships/db";

/**
 * GET /api/seats/availability/:mentorId
 * Check seat availability for a mentor
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
  request: Request,
  { params }: { params: Promise<{ mentorId: string }> }
) {
  try {
    const { mentorId } = await params;

    if (!mentorId) {
      return NextResponse.json(
        { error: "Mentor ID is required" },
        { status: 400 }
      );
    }

    const availability = await checkSeatAvailability(mentorId);

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

