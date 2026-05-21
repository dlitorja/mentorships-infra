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
import { sendEmail } from "@/lib/email";
import { buildSeriesSummaryEmails } from "../../../../../../packages/emails/src/booking";

const createSeriesSchema = z.object({
  instructorId: z.string().min(1),
  start: z.string().datetime(), // ISO of the initially booked slot
  timezone: z.string().min(1),
  weeks: z.coerce.number().int().min(1).max(3), // create N weekly follow-ups
  studentName: z.string().min(1),
});

type ResultItem = { weekOffset: number; status: "created" | "skipped"; reason?: string; bookingId?: string };

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const userId = await requireAuth();

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
        console.warn("[bookings-series] Failed to fetch Clerk user email:", e);
      }
    }

    const body = await request.json();
    const parsed = createSeriesSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request", details: parsed.error.issues }, { status: 400 });
    }

    const { instructorId, start, timezone, weeks, studentName } = parsed.data;

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

    const baseStartMs = new Date(start).getTime();
    if (!Number.isFinite(baseStartMs)) {
      return NextResponse.json({ error: "Invalid start" }, { status: 400 });
    }

    const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
    const ONE_HOUR_MS = 60 * 60 * 1000; // 60-minute sessions only

    const results: ResultItem[] = [];
    const createdTimes: number[] = [];

    for (let i = 1; i <= weeks; i++) {
      const slotStartUtc = baseStartMs + i * ONE_WEEK_MS;
      const slotEndUtc = slotStartUtc + ONE_HOUR_MS;

      try {
        // Freebusy check
        const fb = await calendar.freebusy.query({
          requestBody: {
            timeMin: new Date(slotStartUtc).toISOString(),
            timeMax: new Date(slotEndUtc).toISOString(),
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
          results.push({ weekOffset: i, status: "skipped", reason: `freebusy failed: ${errored.join(", ")}` });
          continue;
        }
        const busy: calendar_v3.Schema$TimePeriod[] = availabilityCalendars.flatMap((id) =>
          Array.isArray(calendarsBusy[id]?.busy) ? (calendarsBusy[id]!.busy as calendar_v3.Schema$TimePeriod[]) : []
        );
        const overlaps = busy.some((b) => {
          if (!b || !b.start || !b.end) return false;
          const s = new Date(b.start).getTime();
          const e = new Date(b.end).getTime();
          return slotStartUtc < e && slotEndUtc > s;
        });
        if (overlaps) {
          results.push({ weekOffset: i, status: "skipped", reason: "Slot no longer available" });
          continue;
        }

        // Create pending booking
        const idempotencyKey = `${instructorId}|${slotStartUtc}|${slotEndUtc}`;
        const pending = await convex.mutation(api.bookings.createPending, {
          instructorId: instructorId as Id<"instructors">,
          startUtc: slotStartUtc,
          endUtc: slotEndUtc,
          timezone,
          studentEmail: sessionEmail ?? "",
          studentName,
          idempotencyKey,
          createdByUserId: userId,
        });
        if (pending?.conflict) {
          results.push({ weekOffset: i, status: "skipped", reason: "Slot already booked" });
          continue;
        }

        let didConfirm = false;
        try {
          const insert = await calendar.events.insert({
            calendarId: eventCalendarId,
            sendUpdates: "all",
            requestBody: {
              summary: `Session with ${studentName}`,
              description: instructor.discordVoiceChannelUrl
                ? [`Join Discord voice: ${instructor.discordVoiceChannelUrl}`, "", "Join this voice channel at the session start time."].join("\n")
                : undefined,
              location: instructor.discordVoiceChannelUrl || undefined,
              start: { dateTime: new Date(slotStartUtc).toISOString(), timeZone: timezone },
              end: { dateTime: new Date(slotEndUtc).toISOString(), timeZone: timezone },
              attendees: sessionEmail ? [{ email: sessionEmail }] : undefined,
              extendedProperties: { private: { idempotencyKey } },
            },
          });
          const googleEventId = insert.data.id;
          if (!googleEventId) {
            results.push({ weekOffset: i, status: "skipped", reason: "Failed to create calendar event" });
            // rollback
            try {
              await convex.mutation(api.bookings.cancel, { id: pending.bookingId });
            } catch {}
            continue;
          }

          const confirmed = await convex.mutation(api.bookings.confirm, {
            id: pending.bookingId,
            eventCalendarId,
            googleEventId,
          });
          didConfirm = true;
          createdTimes.push(confirmed.startUtc);
          results.push({ weekOffset: i, status: "created", bookingId: String(confirmed._id) });
        } catch (e) {
          console.error("Google Calendar insert error (series):", e);
          results.push({ weekOffset: i, status: "skipped", reason: "Calendar provider error" });
        } finally {
          if (!didConfirm) {
            try {
              await convex.mutation(api.bookings.cancel, { id: pending.bookingId });
            } catch (rollbackErr) {
              console.error("Rollback failed for api.bookings.cancel", { bookingId: pending.bookingId, error: rollbackErr });
            }
          }
        }
      } catch (err) {
        console.error("Series iteration failed:", err);
        results.push({ weekOffset: i, status: "skipped", reason: "Unexpected error" });
      }
    }

    const created = results.filter((r) => r.status === "created").length;
    const skipped = results.length - created;

    // Send single summary emails (student + instructor)
    try {
      const timesUtc = [baseStartMs, ...createdTimes].sort((a, b) => a - b);
      const summary = buildSeriesSummaryEmails({
        studentName,
        studentEmail: sessionEmail || "",
        instructorName: instructor.name || null,
        instructorEmail: (instructor as any).email || null,
        timesUtc,
        studentTimeZone: timezone,
        instructorTimeZone: instructor.timeZone || null,
        skippedCount: skipped,
      });
      if (sessionEmail) {
        await sendEmail({ to: sessionEmail, subject: summary.student.subject, text: summary.student.text, headers: summary.student.headers });
      }
      if (instructor.email) {
        await sendEmail({ to: instructor.email, subject: summary.instructor.subject, text: summary.instructor.text, headers: summary.instructor.headers });
      }
    } catch (e) {
      console.error("Failed to send series summary emails:", e);
    }

    return NextResponse.json({ success: true, created, skipped, results });
  } catch (error) {
    console.error("Booking series error:", error);
    return NextResponse.json({ error: "Failed to create booking series" }, { status: 500 });
  }
}
