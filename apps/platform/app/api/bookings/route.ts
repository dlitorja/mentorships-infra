import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { getConvexClient } from "@/lib/convex";
import { requireAuth } from "@/lib/auth-helpers";
import { getGoogleCalendarClient } from "@/lib/google";
import { decryptInstructorRefreshToken } from "@/lib/crypto";

const createSchema = z.object({
  instructorId: z.string().min(1),
  start: z.string().datetime(),
  end: z.string().datetime(),
  timezone: z.string().min(1),
  studentEmail: z.string().email(),
  studentName: z.string().min(1),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const userId = await requireAuth();
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
    const availabilityCalendars: string[] = Array.isArray((instructor as any).googleAvailabilityCalendarIds) && (instructor as any).googleAvailabilityCalendarIds.length > 0
      ? (instructor as any).googleAvailabilityCalendarIds
      : [eventCalendarId];

    // Freebusy check
    const fb = await calendar.freebusy.query({
      requestBody: {
        timeMin: new Date(startUtc).toISOString(),
        timeMax: new Date(endUtc).toISOString(),
        items: availabilityCalendars.map((id) => ({ id })),
      },
    });
    const calendarsBusy = (fb.data.calendars || {}) as Record<string, any>;
    const errored: string[] = [];
    for (const id of availabilityCalendars) {
      const entry = calendarsBusy[id];
      if (!entry || (entry as any).errors || (entry as any).error) {
        errored.push(id);
      }
    }
    if (errored.length > 0) {
      return NextResponse.json(
        { error: `Google Calendar freebusy failed for: ${errored.join(", ")}` },
        { status: 502 }
      );
    }
    const busy = availabilityCalendars.flatMap((id) => Array.isArray(calendarsBusy[id]?.busy) ? calendarsBusy[id]!.busy : []);
    const overlaps = busy.some((b: any) => {
      if (!b.start || !b.end) return false;
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
      studentEmail,
      studentName,
      idempotencyKey,
      createdByUserId: userId,
    });
    if (pending?.conflict) {
      return NextResponse.json({ error: "Slot already booked" }, { status: 409 });
    }

    // Insert Google Calendar event
    const descriptionLines: string[] = [];
    if (instructor.discordVoiceChannelUrl) {
      descriptionLines.push(`Join Discord voice: ${instructor.discordVoiceChannelUrl}`);
      descriptionLines.push("");
      descriptionLines.push("Join this voice channel at the session start time.");
    }

    const insert = await calendar.events.insert({
      calendarId: eventCalendarId,
      sendUpdates: "all",
      requestBody: {
        summary: `Session with ${studentName}`,
        description: descriptionLines.join("\n"),
        location: instructor.discordVoiceChannelUrl || undefined,
        start: { dateTime: new Date(startUtc).toISOString(), timeZone: timezone },
        end: { dateTime: new Date(endUtc).toISOString(), timeZone: timezone },
        attendees: [{ email: studentEmail }],
        extendedProperties: { private: { idempotencyKey } },
      },
    });

    const googleEventId = insert.data.id;
    if (!googleEventId) {
      // Roll back lock
      await convex.mutation(api.bookings.cancel, { id: pending.bookingId });
      return NextResponse.json({ error: "Failed to create calendar event" }, { status: 502 });
    }

    const confirmed = await convex.mutation(api.bookings.confirm, {
      id: pending.bookingId,
      eventCalendarId,
      googleEventId,
    });

    return NextResponse.json({ success: true, booking: confirmed });
  } catch (error) {
    console.error("Booking create error:", error);
    return NextResponse.json({ error: "Failed to create booking" }, { status: 500 });
  }
}
