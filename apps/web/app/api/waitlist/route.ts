import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { waitlist } from "@mentorships-infra/db";
import { eq, and } from "drizzle-orm";
import { validateEmail } from "@/lib/validation";

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
    const { instructorSlug, type, email } = validated;

    // Normalize email for unauthenticated users
    const normalizedEmail = email ? validateEmail(email) : null;

    if (!normalizedEmail && !userId) {
      return NextResponse.json(
        { error: "Email is required for unauthenticated users", errorId },
        { status: 400 }
      );
    }

    // Use userId for authenticated users, normalizedEmail for unauthenticated
    // Don't create synthetic emails - email can be null when userId is present
    const userEmail = userId ? null : normalizedEmail;

    // Check if already on waitlist for this instructor/type
    // For authenticated users: check by userId
    // For unauthenticated users: check by email
    const whereCondition = userId
      ? eq(waitlist.userId, userId)
      : and(
          eq(waitlist.email, userEmail!),
          eq(waitlist.instructorSlug, instructorSlug),
          eq(waitlist.type, type)
        );

    const existingEntry = await db
      .select()
      .from(waitlist)
      .where(whereCondition)
      .limit(1);

    if (existingEntry.length > 0) {
      return NextResponse.json({
        success: true,
        message: "You are already on this waitlist",
      });
    }

    // Add to waitlist
    await db.insert(waitlist).values({
      userId: userId || null,
      email: userEmail,
      instructorSlug,
      type,
      notified: false,
    });

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
    const { instructorSlug } = validated;

    // Query waitlist table for user entries
    // Combine conditions to avoid calling .where() twice
    const conditions = [eq(waitlist.userId, userId)];

    // Filter by instructor if specified
    if (instructorSlug) {
      conditions.push(eq(waitlist.instructorSlug, instructorSlug));
    }

    const query = db.select().from(waitlist).where(and(...conditions));

    const entries = await query;

    return NextResponse.json({
      onWaitlist: entries.length > 0,
      entries,
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

