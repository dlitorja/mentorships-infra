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
import {
  addDays,
  getLocalDateTime,
  isValidTimeZone,
  localDateTimeToUtcMillis,
  utcMillisToIsoString,
} from "@/lib/timezone";
import type { bookingSeriesNotifications } from "../../../../../../src/trigger/booking-series-notifications";

const createSeriesSchema = z.object({
  instructorId: z.string().min(1),
  start: z.string().datetime(),
  timezone: z.string().min(1),
  weeks: z.coerce.number().int().min(1).max(3),
  studentName: z.string().min(1),
});

type ResultItem = { weekOffset: number; status: "created" | "skipped"; reason?: string; bookingId?: string };

/**
 * POST /api/bookings/series
 * Creates weekly follow-up bookings for N weeks (1-3) after initial booking.
 * Requires authenticated user. Checks free/busy for each slot, creates Google
 * Calendar events, confirms bookings. Skipped slots reported in response.
 * Triggers consolidated booking-series-notifications task with all times.
 * Note: All sessions are hardcoded to 60-minute duration.
 */
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

    const baseStartMs = new Date(start).getTime();
    if (!Number.isFinite(baseStartMs)) {
      return NextResponse.json({ error: "Invalid start" }, { status: 400 });
    }
    if (!isValidTimeZone(timezone)) {
      return NextResponse.json({ error: "Invalid timezone" }, { status: 400 });
    }

    // Decompose the base start into the target timezone so we can add weeks
    // while preserving the same local wall time across DST boundaries.
    const baseStartLocal = getLocalDateTime(new Date(start), timezone);
    const SESSION_DURATION_MS = 60 * 60 * 1000;

    const results: ResultItem[] = [];
    const createdTimes: number[] = [];

    for (let i = 1; i <= weeks; i++) {
      // Add i weeks to the local calendar components, then convert the local
      // wall time back to a UTC timestamp. This keeps 3pm as 3pm even when the
      // UTC offset changes due to DST. If the target wall time does not exist
      // (spring-forward gap), skip the slot. The end time is derived from the
      // resolved start plus the fixed 60-minute duration so a session that
      // crosses the fall-back DST window stays exactly 60 minutes instead of
      // resolving start/end independently and producing a 2-hour interval.
      const targetStartLocal = addDays(baseStartLocal, i * 7);
      const slotStartUtc = localDateTimeToUtcMillis(targetStartLocal, timezone);
      if (slotStartUtc === null) {
        results.push({ weekOffset: i, status: "skipped", reason: "Selected time does not exist due to DST" });
        continue;
      }
      const slotEndUtc = slotStartUtc + SESSION_DURATION_MS;

      try {
        // Freebusy check
        const fb = await calendar.freebusy.query({
          requestBody: {
            timeMin: utcMillisToIsoString(slotStartUtc),
            timeMax: utcMillisToIsoString(slotEndUtc),
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
        let insertedGoogleEventId: string | null = null;
        let cancelAlready = false;
        try {
          const insert = await calendar.events.insert({
            calendarId: eventCalendarId,
            sendUpdates: "all",
            requestBody: {
              summary: `Session with ${studentName}`,
              description: (() => {
                const lines: string[] = [];
                if (instructor.discordVoiceChannelUrl) {
                  lines.push(`Join Discord voice: ${instructor.discordVoiceChannelUrl}`);
                  lines.push("");
                  lines.push("Join this voice channel at the session start time.");
                  lines.push("");
                }
                lines.push(
                  "Need to cancel or reschedule? Contact your instructor in your workspace. Please try to inform them at least 24 hours in advance; instructors handle changes requested with less than 24 hours' notice at their discretion."
                );
                return lines.join("\n");
              })(),
              location: instructor.discordVoiceChannelUrl || undefined,
              start: { dateTime: utcMillisToIsoString(slotStartUtc), timeZone: timezone },
              end: { dateTime: utcMillisToIsoString(slotEndUtc), timeZone: timezone },
              attendees: sessionEmail ? [{ email: sessionEmail }] : undefined,
              extendedProperties: { private: { idempotencyKey } },
            },
          });
          insertedGoogleEventId = insert.data.id ?? null;
          if (!insertedGoogleEventId) {
            results.push({ weekOffset: i, status: "skipped", reason: "Failed to create calendar event" });
            // rollback
            try {
              await convex.mutation(api.bookings.cancel, { id: pending.bookingId });
            } catch (rollbackErr) {
              console.error("Rollback failed for api.bookings.cancel", { bookingId: pending.bookingId, error: rollbackErr });
            }
            cancelAlready = true;
            continue;
          }

          let confirmedBooking: any = null;
          try {
            confirmedBooking = await convex.mutation(api.bookings.confirm, {
              id: pending.bookingId,
              eventCalendarId,
              googleEventId: insertedGoogleEventId,
            });
            if (!confirmedBooking) {
              throw new Error("Confirm returned null");
            }
          } catch (confirmErr) {
            // Confirm is idempotent; a lost response may still have committed.
            // Resolve the ambiguity by checking the booking state.
            let existing = null;
            try {
              existing = await convex.query(api.bookings.getBookingById, {
                id: pending.bookingId as Id<"bookings">,
              });
            } catch (statusErr) {
              console.error("Failed to query booking status after confirm error:", statusErr);
            }
            if (existing && existing.status === "confirmed") {
              confirmedBooking = existing;
            } else {
              throw confirmErr;
            }
          }
          didConfirm = true;
          createdTimes.push(confirmedBooking.startUtc);
          results.push({ weekOffset: i, status: "created", bookingId: String(confirmedBooking._id) });
        } catch (e) {
          console.error("Booking creation failed for series slot:", e);
          results.push({ weekOffset: i, status: "skipped", reason: "Booking creation failed" });
        } finally {
          if (!didConfirm) {
            const eventIdToDelete = insertedGoogleEventId;
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
                console.error("Rollback failed for calendar.events.delete after retries:", {
                  eventId: insertedGoogleEventId,
                  error: deleteErr,
                });
                await reportError({
                  source: "api.bookings.series.rollback.calendarDelete",
                  error: deleteErr instanceof Error ? deleteErr : new Error(String(deleteErr)),
                  level: "error",
                  message: "Failed to delete orphaned calendar event after multiple retries",
                  context: { eventCalendarId, eventId: eventIdToDelete, bookingId: pending.bookingId },
                });
              }
            }
            if (!cancelAlready) {
              try {
                await withRetries(
                  () => convex.mutation(api.bookings.cancel, { id: pending.bookingId }),
                  3,
                  250
                );
              } catch (rollbackErr) {
                console.error("Rollback failed for api.bookings.cancel after retries:", {
                  bookingId: pending.bookingId,
                  error: rollbackErr,
                });
                await reportError({
                  source: "api.bookings.series.rollback.cancel",
                  error: rollbackErr instanceof Error ? rollbackErr : new Error(String(rollbackErr)),
                  level: "error",
                  message: "Failed to cancel pending booking after multiple retries",
                  context: { bookingId: pending.bookingId },
                });
              }
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

    // Trigger consolidated summary emails (student + instructor) via Trigger.dev task
    try {
      const timesUtc = [baseStartMs, ...createdTimes].sort((a, b) => a - b);
      await tasks.trigger<typeof bookingSeriesNotifications>("booking-series-notifications", {
        studentEmail: sessionEmail || null,
        instructorEmail: instructor.email || null,
        studentName,
        instructorName: instructor.name || null,
        timesUtc,
        studentTimeZone: timezone,
        instructorTimeZone: instructor.timeZone || null,
        skippedCount: skipped,
      });
    } catch (e) {
      console.error("Failed to trigger booking-series-notifications task:", e);
    }

    return NextResponse.json({ success: true, created, skipped, results });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Booking series error:", error);
    return NextResponse.json({ error: "Failed to create booking series" }, { status: 500 });
  }
}
