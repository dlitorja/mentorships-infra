import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { auth } from "@clerk/nextjs/server";
import { requireRoleForApi } from "@/lib/auth-helpers";
import { getConvexClient } from "@/lib/convex";
import { api } from "@/convex/_generated/api";
import { getGoogleCalendarAuthUrl } from "@/lib/google";

const OAUTH_STATE_COOKIE = "gcal_oauth_state";

async function getConvexAuthToken() {
  const clerkAuth = await auth();
  return clerkAuth.getToken({ template: "convex" });
}

/**
 * GET /api/auth/google
 * Initiates Google OAuth flow for connecting instructor's Google Calendar.
 * Requires instructor role. If no instructor record exists in Convex but the
 * user has an instructor role in Clerk, creates one on-demand. Generates CSRF
 * state token, builds Google auth URL, and redirects user to Google consent
 * screen. State cookie set for 10 minutes.
 */
export async function GET(_request: NextRequest): Promise<NextResponse> {
  try {
    const { sessionClaims } = await auth();

    const user = await requireRoleForApi("instructor");

    const convex = getConvexClient();
    const token = await getConvexAuthToken();
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    convex.setAuth(token);
    let instructor = await convex.query(api.instructors.getInstructorByUserId, {
      userId: user.id,
    });

    if (!instructor) {
      const claims = (sessionClaims ?? {}) as Record<string, unknown>;
      const email = claims.email as string | undefined;
      const firstName = claims.first_name as string | undefined;
      const lastName = claims.last_name as string | undefined;
      const name = [firstName, lastName].filter(Boolean).join(" ") || undefined;

      try {
        await convex.mutation(api.instructors.createInstructor, {
          userId: user.id,
          email: email?.toLowerCase(),
          name,
          isActive: true,
          isNew: true,
        });

        instructor = await convex.query(api.instructors.getInstructorByUserId, {
          userId: user.id,
        });
      } catch (error) {
        console.error("[platform] Failed to create instructor on-demand:", error);
      }
    }

    if (!instructor) {
      return NextResponse.json(
        { error: "Instructor not found. Please contact support." },
        { status: 404 }
      );
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
