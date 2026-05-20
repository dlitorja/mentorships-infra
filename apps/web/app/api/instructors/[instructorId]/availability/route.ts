import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import { getConvexClient } from "@/lib/convex";
import { Id } from "@/convex/_generated/dataModel";
import { getGoogleCalendarClient } from "@/lib/google";
import { decryptInstructorRefreshToken } from "@/lib/crypto";

const querySchema = z.object({
  start: z.string().datetime(),
  end: z.string().datetime(),
  slotMinutes: z.coerce.number().int().min(15).max(180).optional(),
});

type BusyWindow = { start?: string | null; end?: string | null };

type WorkingHoursInterval = { start: string; end: string };
type WorkingHours = Partial<Record<0 | 1 | 2 | 3 | 4 | 5 | 6, WorkingHoursInterval[]>>;

function normalizeBusyWindows(busy: BusyWindow[]): Array<{ startMs: number; endMs: number }> {
  const intervals = busy
    .map((b) => {
      if (!b.start || !b.end) return null;
      const startMs = new Date(b.start).getTime();
      const endMs = new Date(b.end).getTime();
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
      if (endMs <= startMs) return null;
      return { startMs, endMs };
    })
    .filter((x): x is { startMs: number; endMs: number } => Boolean(x))
    .sort((a, b) => a.startMs - b.startMs);

  const merged: Array<{ startMs: number; endMs: number }> = [];
  for (const i of intervals) {
    const last = merged[merged.length - 1];
    if (!last) {
      merged.push(i);
      continue;
    }
    if (i.startMs <= last.endMs) {
      last.endMs = Math.max(last.endMs, i.endMs);
      continue;
    }
    merged.push(i);
  }

  return merged;
}

const weekdayMap: Record<string, 0 | 1 | 2 | 3 | 4 | 5 | 6> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
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

function getLocalWeekdayAndMinutes(date: Date, timeZone: string): { day: 0 | 1 | 2 | 3 | 4 | 5 | 6; minutes: number } | null {
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

function isWithinWorkingHours(slotStart: Date, timeZone: string, workingHours: WorkingHours): boolean {
  const local = getLocalWeekdayAndMinutes(slotStart, timeZone);
  if (!local) return true;

  const intervals = workingHours[local.day];
  if (!intervals || intervals.length === 0) return false;

  for (const i of intervals) {
    const startMin = parseHHMM(i.start);
    const endMin = parseHHMM(i.end);
    if (startMin === null || endMin === null) continue;
    if (endMin <= startMin) continue;
    if (local.minutes >= startMin && local.minutes < endMin) return true;
  }

  return false;
}

function ceilToSlot(date: Date, slotMinutes: number): Date {
  const ms = date.getTime();
  const slotMs = slotMinutes * 60 * 1000;
  const next = Math.ceil(ms / slotMs) * slotMs;
  return new Date(next);
}

/**
 * GET /api/instructors/:instructorId/availability?start=...&end=...
 *
 * Returns Google Calendar free/busy windows for the instructor.
 * Google Calendar is the source of truth for availability.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ instructorId: string }> }
): Promise<NextResponse> {
  try {
    const { instructorId } = await params;
    if (!instructorId) {
      return NextResponse.json(
        { error: "Instructor ID is required" },
        { status: 400 }
      );
    }

    const convex = getConvexClient();

    const { searchParams } = new URL(request.url);
    const parsed = querySchema.safeParse({
      start: searchParams.get("start"),
      end: searchParams.get("end"),
      slotMinutes: searchParams.get("slotMinutes"),
    });

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid query", details: parsed.error.issues },
        { status: 400 }
      );
    }

    const start = new Date(parsed.data.start);
    const end = new Date(parsed.data.end);
    const slotMinutes = parsed.data.slotMinutes ?? 60;
    if (!(start < end)) {
      return NextResponse.json(
        { error: "start must be before end" },
        { status: 400 }
      );
    }

    const MAX_RANGE_MS = 31 * 24 * 60 * 60 * 1000;
    if (end.getTime() - start.getTime() > MAX_RANGE_MS) {
      return NextResponse.json(
        { error: "Date range too large (max 31 days)" },
        { status: 400 }
      );
    }

    const instructor = await convex.query(api.instructors.getInstructorById, {
      id: instructorId as Id<"instructors">,
    });

    if (!instructor) {
      return NextResponse.json({ error: "Instructor not found" }, { status: 404 });
    }

    const refreshToken = decryptInstructorRefreshToken(instructor);
    if (!refreshToken) {
      return NextResponse.json(
        { error: "Instructor has not connected Google Calendar", code: "GOOGLE_CALENDAR_NOT_CONNECTED" },
        { status: 409 }
      );
    }

    const calendar = await getGoogleCalendarClient(refreshToken);
    const calendarIds: string[] = Array.isArray((instructor as any).googleAvailabilityCalendarIds) && (instructor as any).googleAvailabilityCalendarIds.length > 0
      ? (instructor as any).googleAvailabilityCalendarIds
      : [instructor.googleCalendarId || "primary"];

    const fb = await calendar.freebusy.query({
      requestBody: {
        timeMin: start.toISOString(),
        timeMax: end.toISOString(),
        items: calendarIds.map((id) => ({ id })),
      },
    });

    const calendarsBusy = (fb.data.calendars || {}) as Record<string, any>;
    const errored: string[] = [];
    for (const id of calendarIds) {
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

    const busyWindows = calendarIds.flatMap((id) => (Array.isArray(calendarsBusy[id]?.busy) ? calendarsBusy[id]!.busy : []));
    const normalizedBusy = normalizeBusyWindows(busyWindows);
    const slotMs = slotMinutes * 60 * 1000;

    const availableSlots: string[] = [];
    let cursor = ceilToSlot(start, slotMinutes);
    const endLimitMs = end.getTime();

    let busyIdx = 0;
    while (cursor.getTime() + slotMs <= endLimitMs) {
      const slotStartMs = cursor.getTime();
      const slotEndMs = slotStartMs + slotMs;

      while (busyIdx < normalizedBusy.length && normalizedBusy[busyIdx]!.endMs <= slotStartMs) {
        busyIdx += 1;
      }

      const currentBusy = normalizedBusy[busyIdx];
      const overlaps =
        currentBusy ? slotStartMs < currentBusy.endMs && slotEndMs > currentBusy.startMs : false;

      if (!overlaps) {
        if (
          instructor.timeZone &&
          instructor.workingHours &&
          isWithinWorkingHours(cursor, instructor.timeZone, instructor.workingHours as WorkingHours)
        ) {
          availableSlots.push(cursor.toISOString());
        } else if (!instructor.workingHours) {
          availableSlots.push(cursor.toISOString());
        } else if (!instructor.timeZone) {
          availableSlots.push(cursor.toISOString());
        }
        if (availableSlots.length >= 500) break;
      }

      cursor = new Date(slotStartMs + slotMs);
    }

    return NextResponse.json({
      success: true,
      instructorId: instructorId,
      calendarIds,
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      slotMinutes,
      busy: busyWindows,
      availableSlots,
      truncated: availableSlots.length >= 500,
      instructorTimeZone: instructor.timeZone ?? null,
      workingHoursConfigured: Boolean(instructor.workingHours),
    });
  } catch (error) {
    console.error("Instructor availability error:", error);
    return NextResponse.json(
      { error: "Failed to fetch instructor availability" },
      { status: 500 }
    );
  }
}
