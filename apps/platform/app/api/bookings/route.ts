import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { getAuthenticatedConvexClient } from "@/lib/convex";
import { requireAuth } from "@/lib/auth-helpers";
import { isUnauthorizedError } from "@/lib/errors";
import { getGoogleCalendarClient } from "@/lib/google";
import { decryptInstructorRefreshToken } from "@/lib/crypto";
import { calendar_v3 } from "googleapis";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { tasks } from "@trigger.dev/sdk";
import { reportError } from "@/lib/observability";
import { withRetries } from "@/lib/utils";

const createSchema = z.object({
  instructorId: z.string().min(1),
  start: z.string().datetime(),
  end: z.string().datetime(),
  timezone: z.string().min(1),
  studentEmail: z.string().email().optional(),
  studentName: z.string().min(1),
  suppressNotifications: z.boolean().optional(),
});

/**
 * Confirm the booking in Convex, resolving the ambiguous-transport case where
 * the mutation commits server-side but the HTTP response is lost. If the
 * confirm call throws, we query the booking state; if it is already confirmed,
 * we treat the booking as successfully confirmed.
 */
async function confirmBookingSafely(
  convex: Awaited<ReturnType<typeof getAuthenticatedConvexClient>>,
  bookingId: string,
  eventCalendarId: string,
  googleEventId: string
): Promise<{ booking: any; confirmed: true }> {
  try {
    const booking = await convex.mutation(api.bookings.confirm, {
      id: bookingId as Id<"bookings">,
      eventCalendarId,
      googleEventId,
    });
    return { booking, confirmed: true };
  } catch (confirmErr) {
    // Confirm is idempotent, so a lost response may have still committed.
    // Query the booking to resolve the ambiguity before rolling back.
    try {
      const existing = await convex.query(api.bookings.getBookingById, {
        id: bookingId as Id<"bookings">,
      });
      if (existing && existing.status === "confirmed") {
        return { booking: existing, confirmed: true };
      }
    } catch (statusErr) {
      console.error("Failed to query booking status after confirm error:", statusErr);
    }
    throw confirmErr;
  }
}

