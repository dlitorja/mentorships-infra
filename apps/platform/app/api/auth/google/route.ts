import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { requireRoleForApi } from "@/lib/auth-helpers";
import { getConvexClient } from "@/lib/convex";
import { api } from "@/convex/_generated/api";
import { getGoogleCalendarAuthUrl } from "@/lib/google";

const OAUTH_STATE_COOKIE = "gcal_oauth_state";

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

      if (!email || (!firstName && !lastName)) {
        try {
          const clerk = await clerkClient();
          const clerkUser = await clerk.users.getUser(user.id);
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
          console.error("[platform] Failed to fetch Clerk user details:", clerkError);
        }
      }

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