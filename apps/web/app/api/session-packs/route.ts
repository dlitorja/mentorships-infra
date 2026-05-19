import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, isUnauthorizedError } from "@/lib/auth";
import { api } from "@/convex/_generated/api";
import { getConvexClient } from "@/lib/convex";
import { Id } from "@/convex/_generated/dataModel";

const createSessionPackSchema = z.object({
  userId: z.string().min(1),
  instructorId: z.string().min(1),
  paymentId: z.string().min(1),
  expiresAt: z.string().min(1),
  totalSessions: z.number().int().positive().optional(),
});

type CreateSessionPackInput = z.infer<typeof createSessionPackSchema>;

/**
 * POST /api/session-packs
 * Create a new session pack (internal, typically called by webhook)
 *
 * Body:
 * - userId: string (Clerk user ID)
 * - instructorId: string (UUID)
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

    const parsed = createSessionPackSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { userId, instructorId, paymentId, expiresAt, totalSessions } = parsed.data;

    // Validate expiresAt is a valid date
    const expiresDate = new Date(expiresAt);
    if (isNaN(expiresDate.getTime())) {
      return NextResponse.json(
        { error: "Invalid expiresAt date format" },
        { status: 400 }
      );
    }

    // Create session pack via Convex
    const convex = getConvexClient();
    const packId = await convex.mutation(api.sessionPacks.createSessionPack, {
      userId,
      instructorId: instructorId as Id<"instructors">,
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