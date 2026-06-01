import { NextRequest, NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { getConvexClient } from "@/lib/convex";
import { Id } from "@/convex/_generated/dataModel";
import { getGoogleCalendarClient } from "@/lib/google";
import { decryptInstructorRefreshToken } from "@/lib/crypto";

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

function isWithinWorkingHours(slotStart: Date, slotMinutes: number, timeZone: string, workingHours: WorkingHours): boolean {
  const local = getLocalWeekdayAndMinutes(slotStart, timeZone);
  if (!local) return true;

  const intervals = workingHours[local.day];
  if (!intervals || intervals.length === 0) return false;

  const slotEndMinutes = local.minutes + slotMinutes;

  for (const i of intervals) {
    const startMin = parseHHMM(i.start);
    const endMin = parseHHMM(i.end);
    if (startMin === null || endMin === null) continue;
    if (endMin <= startMin) continue;
    if (local.minutes >= startMin && slotEndMinutes <= endMin) return true;
  }

  return false;
}

function ceilToSlot(date: Date, slotMinutes: number): Date {
  const ms = date.getTime();
  const slotMs = slotMinutes * 60 * 1000;
  const next = Math.ceil(ms / slotMs) * slotMs;
  return new Date(next);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ instructorId: string }> }
): Promise<NextResponse> {
  try {
    const { instructorId } = await params;
    if (!instructorId) {
      return NextResponse.json({ error: "Instructor ID is required" }, { status: 400 });
    }

    const convex = getConvexClient();

    const { searchParams } = new URL(request.url);

    const parsedSlots = parseInt(searchParams.get("slots") ?? "3", 10);
    const parsedDays = parseInt(searchParams.get("days") ?? "14", 10);

    const defaultSlots = 3;
    const defaultDays = 14;
    const maxSlots = 10;
    const maxDays = 30;

    const slotsToReturn = Number.isFinite(parsedSlots) && parsedSlots > 0
      ? Math.min(parsedSlots, maxSlots)
      : defaultSlots;
    const rangeDays = Number.isFinite(parsedDays) && parsedDays > 0
      ? Math.min(parsedDays, maxDays)
      : defaultDays;

    const instructor = await convex.query(api.instructors.getInstructorById, {
      id: instructorId as Id<"instructors">,
    });

    if (!instructor) {
      return NextResponse.json({ error: "Instructor not found" }, { status: 404 });
    }

    const refreshToken = decryptInstructorRefreshToken(instructor);
    if (!refreshToken) {
      return NextResponse.json({
        connected: false,
        slots: [],
        message: "Instructor calendar not connected"
      });
    }

    const calendar = await getGoogleCalendarClient(refreshToken);
    const googleAvailabilityCalendarIds = instructor.googleAvailabilityCalendarIds;
    const calendarIds: string[] = Array.isArray(googleAvailabilityCalendarIds) && googleAvailabilityCalendarIds.length > 0
      ? googleAvailabilityCalendarIds
      : [instructor.googleCalendarId || "primary"];

    const start = ceilToSlot(new Date(), 60);
    const end = new Date(start.getTime() + rangeDays * 24 * 60 * 60 * 1000);

    const fb = await calendar.freebusy.query({
      requestBody: {
        timeMin: start.toISOString(),
        timeMax: end.toISOString(),
        items: calendarIds.map((id) => ({ id })),
      },
    });

    const calendarsBusy = (fb.data.calendars || {}) as Record<string, any>;
    const busyWindows = calendarIds.flatMap((id) =>
      Array.isArray(calendarsBusy[id]?.busy) ? calendarsBusy[id]!.busy : []
    );
    const normalizedBusy = normalizeBusyWindows(busyWindows);
    const slotMs = 60 * 60 * 1000;

    const availableSlots: string[] = [];
    let cursor = start;
    const endLimitMs = end.getTime();

    let busyIdx = 0;
    while (cursor.getTime() + slotMs <= endLimitMs && availableSlots.length < slotsToReturn) {
      const slotStartMs = cursor.getTime();
      const slotEndMs = slotStartMs + slotMs;

      while (busyIdx < normalizedBusy.length && normalizedBusy[busyIdx]!.endMs <= slotStartMs) {
        busyIdx += 1;
      }

      const currentBusy = normalizedBusy[busyIdx];
      const overlaps = currentBusy
        ? slotStartMs < currentBusy.endMs && slotEndMs > currentBusy.startMs
        : false;

      if (!overlaps) {
        const withinWorkingHours = !instructor.timeZone || !instructor.workingHours
          ? true
          : isWithinWorkingHours(cursor, 60, instructor.timeZone, instructor.workingHours as WorkingHours);

        if (withinWorkingHours) {
          availableSlots.push(cursor.toISOString());
        }
      }

      cursor = new Date(slotStartMs + slotMs);
    }

    return NextResponse.json({
      connected: true,
      instructorTimeZone: instructor.timeZone ?? null,
      slots: availableSlots,
    });
  } catch (error) {
    console.error("Instructor availability preview error:", error);
    return NextResponse.json({ error: "Failed to fetch availability" }, { status: 500 });
  }
}