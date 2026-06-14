import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { requireRoleForApi } from "@/lib/auth-helpers";
import { getConvexClient } from "@/lib/convex";
import { api } from "@/convex/_generated/api";
import { getGoogleCalendarAuthUrl } from "@/lib/google";

const OAUTH_STATE_COOKIE = "gcal_oauth_state";

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
    const clerkAuth = await auth();
    const { sessionClaims } = clerkAuth;

    const user = await requireRoleForApi("instructor");

    const convex = getConvexClient();
    const token = await clerkAuth.getToken({ template: "convex" });
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    convex.setAuth(token);
    let instructor = await convex.query(api.instructors.getInstructorByUserId, {
      userId: user.id,
    });

    if (!instructor) {
      const hasNonEmptyString = (val: unknown): val is string => typeof val === "string" && val !== "";
      let email = hasNonEmptyString(sessionClaims?.email) ? sessionClaims.email : undefined;
      let firstName = hasNonEmptyString(sessionClaims?.first_name) ? sessionClaims.first_name : undefined;
      let lastName = hasNonEmptyString(sessionClaims?.last_name) ? sessionClaims.last_name : undefined;

      console.log("[platform] OAuth start: sessionClaims missing data, email:", email, "firstName:", firstName, "lastName:", lastName);

      if (!email || (!firstName && !lastName)) {
        try {
          const clerk = await clerkClient();
          console.log("[platform] OAuth start: Fetching Clerk user for userId:", user.id);
          const clerkUser = await clerk.users.getUser(user.id);
          console.log("[platform] OAuth start: Clerk user fetched, email:", clerkUser.emailAddresses[0]?.emailAddress, "firstName:", clerkUser.firstName, "lastName:", clerkUser.lastName);
          if (!email) {
            email = clerkUser.emailAddresses.find(e => e.id === clerkUser.primaryEmailAddressId)?.emailAddress;
          }
          if (!firstName) {
            firstName = clerkUser.firstName ?? undefined;
          }
          if (!lastName) {
            lastName = clerkUser.lastName ?? undefined;
          }
        } catch (clerkError) {
          console.error("[platform] OAuth start: Failed to fetch Clerk user details:", clerkError);
        }
      }

      const name = [firstName, lastName].filter(Boolean).join(" ") || undefined;
      console.log("[platform] OAuth start: Creating instructor with email:", email, "name:", name);

      try {
        await convex.mutation(api.instructors.createInstructor, {
          userId: user.id,
          email: email?.toLowerCase(),
          name,
          isActive: true,
          isNew: true,
        });
        console.log("[platform] OAuth start: createInstructor mutation completed");

        instructor = await convex.query(api.instructors.getInstructorByUserId, {
          userId: user.id,
        });
        console.log("[platform] OAuth start: Re-fetched instructor:", instructor ? "found" : "NOT FOUND");
      } catch (error) {
        console.error("[platform] OAuth start: Failed to create instructor on-demand:", error);
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