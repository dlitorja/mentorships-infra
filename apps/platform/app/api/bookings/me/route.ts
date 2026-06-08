import { NextRequest, NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { getConvexClient } from "@/lib/convex";
import { requireAuth } from "@/lib/auth-helpers";

/**
 * GET /api/bookings/me
 * Returns the current user's bookings (up to 20 most recent).
 * Requires authenticated user. Returns list of student bookings from Convex.
 */
export async function GET(_req: NextRequest): Promise<NextResponse> {
  try {
    await requireAuth();
    const convex = getConvexClient();
    const items = await convex.query(api.bookings.listStudentBookings, { limit: 20 });
    return NextResponse.json({ success: true, bookings: items });
  } catch (error) {
    console.error("listStudentBookings error:", error);
    return NextResponse.json({ error: "Failed to load bookings" }, { status: 500 });
  }
}
