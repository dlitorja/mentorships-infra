import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { getConvexClient } from "@/lib/convex";
import { requireRoleForApi } from "@/lib/auth-helpers";
import { decryptInstructorRefreshToken } from "@/lib/crypto";
import { getGoogleCalendarClient } from "@/lib/google";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const user = await requireRoleForApi("instructor");
    const { id } = await params;
    const idSchema = z.string().min(1);
    const parseId = idSchema.safeParse(id);
    if (!parseId.success) {
      return NextResponse.json({ error: "Invalid booking id" }, { status: 400 });
    }
    const convex = getConvexClient();

    const booking = await convex.query(api.bookings.getBookingById, { id: id as Id<"bookings"> });
    if (!booking) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    }

    // Verify ownership by instructor
    const instructor = await convex.query(api.instructors.getInstructorById, { id: booking.instructorId });
    if (!instructor) {
      return NextResponse.json({ error: "Instructor not found" }, { status: 404 });
    }
    if (instructor.userId !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Best-effort delete from Google Calendar
    if (booking.googleEventId) {
      const refreshToken = decryptInstructorRefreshToken(instructor);
      if (refreshToken) {
        try {
          const calendar = await getGoogleCalendarClient(refreshToken);
          const calendarId = booking.eventCalendarId || instructor.googleCalendarId || "primary";
          await calendar.events.delete({ calendarId, eventId: booking.googleEventId, sendUpdates: "all" });
        } catch (err) {
          console.error("Failed to delete calendar event for booking:", booking._id, err);
        }
      }
    }

    await convex.mutation(api.bookings.cancel, { id: booking._id as Id<"bookings"> });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Booking delete error:", error);
    return NextResponse.json({ error: "Failed to cancel booking" }, { status: 500 });
  }
}
