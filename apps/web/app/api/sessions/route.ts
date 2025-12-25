import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  and,
  db,
  eq,
  getMentorById,
  decryptMentorRefreshToken,
  getSessionPackById,
  sessions,
  validateBookingEligibility,
} from "@mentorships/db";
import { requireDbUser } from "@/lib/auth";
import { getGoogleCalendarClient } from "@/lib/google";
import {
  forbidden,
  notFound,
  validationError,
  conflict,
  schedulingError,
  createApiSuccess,
  internalError,
} from "@/lib/api-error";

const SESSION_DURATION_MINUTES = 60;

type WorkingHoursInterval = { start: string; end: string };
type WorkingHours = Partial<Record<0 | 1 | 2 | 3 | 4 | 5 | 6, WorkingHoursInterval[]>>;

const weekdayMap: Record<string, 0 | 1 | 2 | 3 | 4 | 5 | 6> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function parseHHMM(value: string): number | null {
  const m = value.match(/^(\d{2}):(\d{2})$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isInteger(hh) || !Number.isInteger(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

function getLocalWeekdayAndMinutes(
  date: Date,
  timeZone: string
): { day: 0 | 1 | 2 | 3 | 4 | 5 | 6; minutes: number } | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(date);

    const weekday = parts.find((p) => p.type === "weekday")?.value;
    const hour = parts.find((p) => p.type === "hour")?.value;
    const minute = parts.find((p) => p.type === "minute")?.value;
    if (!weekday || !hour || !minute) return null;
    const day = weekdayMap[weekday];
    if (day === undefined) return null;
    const hh = Number(hour);
    const mm = Number(minute);
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
    return { day, minutes: hh * 60 + mm };
  } catch {
    return null;
  }
}

function isWithinWorkingHours(
  slotStart: Date,
  slotEnd: Date,
  timeZone: string,
  workingHours: WorkingHours
): boolean {
  const localStart = getLocalWeekdayAndMinutes(slotStart, timeZone);
  const localEnd = getLocalWeekdayAndMinutes(slotEnd, timeZone);
  if (!localStart || !localEnd) return true; // fail-open
  if (localStart.day !== localEnd.day) return false; // don't allow slots spanning days

  const intervals = workingHours[localStart.day];
  if (!intervals || intervals.length === 0) return false;

  for (const i of intervals) {
    const startMin = parseHHMM(i.start);
    const endMin = parseHHMM(i.end);
    if (startMin === null || endMin === null) continue;
    if (endMin <= startMin) continue;
    if (localStart.minutes >= startMin && localEnd.minutes <= endMin) return true;
  }

  return false;
}

const createSessionSchema = z.object({
  sessionPackId: z.string().min(1, "sessionPackId is required"),
  scheduledAt: z.string().datetime(),
  recordingConsent: z.boolean().optional(),
});

function overlapsBusyWindow(
  start: Date,
  end: Date,
  busy: Array<{ start?: string | null; end?: string | null }>
): boolean {
  const startMs = start.getTime();
  const endMs = end.getTime();

  for (const b of busy) {
    if (!b.start || !b.end) continue;
    const bStart = new Date(b.start).getTime();
    const bEnd = new Date(b.end).getTime();
    // overlap if ranges intersect
    if (startMs < bEnd && endMs > bStart) return true;
  }

  return false;
}

/**
 * POST /api/sessions
 *
 * Books a session by:
 * 1) validating pack/seat eligibility
 * 2) re-checking mentor's Google Calendar free/busy
 * 3) creating a Google Calendar event
 * 4) inserting a session row with googleCalendarEventId (idempotency)
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const user = await requireDbUser();

    if (user.role !== "student") {
      const { response: errorResponse } = forbidden("Student role required");
      return NextResponse.json(errorResponse, { status: 403 });
    }

    const body = await req.json();
    const parsed = createSessionSchema.safeParse(body);
    if (!parsed.success) {
      const { response: errorResponse } = validationError(
        "Invalid request", 
        parsed.error.issues
      );
      return NextResponse.json(errorResponse, { status: 400 });
    }

    const { sessionPackId, scheduledAt, recordingConsent } = parsed.data;

    const pack = await getSessionPackById(sessionPackId);
    if (!pack || pack.userId !== user.id) {
      const { response: errorResponse } = notFound("Session pack");
      return NextResponse.json(errorResponse, { status: 404 });
    }

    const start = new Date(scheduledAt);
    const end = new Date(start.getTime() + SESSION_DURATION_MINUTES * 60 * 1000);

    const eligibility = await validateBookingEligibility(sessionPackId, user.id, start);
    if (!eligibility.valid) {
      const { response: errorResponse } = schedulingError(eligibility.error);
      return NextResponse.json(errorResponse, { status: 400 });
    }

    // Fast idempotency: if the exact session already exists, return it.
    const [existing] = await db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.studentId, user.id),
          eq(sessions.sessionPackId, sessionPackId),
          eq(sessions.scheduledAt, start),
          eq(sessions.status, "scheduled")
        )
      )
      .limit(1);

    if (existing) {
      return NextResponse.json(
        createApiSuccess({ session: existing }, "Session already exists")
      );
    }

    const mentor = await getMentorById(pack.mentorId);
    if (!mentor) {
      const { response: errorResponse } = notFound("Mentor");
      return NextResponse.json(errorResponse, { status: 404 });
    }
    const refreshToken = decryptMentorRefreshToken(mentor);
    if (!refreshToken) {
      const { response: errorResponse } = schedulingError(
        "Mentor has not connected Google Calendar"
      );
      return NextResponse.json(errorResponse, { status: 409 });
    }

    const calendarId = mentor.googleCalendarId || "primary";
    const calendar = await getGoogleCalendarClient(refreshToken);

    // Enforce working-hours constraints server-side as well (not just in slot UI).
    if (mentor.timeZone && mentor.workingHours) {
      if (
        !isWithinWorkingHours(
          start,
          end,
          mentor.timeZone,
          mentor.workingHours as WorkingHours
        )
      ) {
        const { response: errorResponse } = schedulingError(
          "Selected time is outside mentor working hours"
        );
        return NextResponse.json(errorResponse, { status: 400 });
      }
    }

    // Re-check availability at booking time (prevents stale UI)
    const fb = await calendar.freebusy.query({
      requestBody: {
        timeMin: start.toISOString(),
        timeMax: end.toISOString(),
        items: [{ id: calendarId }],
      },
    });
    const busy = fb.data.calendars?.[calendarId]?.busy ?? [];

    if (overlapsBusyWindow(start, end, busy)) {
      const { response: errorResponse } = conflict(
        "Time slot is no longer available",
        { busy }
      );
      return NextResponse.json(errorResponse, { status: 409 });
    }

    // Create calendar event first, then insert DB session; cleanup event on DB failure.
    const event = await calendar.events.insert({
      calendarId,
      requestBody: {
        summary: "Mentorship session",
        description: `Mentorship session booking\nStudent: ${user.email}\nSession pack: ${sessionPackId}`,
        start: { dateTime: start.toISOString() },
        end: { dateTime: end.toISOString() },
        extendedProperties: {
          private: {
            session_pack_id: sessionPackId,
            student_id: user.id,
          },
        },
      },
    });

    const googleCalendarEventId = event.data.id;
    if (!googleCalendarEventId) {
      return NextResponse.json(
        { error: "Google Calendar did not return an event id" },
        { status: 502 }
      );
    }

    try {
      const [created] = await db
        .insert(sessions)
        .values({
          mentorId: mentor.id,
          studentId: user.id,
          sessionPackId,
          scheduledAt: start,
          status: "scheduled",
          recordingConsent: recordingConsent ?? false,
          googleCalendarEventId,
        })
        .returning();

      if (!created) {
        throw new Error("Failed to create session");
      }

      return NextResponse.json(
        createApiSuccess({ session: created }, "Session booked successfully")
      );
    } catch (dbError) {
      // Best-effort cleanup if DB insert fails
      try {
        await calendar.events.delete({ calendarId, eventId: googleCalendarEventId });
      } catch (cleanupError) {
        console.error("Failed to cleanup Google Calendar event:", cleanupError);
      }
      throw dbError;
    }
  } catch (error) {
    console.error("Create session booking error:", error);
    const { response: errorResponse } = internalError("Failed to book session");
    return NextResponse.json(errorResponse, { status: 500 });
  }
}

