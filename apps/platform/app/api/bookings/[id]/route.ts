import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { getAuthenticatedConvexClient } from "@/lib/convex";
import { requireRoleForApi } from "@/lib/auth-helpers";
import { isUnauthorizedError, isForbiddenError } from "@/lib/errors";
import { decryptInstructorRefreshToken } from "@/lib/crypto";
import { fetchInstructorGoogleCredentials } from "@/lib/google-credentials";
import { getGoogleCalendarClient } from "@/lib/google";

/**
 * DELETE /api/bookings/[id]
 * Cancels a booking and deletes the associated Google Calendar event.
 * Requires instructor role and ownership verification. Best-effort
 * calendar deletion (errors logged but don't fail cancellation).
 */
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
    const convex = await getAuthenticatedConvexClient();

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

    // Best-effort delete from Google Calendar. The credential fetch is part
    // of the best-effort block: a Convex/HTTP failure must not block the
    // cancellation itself.
    if (booking.googleEventId) {
      try {
        // The refresh token is not part of the public instructor query;
        // fetch it through the CONVEX_HTTP_KEY-gated server endpoint.
        const credentials = await fetchInstructorGoogleCredentials(
          booking.instructorId
        );
        const refreshToken = credentials
          ? decryptInstructorRefreshToken(credentials)
          : null;
        if (refreshToken) {
          const calendar = await getGoogleCalendarClient(refreshToken);
          const calendarId = booking.eventCalendarId || instructor.googleCalendarId || "primary";
          await calendar.events.delete({ calendarId, eventId: booking.googleEventId, sendUpdates: "all" });
        }
      } catch (err) {
        console.error("Failed to delete calendar event for booking:", booking._id, err);
      }
    }

    await convex.mutation(api.bookings.cancel, { id: booking._id as Id<"bookings"> });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    console.error("Booking delete error:", error);
    return NextResponse.json({ error: "Failed to cancel booking" }, { status: 500 });
  }
}
