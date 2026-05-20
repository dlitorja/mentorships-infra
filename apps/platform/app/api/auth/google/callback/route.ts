import { NextRequest, NextResponse } from "next/server";
import { requireRoleForApi } from "@/lib/auth-helpers";
import { getConvexClient } from "@/lib/convex";
import { api } from "@/convex/_generated/api";
import { exchangeGoogleCodeForTokens } from "@/lib/google";

const OAUTH_STATE_COOKIE = "gcal_oauth_state";

function getAppRedirectUrl(request: NextRequest, path: string): URL {
  return new URL(path, request.url);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await requireRoleForApi("instructor");

    const { searchParams } = new URL(request.url);
    const code = searchParams.get("code");
    const state = searchParams.get("state");

    if (!code || !state) {
      const res = NextResponse.redirect(getAppRedirectUrl(request, "/instructor/dashboard?google_calendar=error_missing_params"));
      res.cookies.delete(OAUTH_STATE_COOKIE);
      return res;
    }

    const cookieState = request.cookies.get(OAUTH_STATE_COOKIE)?.value;
    if (!cookieState || cookieState !== state) {
      const res = NextResponse.redirect(getAppRedirectUrl(request, "/instructor/dashboard?google_calendar=error_state"));
      res.cookies.delete(OAUTH_STATE_COOKIE);
      return res;
    }

    const tokens = await exchangeGoogleCodeForTokens(code);

    if (!tokens.refresh_token) {
      const res = NextResponse.redirect(getAppRedirectUrl(request, "/instructor/dashboard?google_calendar=error_no_refresh_token"));
      res.cookies.delete(OAUTH_STATE_COOKIE);
      return res;
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
    console.error("[platform] Google OAuth callback error:", error);
    const res = NextResponse.redirect(getAppRedirectUrl(request, "/instructor/dashboard?google_calendar=error"));
    res.cookies.delete(OAUTH_STATE_COOKIE);
    return res;
  }
}
