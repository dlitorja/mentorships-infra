import { NextResponse } from "next/server";
import { requireAuth, isUnauthorizedError } from "@/lib/auth";
import { api } from "@/convex/_generated/api";
import { getConvexClient } from "@/lib/convex";
import { Id } from "@/convex/_generated/dataModel";

/**
 * POST /api/session-packs
 * Create a new session pack (internal, typically called by webhook)
 *
 * Body:
 * - userId: string (Clerk user ID)
 * - instructorId: string (UUID) - preferred
 * - mentorId: string (UUID) - deprecated, use instructorId
 * - paymentId: string (UUID)
 * - expiresAt: string (ISO date string)
 * - totalSessions?: number (default: 4)
 *
 * Note: This endpoint requires authentication but can be called internally
 * by webhook handlers that have verified webhook signatures.
 */
export async function POST(request: Request) {
  try {
    // Require authentication (webhook handlers should use service auth)
    await requireAuth();

    const body = await request.json();
    const { userId, instructorId, mentorId, paymentId, expiresAt, totalSessions } = body;

    if (instructorId && mentorId && instructorId !== mentorId) {
      return NextResponse.json(
        { error: "instructorId and mentorId must match when both are provided" },
        { status: 400 }
      );
    }

    const resolvedInstructorId = instructorId ?? mentorId;

    // Validate required fields
    if (!userId || !resolvedInstructorId || !paymentId || !expiresAt) {
      return NextResponse.json(
        { error: "Missing required fields: userId, instructorId (or mentorId), paymentId, expiresAt" },
        { status: 400 }
      );
    }

    // Validate expiresAt is a valid date
    const expiresDate = new Date(expiresAt);
    if (isNaN(expiresDate.getTime())) {
      return NextResponse.json(
        { error: "Invalid expiresAt date format" },
        { status: 400 }
      );
    }

    // Validate totalSessions if provided
    if (totalSessions !== undefined && (totalSessions < 1 || !Number.isInteger(totalSessions))) {
      return NextResponse.json(
        { error: "totalSessions must be a positive integer" },
        { status: 400 }
      );
    }

    // Create session pack via Convex
    const convex = getConvexClient();
    const packId = await convex.mutation(api.sessionPacks.createSessionPack, {
      userId,
      instructorId: resolvedInstructorId as Id<"instructors">,
      paymentId: paymentId as Id<"payments">,
      totalSessions: totalSessions ?? 4,
      expiresAt: expiresDate.getTime(),
    });

    return NextResponse.json({
      success: true,
      pack: { id: packId },
    }, { status: 201 });
  } catch (error) {
    console.error("Error creating session pack:", error);

    if (isUnauthorizedError(error)) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    return NextResponse.json(
      { error: "Failed to create session pack" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/session-packs
 * Get all active session packs for the current user
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
    console.error("Error fetching session packs:", error);

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

