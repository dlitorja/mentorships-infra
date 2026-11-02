import { describe, expect, it } from "vitest";

import {
  describeTimeZoneDifference,
  getTimeZoneOffsetMinutes,
} from "./timezones";

const WINTER = new Date("2026-01-15T12:00:00Z");

describe("getTimeZoneOffsetMinutes", () => {
  it("returns the UTC offset in minutes", () => {
    expect(getTimeZoneOffsetMinutes("UTC", WINTER)).toBe(0);
    expect(getTimeZoneOffsetMinutes("America/New_York", WINTER)).toBe(-300);
    expect(getTimeZoneOffsetMinutes("America/Chicago", WINTER)).toBe(-360);
    expect(getTimeZoneOffsetMinutes("Asia/Kolkata", WINTER)).toBe(330);
  });

  it("returns null for an unknown zone", () => {
    expect(getTimeZoneOffsetMinutes("Not/AZone", WINTER)).toBeNull();
  });
});

describe("describeTimeZoneDifference", () => {
  it("reports the same zone", () => {
    expect(
      describeTimeZoneDifference("America/Chicago", "America/Chicago", WINTER)
    ).toEqual({
      diffMinutes: 0,
      direction: "same",
      label: "Same timezone as you",
    });
  });

  it("reports a student behind the instructor", () => {
    expect(
      describeTimeZoneDifference("America/Chicago", "America/New_York", WINTER)
    ).toEqual({
      diffMinutes: -60,
      direction: "behind",
      label: "1 hour behind you",
    });
  });

  it("reports a student ahead of the instructor", () => {
    expect(
      describeTimeZoneDifference("Asia/Tokyo", "America/New_York", WINTER)
    ).toEqual({
      diffMinutes: 840,
      direction: "ahead",
      label: "14 hours ahead of you",
    });
  });

  it("handles half-hour offsets", () => {
    expect(
      describeTimeZoneDifference("Asia/Kolkata", "UTC", WINTER)
    ).toEqual({
      diffMinutes: 330,
      direction: "ahead",
      label: "5h 30m ahead of you",
    });
  });

  it("returns null when either zone is missing", () => {
    expect(describeTimeZoneDifference(null, "UTC", WINTER)).toBeNull();
    expect(describeTimeZoneDifference("UTC", undefined, WINTER)).toBeNull();
  });
});
