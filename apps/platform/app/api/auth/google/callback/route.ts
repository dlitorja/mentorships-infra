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
    const userEmail = await getClerkUserEmail(user.id);
    let instructor = await convex.query(api.instructors.getInstructorByUserId, {
      userId: user.id,
    });
        if (!instructor && userEmail) {
            instructor = await convex.query(api.instructors.getInstructorByEmail, {
        email: userEmail,
      });
            if (instructor && !instructor.userId) {
                await convex.mutation(api.instructors.backfillInstructorUserId, {
          instructorId: instructor._id,
          userId: user.id,
        });
        const refreshed = await convex.query(api.instructors.getInstructorById, {
          id: instructor._id,
        });
        if (refreshed) {
          instructor = refreshed;
        }
      }
    }

    if (!instructor) {
            if (userEmail) {
        try {
          const clerk = await clerkClient();
          const clerkUser = await clerk.users.getUser(user.id);
          let name = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") || undefined;

          if (!name) {
            name = userEmail.split("@")[0];
                      }

          const newInstructorId = await convex.mutation(api.instructors.createInstructor, {
            userId: user.id,
            email: userEmail,
            name,
          });
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
            const res = NextResponse.redirect(getAppRedirectUrl(request, "/instructor/dashboard?google_calendar=error_instructor_not_found"));
      res.cookies.delete(OAUTH_STATE_COOKIE);
      return res;
    }

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