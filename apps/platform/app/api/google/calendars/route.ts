import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { requireRoleForApi } from "@/lib/auth-helpers";
import { getConvexClient } from "@/lib/convex";
import { api } from "@/convex/_generated/api";
import { decryptInstructorRefreshToken } from "@/lib/crypto";
import { getGoogleCalendarClient } from "@/lib/google";
import { isForbiddenError, isUnauthorizedError } from "@/lib/errors";

export async function GET(_req: NextRequest): Promise<NextResponse> {
  console.log("[platform] /api/google/calendars: START");
  try {
    const clerkAuth = await auth();
    const user = await requireRoleForApi("instructor");
    console.log("[platform] /api/google/calendars: user.id =", user.id, "role =", user.role);
    const convex = getConvexClient();

    const token = await clerkAuth.getToken({ template: "convex" });
    if (!token) {
      console.log("[platform] /api/google/calendars: no convex token, returning 401");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    convex.setAuth(token);

    const instructor = await convex.query(api.instructors.getInstructorByUserId, {
      userId: user.id,
    });
    console.log("[platform] /api/google/calendars: instructor =", instructor ? instructor._id : "null", "hasRefreshToken =", !!instructor?.googleRefreshToken);
    if (!instructor) {
      console.log("[platform] /api/google/calendars: returning 404 - instructor not found");
      return NextResponse.json({ error: "Instructor not found" }, { status: 404 });
    }
    console.log("[platform] /api/google/calendars: instructor found, proceeding");

    const refreshToken = decryptInstructorRefreshToken(instructor);
    if (!refreshToken) {
      return NextResponse.json(
        { error: "Instructor has not connected Google Calendar", code: "GOOGLE_CALENDAR_NOT_CONNECTED" },
        { status: 409 }
      );
    }

    const calendar = await getGoogleCalendarClient(refreshToken);
    const resp = await calendar.calendarList.list({});
    const items = (resp.data.items || []).filter((c) => Boolean(c.id));
    const calendars = items.map((c) => ({
      id: String(c.id),
      summary: c.summary || String(c.id) || "(untitled)",
      accessRole: c.accessRole || "reader",
      primary: Boolean(c.primary),
    }));

    return NextResponse.json({
      connected: true,
      calendars,
      selected: {
        eventCalendarId: instructor.googleCalendarId || "primary",
        availabilityCalendarIds: Array.isArray((instructor as any).googleAvailabilityCalendarIds)
          ? ((instructor as any).googleAvailabilityCalendarIds as string[])
          : (instructor.googleCalendarId ? [instructor.googleCalendarId] : ["primary"]),
      },
    });
  } catch (error) {
    console.error("[platform] List calendars error:", error);
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
    }
    return NextResponse.json({ error: "Failed to list calendars" }, { status: 500 });
  }
}