/**
 * POST /api/bookings
 * Creates a new booking for a session slot.
 * Requires authenticated user. Checks Google Calendar free/busy for conflicts,
 * creates pending booking lock, inserts Google Calendar event, then confirms.
 * Triggers booking-notifications task unless suppressed. Rollback on failure.
 * Note: studentEmail body param is accepted but ignored; email is derived
 * from the authenticated Clerk session for security.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const userId = await requireAuth();
    // Resolve authenticated user's email for attendee; do not trust body-provided email
    const clerk = await clerkClient();
    const { userId: clerkUserId } = await auth();
    let sessionEmail: string | null = null;
    if (clerkUserId) {
      try {
        const user = await clerk.users.getUser(clerkUserId);
        const primary = user.primaryEmailAddressId
          ? user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId)?.emailAddress
          : user.emailAddresses[0]?.emailAddress;
        sessionEmail = primary ?? null;
      } catch (e) {
        console.warn("[bookings] Failed to fetch Clerk user email:", e);
      }
    }
    const body = await request.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request", details: parsed.error.issues }, { status: 400 });
    }

    const { instructorId, start, end, timezone, studentEmail, studentName, suppressNotifications } = parsed.data;
    const startUtc = new Date(start).getTime();
    const endUtc = new Date(end).getTime();
    if (!Number.isFinite(startUtc) || !Number.isFinite(endUtc) || endUtc <= startUtc) {
      return NextResponse.json({ error: "Invalid start/end" }, { status: 400 });
    }

    const convex = await getAuthenticatedConvexClient();

    const instructor = await convex.query(api.instructors.getInstructorById, {
      id: instructorId as Id<"instructors">,
    });
    if (!instructor) {
      return NextResponse.json({ error: "Instructor not found" }, { status: 404 });
    }

    const refreshToken = decryptInstructorRefreshToken(instructor);
    if (!refreshToken) {
      return NextResponse.json({ error: "Instructor calendar not connected" }, { status: 409 });
    }

    const calendar = await getGoogleCalendarClient(refreshToken);
    const eventCalendarId = instructor.googleCalendarId || "primary";
    const availabilityCalendars: string[] = Array.isArray(
      (instructor as { googleAvailabilityCalendarIds?: string[] | null })?.googleAvailabilityCalendarIds
    ) && ((instructor as { googleAvailabilityCalendarIds?: string[] | null }).googleAvailabilityCalendarIds!.length > 0)
      ? (instructor as { googleAvailabilityCalendarIds?: string[] | null }).googleAvailabilityCalendarIds!
      : [eventCalendarId];

    // Freebusy check
    const fb = await calendar.freebusy.query({
      requestBody: {
        timeMin: new Date(startUtc).toISOString(),
        timeMax: new Date(endUtc).toISOString(),
        items: availabilityCalendars.map((id) => ({ id })),
      },
    });
    const calendarsBusy = (fb.data.calendars || {}) as Record<string, calendar_v3.Schema$FreeBusyCalendar | undefined>;
    const errored: string[] = [];
    for (const id of availabilityCalendars) {
      const entry = calendarsBusy[id];
      if (!entry || (entry.errors && entry.errors.length > 0) || (entry as any).error) {
        errored.push(id);
      }
    }
    if (errored.length > 0) {
      return NextResponse.json(
        { error: `Google Calendar freebusy failed for: ${errored.join(", ")}` },
        { status: 502 }
      );
    }
    const busy: calendar_v3.Schema$TimePeriod[] = availabilityCalendars.flatMap((id) =>
      Array.isArray(calendarsBusy[id]?.busy) ? (calendarsBusy[id]!.busy as calendar_v3.Schema$TimePeriod[]) : []
    );
    const overlaps = busy.some((b) => {
      if (!b || !b.start || !b.end) return false;
      const s = new Date(b.start).getTime();
      const e = new Date(b.end).getTime();
      return startUtc < e && endUtc > s;
    });
    if (overlaps) {
      return NextResponse.json({ error: "Slot no longer available" }, { status: 409 });
    }

    // Create pending booking (lock)
    const idempotencyKey = `${instructorId}|${startUtc}|${endUtc}`;
    const pending = await convex.mutation(api.bookings.createPending, {
      instructorId: instructorId as Id<"instructors">,
      startUtc,
      endUtc,
      timezone,
      studentEmail: sessionEmail ?? studentEmail ?? "",
      studentName,
      idempotencyKey,
      createdByUserId: userId,
    });
    if (pending?.conflict) {
      return NextResponse.json({ error: "Slot already booked" }, { status: 409 });
    }

    // Insert Google event with robust rollback
    const descriptionLines: string[] = [];
    if (instructor.discordVoiceChannelUrl) {
      descriptionLines.push(`Join Discord voice: ${instructor.discordVoiceChannelUrl}`);
      descriptionLines.push("");
      descriptionLines.push("Join this voice channel at the session start time.");
      descriptionLines.push("");
    }
    descriptionLines.push(
      "Need to cancel or reschedule? Contact your instructor in your workspace. Please try to inform them at least 24 hours in advance; instructors handle changes requested with less than 24 hours' notice at their discretion."
    );

    let confirmed = null as any;
    let didConfirm = false;
    let googleEventId: string | null = null;
    try {
      const insert = await calendar.events.insert({
        calendarId: eventCalendarId,
        sendUpdates: "all",
        requestBody: {
          summary: `Session with ${studentName}`,
          description: descriptionLines.join("\n"),
          location: instructor.discordVoiceChannelUrl || undefined,
          start: { dateTime: new Date(startUtc).toISOString(), timeZone: timezone },
          end: { dateTime: new Date(endUtc).toISOString(), timeZone: timezone },
          attendees: [{ email: sessionEmail ?? studentEmail }],
          extendedProperties: { private: { idempotencyKey } },
        },
      });

      googleEventId = insert.data.id ?? null;
      if (!googleEventId) {
        return NextResponse.json({ error: "Failed to create calendar event" }, { status: 502 });
      }

      const confirmResult = await confirmBookingSafely(convex, pending.bookingId, eventCalendarId, googleEventId);
      confirmed = confirmResult.booking;
      didConfirm = true;
      if (!suppressNotifications) {
        // Trigger notifications task (student + instructor) when not suppressed
        try {
          await tasks.trigger("booking-notifications", {
            studentEmail: confirmed.studentEmail,
            studentName: confirmed.studentName,
            instructorEmail: instructor.email || null,
            instructorName: instructor.name || null,
            scheduledAtUtc: confirmed.startUtc,
            studentTimeZone: timezone,
            instructorTimeZone: instructor.timeZone || null,
          });
        } catch (e) {
          console.error("Failed to trigger booking-notifications task:", e);
        }
      }
      return NextResponse.json({ success: true, booking: confirmed });
    } catch (e) {
      console.error("Google Calendar insert or confirm error:", e);
      return NextResponse.json({ error: "Failed to create calendar event or confirm booking" }, { status: 502 });
    } finally {
      if (!didConfirm) {
        // Roll back the pending booking lock so the slot is not permanently held.
        try {
          await withRetries(
            () => convex.mutation(api.bookings.cancel, { id: pending.bookingId }),
            3,
            250
          );
        } catch (rollbackErr) {
          console.error("Failed to rollback pending booking after retries:", rollbackErr, {
            bookingId: pending.bookingId,
          });
          await reportError({
            source: "api.bookings.create.rollback.cancel",
            error: rollbackErr instanceof Error ? rollbackErr : new Error(String(rollbackErr)),
            level: "error",
            message: "Failed to cancel pending booking after multiple retries",
            context: { bookingId: pending.bookingId },
          });
        }
        // If we created a calendar event but never confirmed the booking in
        // Convex, delete the orphaned calendar event so it doesn't clutter the
        // instructor's Google Calendar.
        const eventIdToDelete = googleEventId;
        if (eventIdToDelete) {
          try {
            await withRetries(
              () =>
                calendar.events.delete({
                  calendarId: eventCalendarId,
                  eventId: eventIdToDelete,
                  sendUpdates: "all",
                }),
              3,
              250
            );
          } catch (deleteErr) {
            console.error("Failed to rollback orphaned calendar event after retries:", deleteErr, {
              eventCalendarId,
              googleEventId,
            });
            await reportError({
              source: "api.bookings.create.rollback.calendarDelete",
              error: deleteErr instanceof Error ? deleteErr : new Error(String(deleteErr)),
              level: "error",
              message: "Failed to delete orphaned calendar event after multiple retries",
              context: { eventCalendarId, googleEventId, bookingId: pending.bookingId },
            });
          }
        }
      }
    }
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Booking create error:", error);
    return NextResponse.json({ error: "Failed to create booking" }, { status: 500 });
  }
}
