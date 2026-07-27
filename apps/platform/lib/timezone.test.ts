import { describe, expect, it } from "vitest";
import {
  addDays,
  addMinutes,
  getLocalDateTime,
  isValidTimeZone,
  localDateTimeToUtcMillis,
  addWeeksInTimeZone,
  utcMillisToIsoString,
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
});
