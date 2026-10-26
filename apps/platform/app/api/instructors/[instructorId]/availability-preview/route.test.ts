import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";
import { makeRequest } from "tests/unit/api-route-utils";
import { getConvexClient } from "@/lib/convex";
import { getGoogleCalendarClient } from "@/lib/google";

vi.mock("@/lib/convex", () => ({
  getConvexClient: vi.fn(),
}));

vi.mock("@/lib/google", () => ({
  getGoogleCalendarClient: vi.fn(),
}));

vi.mock("@/lib/crypto", () => ({
  decryptInstructorRefreshToken: vi.fn(() => "decrypted_token"),
}));

vi.mock("@/lib/google-credentials", () => ({
  fetchInstructorGoogleCredentials: vi.fn(async () => ({
    googleRefreshToken: "encrypted_token",
    googleCalendarId: "primary",
    googleAvailabilityCalendarIds: [],
  })),
}));

const convexClient = {
  query: vi.fn(),
};

const calendarClient = {
  freebusy: {
    query: vi.fn(),
  },
};

const mockGetConvexClient = vi.mocked(getConvexClient);
const mockGetGoogleCalendarClient = vi.mocked(getGoogleCalendarClient);

// 2026-04-06 (Mon) at 08:00:00Z. Frozen so the slot generator starts at the
// next top-of-hour (08:00Z; ceilToSlot doesn't push past an already-aligned
// instant) and the candidate list is reproducible across machines. PDT is
// UTC-7 in April (DST is in effect).
const FROZEN_NOW_ISO = "2026-04-06T08:00:00.000Z";
const FROZEN_NOW_MS = new Date(FROZEN_NOW_ISO).getTime();

const instructor = {
  _id: "instructor_1",
  name: "Instructor Name",
  email: "instructor@example.com",
  googleCalendarId: "primary",
  googleAvailabilityCalendarIds: ["primary"],
  // The route's working-hours gate checks instructor-side hours. We set a
  // wide window so the gate is a non-factor and the request focuses on
  // the student-side filter.
  timeZone: "America/Los_Angeles",
  workingHours: {
    0: [{ start: "00:00", end: "23:59" }],
    1: [{ start: "00:00", end: "23:59" }],
    2: [{ start: "00:00", end: "23:59" }],
    3: [{ start: "00:00", end: "23:59" }],
    4: [{ start: "00:00", end: "23:59" }],
    5: [{ start: "00:00", end: "23:59" }],
    6: [{ start: "00:00", end: "23:59" }],
  },
};

function makeAvailabilityRequest({
  slots = 3,
  days = 14,
  studentTimeZone,
}: {
  slots?: number;
  days?: number;
  studentTimeZone?: string;
} = {}): NextRequest {
  const params = new URLSearchParams();
  if (slots !== undefined) params.set("slots", String(slots));
  if (days !== undefined) params.set("days", String(days));
  if (studentTimeZone !== undefined) params.set("studentTimeZone", studentTimeZone);
  return makeRequest({
    method: "GET",
    url: `https://platform.test/api/instructors/instructor_1/availability-preview?${params.toString()}`,
  });
}

