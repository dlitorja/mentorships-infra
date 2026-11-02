/**
 * Shared IANA timezone helpers used by the student onboarding picker,
 * the instructor settings card, and the instructor-side comparison on
 * the onboarding review page.
 *
 * Keeping these in `lib/` (instead of inside a `"use client"` component)
 * lets server components and unit tests import them without pulling in
 * React.
 */

/**
 * Returns the auto-detected IANA zone, or `null` when the runtime
 * doesn't expose `Intl.DateTimeFormat()` (older browsers, exotic test
 * harnesses).
 */
export function detectClientTimezone(): string | null {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (typeof zone === "string" && zone.length > 0 && zone.length <= 64) {
      return zone;
    }
  } catch {
    // Some test environments polyfill Intl weirdly; fall through.
  }
  return null;
}

/**
 * Curated fallback list for runtimes that don't expose
 * `Intl.supportedValuesOf("timeZone")` (old browsers, locked-down
 * WebViews, some test harnesses). Covers major population centres and
 * uses the same IANA names the server-side validator accepts.
 */
export const FALLBACK_TIMEZONES: string[] = [
  "UTC",
  "America/Anchorage",
  "America/Chicago",
  "America/Denver",
  "America/Halifax",
  "America/Los_Angeles",
  "America/Mexico_City",
  "America/New_York",
  "America/Phoenix",
  "America/Sao_Paulo",
  "America/Toronto",
  "Africa/Cairo",
  "Africa/Johannesburg",
  "Africa/Lagos",
  "Africa/Nairobi",
  "Asia/Bangkok",
  "Asia/Dubai",
  "Asia/Hong_Kong",
  "Asia/Jakarta",
  "Asia/Jerusalem",
  "Asia/Karachi",
  "Asia/Kolkata",
  "Asia/Manila",
  "Asia/Seoul",
  "Asia/Shanghai",
  "Asia/Singapore",
  "Asia/Taipei",
  "Asia/Tehran",
  "Asia/Tokyo",
  "Atlantic/Azores",
  "Australia/Melbourne",
  "Australia/Perth",
  "Australia/Sydney",
  "Europe/Amsterdam",
  "Europe/Athens",
  "Europe/Berlin",
  "Europe/Dublin",
  "Europe/Helsinki",
  "Europe/Istanbul",
  "Europe/London",
  "Europe/Madrid",
  "Europe/Moscow",
  "Europe/Paris",
  "Europe/Rome",
  "Europe/Stockholm",
  "Europe/Vienna",
  "Europe/Warsaw",
  "Pacific/Auckland",
  "Pacific/Honolulu",
];

/**
 * Group IANA zones by their first path segment. `America/New_York`
 * → "America", `UTC` → "Other". Buckets and zones are sorted
 * alphabetically.
 */
export function buildZoneGroups(): Array<{ group: string; zones: string[] }> {
  const zones =
    typeof Intl.supportedValuesOf === "function"
      ? (() => {
          try {
            return Intl.supportedValuesOf("timeZone");
          } catch {
            return [];
          }
        })()
      : [];
  const merged =
    zones.length > 0
      ? Array.from(new Set([...FALLBACK_TIMEZONES, ...zones]))
      : FALLBACK_TIMEZONES;
  const buckets = new Map<string, string[]>();
  for (const zone of merged) {
    const slash = zone.indexOf("/");
    const group = slash === -1 ? "Other" : zone.slice(0, slash);
    const list = buckets.get(group) ?? [];
    list.push(zone);
    buckets.set(group, list);
  }
  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([group, list]) => ({
      group,
      zones: list.sort((a, b) => a.localeCompare(b)),
    }));
}

/**
 * Friendly UTC-offset label for an IANA zone, e.g. "GMT-05:00".
 * `UTC` short-circuits to "UTC" for scannability.
 */
export function friendlyOffsetLabel(zone: string, now: Date): string {
  if (zone === "UTC") return "UTC";
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      timeZoneName: "shortOffset",
    }).formatToParts(now);
    return parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}

/**
 * UTC offset of `timeZone` at the given instant, in minutes.
 * Handles DST because it reads the zone's wall clock for that instant.
 * Returns `null` for unknown zones.
 */
export function getTimeZoneOffsetMinutes(
  timeZone: string,
  date: Date = new Date()
): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
    const get = (type: string): string | undefined =>
      parts.find((p) => p.type === type)?.value;
    const year = Number(get("year"));
    const month = Number(get("month"));
    const day = Number(get("day"));
    const hour = Number(get("hour"));
    const minute = Number(get("minute"));
    const second = Number(get("second"));
    if (
      [year, month, day, hour, minute, second].some((n) => !Number.isFinite(n))
    ) {
      return null;
    }
    const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);
    const base = Math.floor(date.getTime() / 1000) * 1000;
    return Math.round((asUtc - base) / 60000);
  } catch {
    return null;
  }
}

export type TimeZoneDifference = {
  /** Minutes the student is ahead of the instructor (negative = behind). */
  diffMinutes: number;
  direction: "ahead" | "behind" | "same";
  /** Human label such as "1 hour ahead of you" or "Same timezone as you". */
  label: string;
};

/**
 * Compare the student's zone to the instructor's zone at `date`.
 * Returns `null` when either date/timezone can't be resolved.
 */
export function describeTimeZoneDifference(
  studentTimeZone: string | null | undefined,
  instructorTimeZone: string | null | undefined,
  date: Date = new Date()
): TimeZoneDifference | null {
  if (!studentTimeZone || !instructorTimeZone) return null;
  const studentOffset = getTimeZoneOffsetMinutes(studentTimeZone, date);
  const instructorOffset = getTimeZoneOffsetMinutes(instructorTimeZone, date);
  if (studentOffset === null || instructorOffset === null) return null;

  const diffMinutes = studentOffset - instructorOffset;
  if (diffMinutes === 0) {
    return { diffMinutes: 0, direction: "same", label: "Same timezone as you" };
  }

  const abs = Math.abs(diffMinutes);
  const hours = Math.floor(abs / 60);
  const minutes = abs % 60;
  const amount =
    hours > 0 && minutes > 0
      ? `${hours}h ${minutes}m`
      : hours > 0
        ? `${hours} ${hours === 1 ? "hour" : "hours"}`
        : `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  const direction = diffMinutes > 0 ? "ahead" : "behind";
  return {
    diffMinutes,
    direction,
    label:
      direction === "ahead"
        ? `${amount} ahead of you`
        : `${amount} behind you`,
  };
}
