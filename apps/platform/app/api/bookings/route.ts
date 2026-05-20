import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { getConvexClient } from "@/lib/convex";
import { requireAuth } from "@/lib/auth-helpers";
import { getGoogleCalendarClient } from "@/lib/google";
import { decryptInstructorRefreshToken } from "@/lib/crypto";
import { calendar_v3 } from "googleapis";
import { auth, clerkClient } from "@clerk/nextjs/server";

const createSchema = z.object({
  instructorId: z.string().min(1),
  start: z.string().datetime(),
  end: z.string().datetime(),
  timezone: z.string().min(1),
  // studentEmail is derived from session; accept optional input for legacy callers but ignore
  studentEmail: z.string().email().optional(),
  studentName: z.string().min(1),
});

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

    const { instructorId, start, end, timezone, studentEmail, studentName } = parsed.data;
    const startUtc = new Date(start).getTime();
    const endUtc = new Date(end).getTime();
    if (!Number.isFinite(startUtc) || !Number.isFinite(endUtc) || endUtc <= startUtc) {
      return NextResponse.json({ error: "Invalid start/end" }, { status: 400 });
    }

    const convex = getConvexClient();

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
    }

    let confirmed = null as any;
    let didConfirm = false;
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

      const googleEventId = insert.data.id;
      if (!googleEventId) {
        return NextResponse.json({ error: "Failed to create calendar event" }, { status: 502 });
      }

      confirmed = await convex.mutation(api.bookings.confirm, {
        id: pending.bookingId,
        eventCalendarId,
        googleEventId,
      });
      didConfirm = true;
      return NextResponse.json({ success: true, booking: confirmed });
    } catch (e) {
      console.error("Google Calendar insert error:", e);
      return NextResponse.json({ error: "Failed to create calendar event" }, { status: 502 });
    } finally {
      if (!didConfirm) {
        try {
          await convex.mutation(api.bookings.cancel, { id: pending.bookingId });
        } catch (rollbackErr) {
          console.error("Failed to rollback pending booking:", rollbackErr, { bookingId: pending.bookingId });
        }
      }
    }
  } catch (error) {
    console.error("Booking create error:", error);
    return NextResponse.json({ error: "Failed to create booking" }, { status: 500 });
  }
}
