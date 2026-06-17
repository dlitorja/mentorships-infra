import { NextRequest, NextResponse } from "next/server";
import { requireRoleForApi, getConvexAuthToken, getClerkUserEmail } from "@/lib/auth-helpers";
import { getConvexClient } from "@/lib/convex";
import { api } from "@/convex/_generated/api";
import { exchangeGoogleCodeForTokens, getGoogleCalendarClient } from "@/lib/google";
import { clerkClient } from "@clerk/nextjs/server";

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
  console.log("[platform] OAuth callback: START");
  try {
    const user = await requireRoleForApi("instructor");
    console.log("[platform] OAuth callback: user.id =", user.id, "role =", user.role);

    const { searchParams } = new URL(request.url);
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    console.log("[platform] OAuth callback: code =", code ? "present" : "null", "state =", state ? "present" : "null");

    if (!code || !state) {
      console.log("[platform] OAuth callback: early exit - missing code or state");
      const res = NextResponse.redirect(getAppRedirectUrl(request, "/instructor/dashboard?google_calendar=error_missing_params"));
      res.cookies.delete(OAUTH_STATE_COOKIE);
      return res;
    }

    const cookieState = request.cookies.get(OAUTH_STATE_COOKIE)?.value;
    console.log("[platform] OAuth callback: cookieState =", cookieState ? "present" : "null");
    if (!cookieState || cookieState !== state) {
      console.log("[platform] OAuth callback: early exit - state mismatch");
      const res = NextResponse.redirect(getAppRedirectUrl(request, "/instructor/dashboard?google_calendar=error_state"));
      res.cookies.delete(OAUTH_STATE_COOKIE);
      return res;
    }

    const tokens = await exchangeGoogleCodeForTokens(code);
    console.log("[platform] OAuth callback: tokens =", tokens.refresh_token ? "refresh_token present" : "NO refresh_token");

    if (!tokens.refresh_token) {
      console.log("[platform] OAuth callback: early exit - no refresh_token");
      const res = NextResponse.redirect(getAppRedirectUrl(request, "/instructor/dashboard?google_calendar=error_no_refresh_token"));
      res.cookies.delete(OAUTH_STATE_COOKIE);
      return res;
    }

    const convex = getConvexClient();
    const token = await getConvexAuthToken();
    console.log("[platform] OAuth callback: convex token =", token ? "present" : "null");
    if (!token) {
      console.log("[platform] OAuth callback: early exit - no convex token");
      const res = NextResponse.redirect(getAppRedirectUrl(request, "/instructor/dashboard?google_calendar=error"));
      res.cookies.delete(OAUTH_STATE_COOKIE);
      return res;
    }
    convex.setAuth(token);
    let instructor = await convex.query(api.instructors.getInstructorByUserId, {
      userId: user.id,
    });
    console.log("[platform] OAuth callback: instructor by userId =", instructor ? instructor._id : "null", "userId =", user.id);

    if (!instructor) {
      const userEmail = await getClerkUserEmail(user.id);
      console.log("[platform] OAuth callback: trying email lookup with =", userEmail);
      if (userEmail) {
        instructor = await convex.query(api.instructors.getInstructorByEmail, {
          email: userEmail,
        });
        console.log("[platform] OAuth callback: instructor by email =", instructor ? instructor._id : "null", "email =", userEmail);
      }
    }

    if (!instructor) {
      console.log("[platform] OAuth callback: instructor not found by userId or email - will create new record");
      const userEmail = await getClerkUserEmail(user.id);
      if (userEmail) {
        try {
          const clerk = await clerkClient();
          const clerkUser = await clerk.users.getUser(user.id);
          let name = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") || undefined;

          if (!name) {
            name = userEmail.split("@")[0];
            console.log("[platform] OAuth callback: no name from Clerk, derived from email:", name);
          }

          const newInstructorId = await convex.mutation(api.instructors.createInstructor, {
            userId: user.id,
            email: userEmail,
            name,
          });
          console.log("[platform] OAuth callback: created new instructor =", newInstructorId);

          const newInstructor = await convex.query(api.instructors.getInstructorById, {
            id: newInstructorId,
          });
          if (newInstructor) {
            instructor = newInstructor;
          }
        } catch (createErr) {
          console.error("[platform] OAuth callback: failed to create instructor:", createErr);
        }
      }
    }

    if (!instructor) {
      console.log("[platform] OAuth callback: early exit - instructor not found and could not create");
      const res = NextResponse.redirect(getAppRedirectUrl(request, "/instructor/dashboard?google_calendar=error_instructor_not_found"));
      res.cookies.delete(OAUTH_STATE_COOKIE);
      return res;
    }

    console.log("[platform] OAuth callback: found instructor =", instructor._id, "userId =", user.id, "email =", instructor.email);

    console.log("[platform] OAuth callback: updating instructor with googleRefreshToken");
    const calendarTimezone = await getCalendarTimezone(tokens.refresh_token);

    const instructorUpdates: Record<string, unknown> = {
      googleRefreshToken: tokens.refresh_token,
      googleCalendarId: "primary",
    };

    if (calendarTimezone && !instructor.timeZone) {
      instructorUpdates.timeZone = calendarTimezone;
    }

    await convex.mutation(api.instructors.updateInstructor, {
      id: instructor._id,
      ...instructorUpdates,
    });
    console.log("[platform] OAuth callback: SUCCESS - redirecting to dashboard");

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