describe("GET /api/instructors/[instructorId]/availability-preview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // Make `new Date()` (called inside the route handler) return a stable
    // frozen instant so the test isn't tied to wall-clock time.
    vi.setSystemTime(new Date(FROZEN_NOW_MS));
    // `getConvexClient` is a synchronous helper in `lib/convex.ts` — the
    // route calls it without `await`. Use `mockReturnValue` (sync) so
    // `convex.query(...)` resolves to a real function; `mockResolvedValue`
    // would return a Promise and the route would hit `.query on undefined`.
    mockGetConvexClient.mockReturnValue(convexClient as never);
    mockGetGoogleCalendarClient.mockReturnValue(calendarClient as never);
    convexClient.query.mockResolvedValue(instructor);
    calendarClient.freebusy.query.mockResolvedValue({
      data: { calendars: { primary: { busy: [] } } },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 400 when the supplied studentTimeZone is not an IANA zone", async () => {
    const response = await GET(
      makeAvailabilityRequest({ studentTimeZone: "NotAZone" }),
      { params: Promise.resolve({ instructorId: "instructor_1" }) }
    );
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toMatch(/studentTimeZone/i);
  });

  it("reorders by closeness-to-noon in the instructor zone when no student zone is supplied", async () => {
    // Default `slots=3` produces the next three top-of-hours after the
    // frozen `now` (08:00Z): 08:00Z, 09:00Z, 10:00Z. The rerank promotes
    // the slots whose *instructor-zone* start hour is closest to 12:00.
    // PDT is UTC-7 in April — so:
    //   08:00Z = 01:00 PDT (delta = -11 from noon)
    //   09:00Z = 02:00 PDT (delta = -10)
    //   10:00Z = 03:00 PDT (delta = -9)
    // The re-ordered set is therefore 10:00Z, 09:00Z, 08:00Z.
    const response = await GET(makeAvailabilityRequest(), {
      params: Promise.resolve({ instructorId: "instructor_1" }),
    });
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.connected).toBe(true);
    expect(json.studentTimeZone).toBeNull();
    expect(json.slots).toEqual([
      "2026-04-06T10:00:00.000Z",
      "2026-04-06T09:00:00.000Z",
      "2026-04-06T08:00:00.000Z",
    ]);
  });

  it("returns slots in chronological order when neither zone is supplied", async () => {
    // When the instructor has no time-zone set, the rerank is a no-op; we
    // document that explicitly so callers that opt out of zone-aware UX
    // (e.g. tests, embedded callouts) get a stable chronological list.
    convexClient.query.mockResolvedValueOnce({
      ...instructor,
      timeZone: undefined,
    });

    const response = await GET(makeAvailabilityRequest(), {
      params: Promise.resolve({ instructorId: "instructor_1" }),
    });
    expect(response.status).toBe(200);
    const json = await response.json();
    // Same set of instants as the rerank case, but in chronological order.
    expect(json.slots).toEqual([
      "2026-04-06T08:00:00.000Z",
      "2026-04-06T09:00:00.000Z",
      "2026-04-06T10:00:00.000Z",
    ]);
  });

  it("returns the studentTimeZone echoed back when accepted", async () => {
    const response = await GET(
      makeAvailabilityRequest({ studentTimeZone: "Asia/Singapore" }),
      { params: Promise.resolve({ instructorId: "instructor_1" }) }
    );
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.studentTimeZone).toBe("Asia/Singapore");
  });

  it("drops slots whose start hour in Asia/Singapore is outside 8am-10pm", async () => {
    // With frozen `now` at 08:00Z and full-day working hours, the loop
    // first surfaces 08:00Z, 09:00Z, 10:00Z. In SGT those are 16:00,
    // 17:00, 18:00 — all inside the 8–22 window. The filter is a
    // pass-through here and the result must contain three slots.
    const response = await GET(
      makeAvailabilityRequest({
        slots: 3,
        studentTimeZone: "Asia/Singapore",
      }),
      { params: Promise.resolve({ instructorId: "instructor_1" }) }
    );
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.connected).toBe(true);
    // Every slot must be within the SGT 8am-10pm window.
    for (const iso of json.slots) {
      // Each candidate starts at the top-of-hour. SGT = UTC+8.
      const utcHour = Number(iso.slice(11, 13));
      const sgtHour = (utcHour + 8) % 24;
      expect(sgtHour).toBeGreaterThanOrEqual(8);
      expect(sgtHour).toBeLessThan(22);
    }
    expect(json.slots.length).toBe(3);
  });

  it("advances past out-of-window instructor-side hits instead of returning early (Greptile P1 #1)", async () => {
    // For this test we freeze `now` at 21:00Z. With full-day working hours,
    // the loop's first three chronological candidates are 22:00Z, 23:00Z,
    // 00:00Z. In SGT those translate to:
    //   22:00Z → 06:00 SGT next day  — outside window (drop)
    //   23:00Z → 07:00 SGT next day  — outside window (drop)
    //   00:00Z → 08:00 SGT next day  — in window (push)
    //   01:00Z → 09:00 SGT next day  — in window (push)
    //   02:00Z → 10:00 SGT next day  — in window (push)
    //
    // Pre-fix: `availableSlots.length` increments on every instructor-side
    // hit, the loop terminates after 3 hits, and the post-loop filter drops
    // two of them — returning just one slot for a request that should
    // have produced three.
    //
    // Post-fix: the student-hours gate runs *inside* the loop, so the
    // first two candidates are silently skipped and the loop pushes
    // 00:00Z, 01:00Z, 02:00Z. Three slots come back.
    vi.setSystemTime(new Date("2026-04-06T21:00:00.000Z"));

    const response = await GET(
      makeAvailabilityRequest({
        slots: 3,
        studentTimeZone: "Asia/Singapore",
      }),
      { params: Promise.resolve({ instructorId: "instructor_1" }) }
    );
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.slots.length).toBe(3);
    // Each returned slot must be within the SGT 8–22 window.
    for (const iso of json.slots) {
      const utcHour = Number(iso.slice(11, 13));
      const sgtHour = (utcHour + 8) % 24;
      expect(sgtHour).toBeGreaterThanOrEqual(8);
      expect(sgtHour).toBeLessThan(22);
    }
  });
});
