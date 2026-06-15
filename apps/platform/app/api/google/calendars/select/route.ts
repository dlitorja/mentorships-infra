import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { requireRoleForApi } from "@/lib/auth-helpers";
import { getConvexClient } from "@/lib/convex";
import { api } from "@/convex/_generated/api";

const bodySchema = z.object({
  eventCalendarId: z.string().min(1),
  availabilityCalendarIds: z.array(z.string().min(1)).min(1),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const user = await requireRoleForApi("instructor");
    const convex = getConvexClient();

    const clerkAuth = await auth();
    const token = await clerkAuth.getToken({ template: "convex" });
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    convex.setAuth(token);

    const instructor = await convex.query(api.instructors.getInstructorByUserId, { userId: user.id });
    if (!instructor) {
      return NextResponse.json({ error: "Instructor not found" }, { status: 404 });
    }

    // Parse JSON with proper error handling
    let json: unknown;
    try {
      json = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request", details: parsed.error.issues }, { status: 400 });
    }

    const { eventCalendarId, availabilityCalendarIds } = parsed.data;

    const { decryptInstructorRefreshToken } = await import("@/lib/crypto");
    const { getGoogleCalendarClient } = await import("@/lib/google");
    const rt = decryptInstructorRefreshToken(instructor as any);
    if (!rt) {
      return NextResponse.json(
        { error: "Instructor has not connected Google Calendar", code: "GOOGLE_CALENDAR_NOT_CONNECTED" },
        { status: 409 }
      );
    }
    const cal = await getGoogleCalendarClient(rt);
    const resp = await cal.calendarList.list({});
    const items = (resp.data.items || []).filter((c) => Boolean(c.id));
    const byId = new Map(items.map((c) => [String(c.id), c]));

    const primaryCal = items.find((c) => c.primary);
    const primaryId = primaryCal ? String(primaryCal.id) : undefined;

    const resolvedEventCalendarId = eventCalendarId === "primary" && primaryId ? primaryId : eventCalendarId;
    const resolvedAvailabilityCalendarIds = availabilityCalendarIds.map((id) => id === "primary" && primaryId ? primaryId : id);

    const eventCal = byId.get(resolvedEventCalendarId);
    if (!eventCal) {
      return NextResponse.json({ error: `Unknown event calendar: ${resolvedEventCalendarId}` }, { status: 400 });
    }
    const role = eventCal.accessRole || "reader";
    const writable = role === "owner" || role === "writer";
    if (!writable) {
      return NextResponse.json({ error: `Event calendar not writable: ${resolvedEventCalendarId}` }, { status: 400 });
    }

    const invalidAvail = resolvedAvailabilityCalendarIds.filter((id) => !byId.has(id));
    if (invalidAvail.length > 0) {
      return NextResponse.json({ error: `Unknown availability calendar(s): ${invalidAvail.join(", ")}` }, { status: 400 });
    }

    try {
      await convex.mutation(api.instructors.updateInstructor, {
        id: instructor._id,
        googleCalendarId: resolvedEventCalendarId,
        googleAvailabilityCalendarIds: resolvedAvailabilityCalendarIds,
      });
    } catch (e) {
      console.error("[platform] Failed to save calendar selection:", e);
      return NextResponse.json({ error: "Failed to save calendar selection" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[platform] Save calendar selection error:", error);
    return NextResponse.json({ error: "Failed to save calendar selection" }, { status: 500 });
  }
}
