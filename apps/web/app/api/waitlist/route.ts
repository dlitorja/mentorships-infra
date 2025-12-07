import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

/**
 * POST /api/waitlist
 * Add user to waitlist for an instructor
 * Allows both authenticated and unauthenticated users (using email)
 */
export async function POST(request: Request) {
  try {
    const { userId } = await auth();
    const body = await request.json();
    const { instructorSlug, type, email } = body;

    if (!instructorSlug || !type) {
      return NextResponse.json(
        { error: "Instructor slug and type are required" },
        { status: 400 }
      );
    }

    if (!email && !userId) {
      return NextResponse.json(
        { error: "Email is required for unauthenticated users" },
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
    console.error("Waitlist error:", error);
    return NextResponse.json(
      { error: "Failed to join waitlist" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/waitlist
 * Get waitlist status for current user
 * Requires authentication
 */
export async function GET(request: Request) {
  try {
    const { userId } = await auth();
    
    if (!userId) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const instructorSlug = searchParams.get("instructorSlug");

    // TODO: Query waitlist table to check if user is on waitlist
    // Return waitlist entries for user (optionally filtered by instructor)
    // SELECT * FROM waitlist WHERE user_id = userId [AND instructor_slug = instructorSlug]

    return NextResponse.json({
      onWaitlist: false,
      entries: [],
    });
  } catch (error) {
    console.error("Waitlist query error:", error);
    return NextResponse.json(
      { error: "Failed to query waitlist" },
      { status: 500 }
    );
  }
}

