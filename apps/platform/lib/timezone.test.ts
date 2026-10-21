import { describe, expect, it } from "vitest";
import {
  addDays,
  addMinutes,
  getLocalDateTime,
  isValidTimeZone,
  isSlotWithinStudentLocalHours,
  localDateTimeToUtcMillis,
  addWeeksInTimeZone,
  rankSlotsForTwoParties,
  formatSlotLabel,
  utcMillisToIsoString,
  formatUtcMillisForDateTimeLocal,
  parseDateTimeLocalToUtcMillis,
  STUDENT_LOCAL_OK_HOURS_START,
  STUDENT_LOCAL_OK_HOURS_END,
} from "./timezone";

describe("timezone helpers", () => {
  describe("getLocalDateTime", () => {
    it("returns local calendar components in the target timezone", () => {
      const date = new Date("2026-07-15T18:00:00Z");
      const local = getLocalDateTime(date, "America/New_York");
      // 18:00 UTC is 14:00 EDT (UTC-4) in July
      expect(local.year).toBe(2026);
      expect(local.month).toBe(7);
      expect(local.day).toBe(15);
      expect(local.hour).toBe(14);
      expect(local.minute).toBe(0);
      expect(local.second).toBe(0);
    });
  });

  describe("addDays", () => {
    it("adds days to local date components", () => {
      const local = { year: 2026, month: 7, day: 15, hour: 14, minute: 0, second: 0 };
      const result = addDays(local, 7);
      expect(result).toEqual({
        year: 2026,
        month: 7,
        day: 22,
        hour: 14,
        minute: 0,
        second: 0,
      });
    });

    it("normalizes month rollovers", () => {
      const local = { year: 2026, month: 1, day: 31, hour: 10, minute: 0, second: 0 };
      const result = addDays(local, 1);
      expect(result).toEqual({
        year: 2026,
        month: 2,
        day: 1,
        hour: 10,
        minute: 0,
        second: 0,
      });
    });
  });

  describe("addMinutes", () => {
    it("adds minutes to local time components", () => {
      const local = { year: 2026, month: 7, day: 15, hour: 14, minute: 0, second: 0 };
      const result = addMinutes(local, 60);
      expect(result).toEqual({
        year: 2026,
        month: 7,
        day: 15,
        hour: 15,
        minute: 0,
        second: 0,
      });
    });
  });

  describe("isValidTimeZone", () => {
    it("returns true for valid IANA timezones", () => {
      expect(isValidTimeZone("America/New_York")).toBe(true);
      expect(isValidTimeZone("UTC")).toBe(true);
      expect(isValidTimeZone("Europe/London")).toBe(true);
    });

    it("returns false for invalid timezone strings", () => {
      expect(isValidTimeZone("NotAZone")).toBe(false);
      expect(isValidTimeZone("")).toBe(false);
    });
  });

  describe("localDateTimeToUtcMillis", () => {
    it("converts a local wall time back to the correct UTC instant", () => {
      const local = { year: 2026, month: 7, day: 15, hour: 14, minute: 0, second: 0 };
      const millis = localDateTimeToUtcMillis(local, "America/New_York");
      expect(millis).toBe(new Date("2026-07-15T18:00:00Z").getTime());
    });

    it("preserves the same local time across a DST fall-back boundary", () => {
      // DST ends in NY on 2026-11-01 at 2am. 2026-11-08 00:30 is EST (UTC-5).
      const local = { year: 2026, month: 11, day: 8, hour: 0, minute: 30, second: 0 };
      const millis = localDateTimeToUtcMillis(local, "America/New_York");
      expect(millis).toBe(new Date("2026-11-08T05:30:00Z").getTime());
      // Verify round-trip
      expect(millis).not.toBeNull();
      const roundTripped = getLocalDateTime(new Date(millis as number), "America/New_York");
      expect(roundTripped).toEqual(local);
    });

    it("returns null for a nonexistent spring-forward DST wall time", () => {
      // DST starts in NY on 2026-03-08 at 2am; clocks jump to 3am. 02:30 does not exist.
      const local = { year: 2026, month: 3, day: 8, hour: 2, minute: 30, second: 0 };
      const millis = localDateTimeToUtcMillis(local, "America/New_York");
      expect(millis).toBeNull();
    });
  });

  describe("addWeeksInTimeZone", () => {
    it("keeps the same local time after a DST transition", () => {
      // 2026-10-25 15:00 EDT (UTC-4)
      const start = "2026-10-25T19:00:00Z";
      const week1 = addWeeksInTimeZone(start, "America/New_York", 1);
      expect(week1).not.toBeNull();

      // The local time one week later should still be 15:00, but now EST (UTC-5)
      const local = getLocalDateTime(new Date(week1 as number), "America/New_York");
      expect(local).toEqual({
        year: 2026,
        month: 11,
        day: 1,
        hour: 15,
        minute: 0,
        second: 0,
      });
    });

    it("does not match the naive millisecond add when DST changes", () => {
      const start = "2026-10-25T19:00:00Z";
      const dstAware = addWeeksInTimeZone(start, "America/New_York", 1);
      expect(dstAware).not.toBeNull();
      const naive = new Date(start).getTime() + 7 * 24 * 60 * 60 * 1000;
      // DST-aware result should be 1 hour later in UTC because the offset
      // increased by 1 hour when clocks fell back (same local time = later UTC).
      expect(dstAware).toBe(naive + 60 * 60 * 1000);
    });

    it("returns null when the target local time falls in a DST gap", () => {
      // 2026-03-01 02:30 EST (UTC-5) is valid. Adding 7 days lands on
      // 2026-03-08 02:30, which is in the spring-forward gap.
      const start = "2026-03-01T07:30:00Z";
      const week1 = addWeeksInTimeZone(start, "America/New_York", 1);
      expect(week1).toBeNull();
    });
  });

  describe("utcMillisToIsoString", () => {
    it("returns an ISO string", () => {
      const millis = new Date("2026-07-15T18:00:00Z").getTime();
      expect(utcMillisToIsoString(millis)).toBe("2026-07-15T18:00:00.000Z");
    });
  });

  describe("formatUtcMillisForDateTimeLocal", () => {
    it("formats a UTC instant in the target timezone", () => {
      const millis = new Date("2026-07-15T18:00:00Z").getTime();
      // 18:00 UTC is 14:00 EDT (UTC-4) in July
      expect(formatUtcMillisForDateTimeLocal("America/New_York", millis)).toBe(
        "2026-07-15T14:00"
      );
    });

    it("pads single-digit months, days, hours, and minutes", () => {
      const millis = new Date("2026-01-02T05:06:00Z").getTime();
      expect(formatUtcMillisForDateTimeLocal("UTC", millis)).toBe("2026-01-02T05:06");
    });
  });

  describe("parseDateTimeLocalToUtcMillis", () => {
    it("converts a datetime-local value in the target timezone to UTC millis", () => {
      const millis = parseDateTimeLocalToUtcMillis("America/New_York", "2026-07-15T14:00");
      expect(millis).toBe(new Date("2026-07-15T18:00:00Z").getTime());
    });

    it("round-trips with formatUtcMillisForDateTimeLocal", () => {
      const original = new Date("2026-07-15T18:00:00Z").getTime();
      const formatted = formatUtcMillisForDateTimeLocal("America/New_York", original);
      const parsed = parseDateTimeLocalToUtcMillis("America/New_York", formatted);
      expect(parsed).toBe(original);
    });

    it("returns null for a nonexistent spring-forward DST wall time", () => {
      const millis = parseDateTimeLocalToUtcMillis("America/New_York", "2026-03-08T02:30");
      expect(millis).toBeNull();
    });

    it("returns null for malformed input", () => {
      expect(parseDateTimeLocalToUtcMillis("America/New_York", "not-a-date")).toBeNull();
      expect(parseDateTimeLocalToUtcMillis("America/New_York", "2026-07-15")).toBeNull();
      expect(parseDateTimeLocalToUtcMillis("America/New_York", "")).toBeNull();
    });
  });

  describe("availability preview two-sided filter helpers", () => {
    it("exposes the 8am-10pm student window as a constant", () => {
      // These constants are the v1 product policy. Changing them is a
      // deliberate policy decision, not a refactor — keep the test loud
      // so a silent edit is impossible to miss.
      expect(STUDENT_LOCAL_OK_HOURS_START).toBe(8);
      expect(STUDENT_LOCAL_OK_HOURS_END).toBe(22);
    });

    it("isSlotWithinStudentLocalHours: accepts mid-morning in Asia/Singapore", () => {
      // 03:00 UTC on 2026-03-15 is 11:00 SGT. Within the window.
      const iso = "2026-03-15T03:00:00.000Z";
      expect(isSlotWithinStudentLocalHours(iso, "Asia/Singapore")).toBe(true);
    });

    it("isSlotWithinStudentLocalHours: rejects 03:00 SGT (=19:00 UTC prev day)", () => {
      // 03:00 SGT = 19:00 UTC of the prior day. Outside the 8-22 window.
      const iso = "2026-03-14T19:00:00.000Z";
      expect(isSlotWithinStudentLocalHours(iso, "Asia/Singapore")).toBe(false);
    });

    it("isSlotWithinStudentLocalHours: rejects 23:00 SGT (=15:00 UTC)", () => {
      const iso = "2026-03-15T15:00:00.000Z";
      expect(isSlotWithinStudentLocalHours(iso, "Asia/Singapore")).toBe(false);
    });

    it("isSlotWithinStudentLocalHours: returns true when student zone is missing", () => {
      const iso = "2026-03-15T03:00:00.000Z";
      expect(isSlotWithinStudentLocalHours(iso, null)).toBe(true);
      expect(isSlotWithinStudentLocalHours(iso, undefined)).toBe(true);
    });

    it("isSlotWithinStudentLocalHours: returns true for an unrecognised zone (fail-open)", () => {
      // The route handler validates upstream, so by the time we get here the
      // zone should be valid. We choose fail-open behaviour defensively
      // so an exotic or nullish value never produces an unbookable UI.
      expect(isSlotWithinStudentLocalHours("2026-03-15T03:00:00.000Z", "NotAZone")).toBe(true);
    });

    it("rankSlotsForTwoParties: reorders so mid-day in the student zone comes first", () => {
      // Three candidate instants, all on a single date, that translate to
      // 06:00, 12:00, 19:00 in Asia/Singapore. Cold `UTC` instructor zone
      // makes the UTC hour map trivially. The student distance alone
      // decides the order:
      //   04:00Z → 12:00 SGT, student sq 0   — first
      //   22:00Z → 06:00 SGT, student sq 36  — second (closer to noon than 19:00)
      //   11:00Z → 19:00 SGT, student sq 49  — third
      const slots = [
        "2026-03-15T11:00:00.000Z",
        "2026-03-15T04:00:00.000Z",
        "2026-03-15T22:00:00.000Z",
      ];
      const ordered = rankSlotsForTwoParties(slots, "Asia/Singapore", "UTC");
      expect(ordered).toEqual([
        "2026-03-15T04:00:00.000Z",
        "2026-03-15T22:00:00.000Z",
        "2026-03-15T11:00:00.000Z",
      ]);
    });

    it("rankSlotsForTwoParties: student distance wins over instructor distance (Greptile P1 #2)", () => {
      // Reproduce the exact scenario Greptile flagged in their review.
      // Instructor in Los Angeles (PDT, UTC-7) and student in Singapore
      // (SGT, UTC+8). Both slots pass the student-hours window (8–22
      // local), but the 04:00Z candidate is the student's ideal noon slot.
      // The 02:00Z candidate is closer to the instructor's mid-day, so the
      // old weighted-sum ranker picked 02:00Z. The lex sort must pick
      // 04:00Z.
      //   02:00Z → 10:00 SGT (sq 4) + 19:00 PDT (sq 49, weighted 12.25)  = 16.25 (old winner)
      //   04:00Z → 12:00 SGT (sq 0) + 21:00 PDT (sq 81, weighted 20.25) = 20.25 (old loser)
      const slots = [
        "2026-04-06T02:00:00.000Z",
        "2026-04-06T04:00:00.000Z",
      ];
      const ordered = rankSlotsForTwoParties(
        slots,
        "Asia/Singapore",
        "America/Los_Angeles"
      );
      expect(ordered).toEqual([
        "2026-04-06T04:00:00.000Z", // student noon
        "2026-04-06T02:00:00.000Z", // not as good for the student
      ]);
    });

    it("rankSlotsForTwoParties: instructor distance tiebreaks when student distances tie", () => {
      // Three candidate instants that all translate to 12:00 in
      // Asia/Singapore — they all have student sq 0, so the sort must
      // fall through to the instructor distance for ordering. The
      // instructor zone is "UTC" so the UTC hour maps directly.
      //   04:00Z → 12:00 UTC (sq 0)   — best instructor slot
      //   05:00Z → 13:00 UTC (sq 1)   — next
      //   03:00Z → 11:00 UTC (sq 1)   — ties with hour-04; tx to 11 vs 13:
      //   actually 03:00Z = 11:00 UTC, delta=-1, sq=1. 05:00Z = 13:00 UTC,
      //   delta=+1, sq=1. Both squred to 1. Stable sort keeps them in
      //   input order: 03:00Z before 05:00Z. So assert an order where
      //   04:00Z is first and the other two follow in input-order.
      const slots = [
        "2026-04-06T05:00:00.000Z",
        "2026-04-06T04:00:00.000Z",
        "2026-04-06T03:00:00.000Z",
      ];
      const ordered = rankSlotsForTwoParties(
        slots,
        "Asia/Singapore",
        "UTC"
      );
      // 04:00Z wins outright (student sq 0, instructor sq 0).
      expect(ordered[0]).toBe("2026-04-06T04:00:00.000Z");
      // 03:00Z and 05:00Z both have student sq 0 and instructor sq 1.
      // Stable sort keeps them in input order.
      expect(ordered.slice(1)).toEqual([
        "2026-04-06T05:00:00.000Z",
        "2026-04-06T03:00:00.000Z",
      ]);
    });

    it("rankSlotsForTwoParties: returns the original order when no zones are supplied", () => {
      const slots = ["2026-03-15T04:00:00.000Z", "2026-03-15T11:00:00.000Z"];
      const ordered = rankSlotsForTwoParties(slots, null, null);
      expect(ordered).toEqual(slots);
    });

    it("rankSlotsForTwoParties: does not mutate the input array", () => {
      const slots = ["2026-03-15T11:00:00.000Z", "2026-03-15T04:00:00.000Z"];
      const original = [...slots];
      rankSlotsForTwoParties(slots, "Asia/Singapore", "UTC");
      expect(slots).toEqual(original);
    });

    it("formatSlotLabel: returns null for malformed input", () => {
      expect(formatSlotLabel("not-an-iso", "UTC")).toBeNull();
      expect(formatSlotLabel("", "UTC")).toBeNull();
    });

    it("formatSlotLabel: rounds to local wall time in the requested zone", () => {
      // 18:00 UTC on 2026-07-15 = 11:00 PDT (Pacific Daylight Time, UTC-7).
      const iso = "2026-07-15T18:00:00.000Z";
      const label = formatSlotLabel(iso, "America/Los_Angeles");
      expect(label).not.toBeNull();
      expect(label).toContain("11:00");
      expect(label?.toLowerCase()).toMatch(/pdt|pst/);
    });
  });
});
