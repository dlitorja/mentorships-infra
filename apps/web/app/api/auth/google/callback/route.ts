import { NextRequest, NextResponse } from "next/server";
import { requireDbUser } from "@/lib/auth";
import { getConvexClient } from "@/lib/convex";
import { api } from "@/convex/_generated/api";
import { exchangeGoogleCodeForTokens } from "@/lib/google";

const OAUTH_STATE_COOKIE = "gcal_oauth_state";

function getAppRedirectUrl(request: NextRequest, path: string): URL {
  // Prefer the current origin (works in both dev and prod)
  return new URL(path, request.url);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await requireDbUser();

    if (user.role !== "mentor") {
      return NextResponse.json(
        { error: "Forbidden: mentor role required" },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const code = searchParams.get("code");
    const state = searchParams.get("state");

    if (!code || !state) {
      return NextResponse.json(
        { error: "Missing code/state from Google OAuth callback" },
        { status: 400 }
      );
    }

    const cookieState = request.cookies.get(OAUTH_STATE_COOKIE)?.value;
    if (!cookieState || cookieState !== state) {
      return NextResponse.json({ error: "Invalid OAuth state" }, { status: 400 });
    }

    const tokens = await exchangeGoogleCodeForTokens(code);

    if (!tokens.refresh_token) {
      return NextResponse.json(
        {
          error:
            "Google did not return a refresh token. Please revoke access for this app in your Google Account and try again.",
        },
        { status: 400 }
      );
    }

    const convex = getConvexClient();

    const instructor = await convex.query(api.instructors.getInstructorByUserId, {
      userId: user.id,
    });

    if (!instructor) {
      return NextResponse.json({ error: "Instructor not found" }, { status: 404 });
    }

    await convex.mutation(api.instructors.updateInstructor, {
      id: instructor._id,
      googleRefreshToken: tokens.refresh_token,
      googleCalendarId: "primary",
    });

    const res = NextResponse.redirect(
      getAppRedirectUrl(request, "/instructor/dashboard?google_calendar=connected")
    );
    res.cookies.delete(OAUTH_STATE_COOKIE);
    return res;
  } catch (error) {
    console.error("Google OAuth callback error:", error);
    return NextResponse.json(
      { error: "Failed to connect Google Calendar" },
      { status: 500 }
    );
  }
}

