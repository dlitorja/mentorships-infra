import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { randomUUID } from "crypto";

const waitlistPostSchema = z.object({
  instructorSlug: z.string().min(1, "Instructor slug is required"),
  type: z.enum(["one-on-one", "group"], {
    message: "Type must be 'one-on-one' or 'group'",
  }),
  email: z.string().email().optional(),
});

const waitlistGetSchema = z.object({
  instructorSlug: z.string().optional(),
});

type WaitlistPostResponse =
  | { success: true; message: string }
  | { error: string; errorId: string };

type WaitlistGetResponse =
  | { onWaitlist: boolean; entries: unknown[] }
  | { error: string; errorId: string };

/**
 * POST /api/waitlist
 * Add user to waitlist for an instructor
 * Allows both authenticated and unauthenticated users (using email)
 */
export async function POST(
  request: Request
): Promise<NextResponse<WaitlistPostResponse>> {
  const errorId = randomUUID();

  try {
    const { userId } = await auth();
    const body = await request.json();
    const validated = waitlistPostSchema.parse(body);
    // Validated but not yet used - will be used when TODO below is implemented
    const { instructorSlug: _instructorSlug, type: _type, email } = validated;

    if (!email && !userId) {
      return NextResponse.json(
        { error: "Email is required for unauthenticated users", errorId },
        { status: 400 }
      );
    }

    // TODO: Implement waitlist database logic
    // 1. Check if user/email is already on waitlist for this instructor/type
    // 2. Add user to waitlist table with:
    //    - userId (if authenticated) or null
    //    - email (required)
    //    - instructorSlug
    //    - type (one-on-one or group)
    //    - createdAt timestamp
    //    - notified: false
    
    // For now, just return success
    // In production, this would:
    // - Insert into waitlist table
    // - Send confirmation email
    // - Set up notification job to check when spots become available
    // - When instructor spots > 0, notify all waitlist entries for that instructor/type
    // - Mark entries as notified to prevent duplicate notifications

    return NextResponse.json({
      success: true,
      message: "Successfully added to waitlist",
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: error.issues[0]?.message || "Invalid request data",
          errorId,
        },
        { status: 400 }
      );
    }

    const errorName = error instanceof Error ? error.name : "UnknownError";
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Waitlist error [${errorId}]: ${errorName} - ${errorMessage}`);
    return NextResponse.json(
      { error: "Failed to join waitlist", errorId },
      { status: 500 }
    );
  }
}

/**
 * GET /api/waitlist
 * Get waitlist status for current user
 * Requires authentication
 */
export async function GET(
  request: Request
): Promise<NextResponse<WaitlistGetResponse>> {
  const errorId = randomUUID();

  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json(
        { error: "Authentication required", errorId },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const instructorSlugParam = searchParams.get("instructorSlug");

    const validated = waitlistGetSchema.parse({
      instructorSlug: instructorSlugParam || undefined,
    });
    const { instructorSlug: _instructorSlug } = validated;

    // TODO: Query waitlist table to check if user is on waitlist
    // Return waitlist entries for user (optionally filtered by instructor)
    // SELECT * FROM waitlist WHERE user_id = userId [AND instructor_slug = instructorSlug]

    return NextResponse.json({
      onWaitlist: false,
      entries: [],
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: error.issues[0]?.message || "Invalid query parameters",
          errorId,
        },
        { status: 400 }
      );
    }

    const errorName = error instanceof Error ? error.name : "UnknownError";
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(
      `Waitlist query error [${errorId}]: ${errorName} - ${errorMessage}`
    );
    return NextResponse.json(
      { error: "Failed to query waitlist", errorId },
      { status: 500 }
    );
  }
}

