/**
 * Timezone-aware date arithmetic helpers.
 *
 * These avoid the common DST bug where adding N weeks in milliseconds
 * shifts the local wall time when a DST transition occurs between the
 * base and target dates. Instead, we decompose the base instant into its
 * local calendar components in the target timezone, add the calendar
 * offset (e.g. 7 days for a weekly recurrence), and then search for the
 * UTC instant whose local components in that timezone match.
 */

export type LocalDateTime = {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number;
  second: number;
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

function getPart(
  parts: Intl.DateTimeFormatPart[],
  type: keyof LocalDateTime
): number {
  const value = parts.find((p) => p.type === type)?.value;
  return value ? parseInt(value, 10) : 0;
}

export function getLocalDateTime(
  date: Date,
  timeZone: string
): LocalDateTime {
  const parts = getFormatter(timeZone).formatToParts(date);
  return {
    year: getPart(parts, "year"),
    month: getPart(parts, "month"),
    day: getPart(parts, "day"),
    hour: getPart(parts, "hour"),
    minute: getPart(parts, "minute"),
    second: getPart(parts, "second"),
  };
}

export function addDays(local: LocalDateTime, days: number): LocalDateTime {
  return {
    ...local,
    day: local.day + days,
  };
}

export function addMinutes(local: LocalDateTime, minutes: number): LocalDateTime {
  return {
    ...local,
    minute: local.minute + minutes,
  };
}

/**
 * Convert a local wall-clock date/time expressed in `timeZone` into the
 * corresponding UTC timestamp. Uses an offset estimate followed by a
 * bounded brute-force search to handle DST transitions correctly.
 */
export function localDateTimeToUtcMillis(
  local: LocalDateTime,
  timeZone: string
): number {
  // Build a naive UTC timestamp from the target local components.
  // This is the instant the local time would represent if the zone were UTC.
  const naiveUtc = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second
  );

  // Estimate the offset using the current system timezone behavior at the
  // naive UTC instant. This gets us close even when the target zone is not
  // the system timezone, because Intl formatting handles the target zone.
  const estimate = new Date(naiveUtc);
  const estimateLocal = getLocalDateTime(estimate, timeZone);

  // Compute how far the naive UTC instant is from the target local time in
  // minutes. This is an approximate offset for the target timezone.
  const estimateLocalNaiveUtc = Date.UTC(
    estimateLocal.year,
    estimateLocal.month - 1,
    estimateLocal.day,
    estimateLocal.hour,
    estimateLocal.minute,
    estimateLocal.second
  );
  const offsetMinutes = (estimateLocalNaiveUtc - naiveUtc) / 60_000;

  let candidate = naiveUtc - offsetMinutes * 60_000;

  // Search within +/- 180 minutes to cover any DST transition. Most DST
  // shifts are 60 minutes; 180 minutes is generous and still tiny.
  for (let deltaMinutes = -180; deltaMinutes <= 180; deltaMinutes++) {
    const test = new Date(candidate + deltaMinutes * 60_000);
    const testLocal = getLocalDateTime(test, timeZone);
    if (
      testLocal.year === local.year &&
      testLocal.month === local.month &&
      testLocal.day === local.day &&
      testLocal.hour === local.hour &&
      testLocal.minute === local.minute &&
      testLocal.second === local.second
    ) {
      return test.getTime();
    }
  }

  // Fallback: should not happen for valid timezones and short offsets.
  return candidate;
}

/**
 * Add `weeks` weekly recurrences to `isoStart`, preserving the same
 * local wall time in `timeZone`. This is the DST-safe replacement for
 * `baseMs + weeks * 7 * 24 * 60 * 60 * 1000`.
 */
export function addWeeksInTimeZone(
  isoStart: string,
  timeZone: string,
  weeks: number
): number {
  const base = new Date(isoStart);
  const baseLocal = getLocalDateTime(base, timeZone);
  const targetLocal = addDays(baseLocal, weeks * 7);
  return localDateTimeToUtcMillis(targetLocal, timeZone);
}

/**
 * Convert a UTC millisecond timestamp back into an ISO string suitable for
 * Google Calendar and Convex APIs. The caller should still pass the
 * original `timeZone` to the provider so the local time renders correctly.
 */
export function utcMillisToIsoString(millis: number): string {
  return new Date(millis).toISOString();
}
