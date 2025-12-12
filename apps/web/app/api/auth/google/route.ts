import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { requireDbUser } from "@/lib/auth";
import { getMentorByUserId } from "@mentorships/db";
import { getGoogleCalendarAuthUrl } from "@/lib/google";

const OAUTH_STATE_COOKIE = "gcal_oauth_state";

export async function GET(_request: NextRequest): Promise<NextResponse> {
  try {
    const user = await requireDbUser();

    if (user.role !== "mentor") {
      return NextResponse.json(
        { error: "Forbidden: mentor role required" },
        { status: 403 }
      );
    }

    const mentor = await getMentorByUserId(user.id);
    if (!mentor) {
      return NextResponse.json({ error: "Mentor not found" }, { status: 404 });
    }

    const state = randomUUID();
    const url = getGoogleCalendarAuthUrl(state);

    const res = NextResponse.redirect(url);
    res.cookies.set(OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 10 * 60, // 10 minutes
    });

    return res;
  } catch (error) {
    console.error("Google OAuth start error:", error);
    return NextResponse.json(
      { error: "Failed to start Google OAuth" },
      { status: 500 }
    );
  }
}

