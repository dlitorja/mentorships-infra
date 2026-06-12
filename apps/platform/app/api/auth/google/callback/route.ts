import { NextRequest, NextResponse } from "next/server";
import { requireRoleForApi, getConvexAuthToken } from "@/lib/auth-helpers";
import { getConvexClient } from "@/lib/convex";
import { api } from "@/convex/_generated/api";
import { exchangeGoogleCodeForTokens, getGoogleCalendarClient } from "@/lib/google";

const OAUTH_STATE_COOKIE = "gcal_oauth_state";

function getAppRedirectUrl(request: NextRequest, path: string): URL {
  return new URL(path, request.url);
}

async function getCalendarTimezone(refreshToken: string): Promise<string | null> {
  try {
    const calendar = await getGoogleCalendarClient(refreshToken);
    const response = await calendar.calendars.get({ calendarId: "primary" });
    return response.data.timeZone || null;
  } catch (error) {
    console.error("[platform] Failed to get calendar timezone:", error);
    return null;
  }
}

/**
 * GET /api/auth/google/callback
 * Handles Google OAuth callback after user consents to calendar access.
 * Requires instructor role. Validates state cookie, exchanges auth code
 * for tokens, stores refresh token and hardcoded "primary" calendar ID
 * in Convex. Automatically sets instructor timezone from Google Calendar.
 * Redirects to dashboard with google_calendar status param.
 */
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
    const token = await getConvexAuthToken();
    if (!token) {
      const res = NextResponse.redirect(getAppRedirectUrl(request, "/instructor/dashboard?google_calendar=error"));
      res.cookies.delete(OAUTH_STATE_COOKIE);
      return res;
    }
    convex.setAuth(token);
    const instructor = await convex.query(api.instructors.getInstructorByUserId, {
      userId: user.id,
    });
    if (!instructor) {
      const res = NextResponse.redirect(getAppRedirectUrl(request, "/instructor/dashboard?google_calendar=error_instructor_not_found"));
      res.cookies.delete(OAUTH_STATE_COOKIE);
      return res;
    }

    const calendarTimezone = await getCalendarTimezone(tokens.refresh_token);
    console.log("[platform] Google Calendar connected, calendar timezone:", calendarTimezone);

    const instructorUpdates: Record<string, unknown> = {
      googleRefreshToken: tokens.refresh_token,
      googleCalendarId: "primary",
    };

    if (calendarTimezone && !instructor.timeZone) {
      instructorUpdates.timeZone = calendarTimezone;
      console.log("[platform] Auto-setting instructor timezone from Google Calendar");
    }

    await convex.mutation(api.instructors.updateInstructor, {
      id: instructor._id,
      ...instructorUpdates,
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