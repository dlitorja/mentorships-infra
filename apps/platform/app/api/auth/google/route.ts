import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { requireRoleForApi } from "@/lib/auth-helpers";
import { getConvexClient } from "@/lib/convex";
import { api } from "@/convex/_generated/api";
import { getGoogleCalendarAuthUrl } from "@/lib/google";

const OAUTH_STATE_COOKIE = "gcal_oauth_state";

/**
 * GET /api/auth/google
 * Initiates Google OAuth flow for connecting instructor's Google Calendar.
 * Requires instructor role. Generates CSRF state token, builds Google auth URL,
 * and redirects user to Google consent screen. State cookie set for 10 minutes.
 */
export async function GET(_request: NextRequest): Promise<NextResponse> {
  try {
    const user = await requireRoleForApi("instructor");

    const convex = getConvexClient();
    const instructor = await convex.query(api.instructors.getInstructorByUserId, {
      userId: user.id,
    });

    if (!instructor) {
      return NextResponse.json({ error: "Instructor not found" }, { status: 404 });
    }

    const state = randomUUID();
    const url = getGoogleCalendarAuthUrl(state);

    const res = NextResponse.redirect(url);
    res.cookies.set(OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 10 * 60,
    });
    return res;
  } catch (error) {
    console.error("[platform] Google OAuth start error:", error);
    return NextResponse.json({ error: "Failed to start Google OAuth" }, { status: 500 });
  }
}
