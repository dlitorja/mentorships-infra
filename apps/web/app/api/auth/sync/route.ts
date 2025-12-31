import { NextResponse } from "next/server";
import { getOrCreateUser } from "@mentorships/db";
import { requireAuth, isUnauthorizedError } from "@/lib/auth";

/**
 * API route to manually sync Clerk user to Supabase
 * This is useful for testing or manual sync operations
 * 
 * GET /api/auth/sync - Sync current user
 */
export async function GET() {
  try {
    // Ensure user is authenticated
    await requireAuth();
    
    // Sync user to database
    const user = await getOrCreateUser();
    
    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("Error syncing user:", error);

    if (isUnauthorizedError(error)) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    return NextResponse.json(
      { error: "Failed to sync user" },
      { status: 500 }
    );
  }
}

