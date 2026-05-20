import { NextRequest, NextResponse } from "next/server";
import { requireRoleForApi } from "@/lib/auth-helpers";
import { getConvexClient } from "@/lib/convex";
import { api } from "@/convex/_generated/api";

export async function POST(_req: NextRequest): Promise<NextResponse> {
  try {
    const user = await requireRoleForApi("instructor");
    const convex = getConvexClient();

    const instructor = await convex.query(api.instructors.getInstructorByUserId, {
      userId: user.id,
    });
    if (!instructor) {
      return NextResponse.json({ error: "Instructor not found" }, { status: 404 });
    }

    // Attempt token revocation with Google; ignore errors
    try {
      const tokenToRevoke = instructor.googleRefreshToken;
      if (tokenToRevoke) {
        const params = new URLSearchParams();
        params.set("token", tokenToRevoke);
        await fetch("https://oauth2.googleapis.com/revoke", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: params.toString(),
        });
      }
    } catch (revErr) {
      console.warn("[platform] Google token revocation failed (ignored):", revErr);
    }

    await convex.mutation(api.instructors.updateInstructor, {
      id: instructor._id,
      googleRefreshToken: null,
      googleCalendarId: null,
      googleAvailabilityCalendarIds: [],
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[platform] Google disconnect error:", error);
    return NextResponse.json({ error: "Failed to disconnect Google Calendar" }, { status: 500 });
  }
}
