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

/**
 * Returns true if `timeZone` is a recognized IANA timezone name.
 */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

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

function normalizeLocalDateTime(local: LocalDateTime): LocalDateTime {
  // Use UTC date arithmetic purely for calendar normalization. The timezone
  // does not matter here because we are only normalizing fields, not
  // converting between UTC and local time.
  const normalized = new Date(
    Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second)
  );
  return {
    year: normalized.getUTCFullYear(),
    month: normalized.getUTCMonth() + 1,
    day: normalized.getUTCDate(),
    hour: normalized.getUTCHours(),
    minute: normalized.getUTCMinutes(),
    second: normalized.getUTCSeconds(),
  };
}

export function addDays(local: LocalDateTime, days: number): LocalDateTime {
  return normalizeLocalDateTime({
    ...local,
    day: local.day + days,
  });
}

export function addMinutes(local: LocalDateTime, minutes: number): LocalDateTime {
  return normalizeLocalDateTime({
    ...local,
    minute: local.minute + minutes,
  });
}



/**
 * Convert a local wall-clock date/time expressed in `timeZone` into the
 * corresponding UTC timestamp, or `null` if the local wall time does not
 * exist in that timezone (e.g. a spring-forward DST gap).
 *
 * Uses an offset estimate followed by a bounded brute-force search to handle
 * DST transitions correctly.
 */
export function localDateTimeToUtcMillis(
  local: LocalDateTime,
  timeZone: string
): number | null {
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

  // No UTC instant maps to this local wall time — the wall time is inside a
  // DST gap (spring-forward) or otherwise invalid.
  return null;
}

/**
 * Add `weeks` weekly recurrences to `isoStart`, preserving the same local wall
 * time in `timeZone`. Returns `null` if the target local wall time does not
 * exist (e.g. lands in a spring-forward DST gap).
 *
 * This is the DST-safe replacement for
 * `baseMs + weeks * 7 * 24 * 60 * 60 * 1000`.
 */
export function addWeeksInTimeZone(
  isoStart: string,
  timeZone: string,
  weeks: number
): number | null {
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

/**
 * Format a UTC millisecond timestamp as a value for an `<input type="datetime-local">`
 * interpreted in the given IANA timezone.
 */
export function formatUtcMillisForDateTimeLocal(
  timeZone: string,
  millis: number
): string {
  const local = getLocalDateTime(new Date(millis), timeZone);
  const year = String(local.year).padStart(4, "0");
  const month = String(local.month).padStart(2, "0");
  const day = String(local.day).padStart(2, "0");
  const hour = String(local.hour).padStart(2, "0");
  const minute = String(local.minute).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

/**
 * Parse a value from an `<input type="datetime-local">` and convert it to a UTC
 * millisecond timestamp assuming the wall-clock time is in the given IANA timezone.
 *
 * Returns `null` if the value is malformed or the local wall time does not exist
 * in the target timezone (e.g. a DST spring-forward gap).
 */
export function parseDateTimeLocalToUtcMillis(
  timeZone: string,
  value: string
): number | null {
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/
  );
  if (!match) return null;

  const [, yearStr, monthStr, dayStr, hourStr, minuteStr, secondStr] = match;
  const local: LocalDateTime = {
    year: parseInt(yearStr, 10),
    month: parseInt(monthStr, 10),
    day: parseInt(dayStr, 10),
    hour: parseInt(hourStr, 10),
    minute: parseInt(minuteStr, 10),
    second: secondStr ? parseInt(secondStr, 10) : 0,
  };

  return localDateTimeToUtcMillis(local, timeZone);
}

/**
 * Default wall-clock hour window (in 24-hour form) during which a *student*
 * is willing to take sessions in their local timezone.
 *
 * Each candidate slot is evaluated by its **start** hour. A slot whose start
 * is in `[STUDENT_LOCAL_OK_HOURS_START, STUDENT_LOCAL_OK_HOURS_END)` is
 * considered acceptable; anything outside the window (e.g. midnight to 8am
 * or 22:00 to midnight) is filtered out by the availability preview endpoint.
 *
 * Exposed as a top-of-file constant so the policy can be tuned without
 * hunting through call sites. When product needs per-user customization,
 * promote into a `studentAvailabilityWindowHours` table column or settings
 * API; the algorithm here will read it through.
 */
export const STUDENT_LOCAL_OK_HOURS_START = 8;
export const STUDENT_LOCAL_OK_HOURS_END = 22;

/**
 * Returns true iff the slot's local start hour in `studentTimeZone` falls
 * inside the configured student-friendly window (`8 ≤ startHour < 22`).
 *
 * Centralised here so the route handler and its unit tests share a single
 * source of truth. A `null` or invalid `studentTimeZone` short-circuits to
 * `true` so existing callers (where we didn't filter by a student zone) keep
 * their current result.
 */
export function isSlotWithinStudentLocalHours(
  slotIso: string,
  studentTimeZone: string | null | undefined
): boolean {
  if (!studentTimeZone) return true;
  try {
    // `getLocalDateTime` already validates the zone through `Intl` and
    // returns zeros on a formatter failure rather than throwing, so we
    // additionally guard with `isValidTimeZone` to be sure.
    if (!isValidTimeZone(studentTimeZone)) return true;
    const local = getLocalDateTime(new Date(slotIso), studentTimeZone);
    return (
      local.hour >= STUDENT_LOCAL_OK_HOURS_START &&
      local.hour < STUDENT_LOCAL_OK_HOURS_END
    );
  } catch {
    // If anything goes sideways (rare DST edge case, exotic zone), fall
    // back to accept — the surface is "soft" filtering, not a hard reject.
    return true;
  }
}

/**
 * Squared hour-distance from mid-day (12:00) in `timeZone`, or
 * `Number.POSITIVE_INFINITY` when the zone is missing or the formatter
 * refuses the slot. The sentinel lets a downstream sort keep
 * "no-preference" entries behind any slots with a usable score and only
 * tie-break them if every entry lacks a score.
 *
 * Squaring de-emphasises near-misses (so a 10am slot doesn't accidentally
 * outrank a 12pm slot when 12pm is square-zero), matching the original
 * paper-and-pencil intent of a mid-day-weighted heuristic.
 */
function squareDistanceFromMidDay(
  iso: string,
  timeZone: string | null | undefined
): number {
  if (!timeZone) return Number.POSITIVE_INFINITY;
  try {
    const local = getLocalDateTime(new Date(iso), timeZone);
    const delta = local.hour - 12;
    return delta * delta;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/**
 * Re-rank a list of UTC ISO slot instants so the most "comfortable" for
 * the **student** comes first. The instructor distance is consulted only
 * as a tiebreaker when two slots share the same student distance.
 *
 * Greptile P1: previously this function summed a weighted
 * `(studentSq + 0.25 × instructorSq)` score, which lets a worse student
 * time outvote a better one whenever the instructor distance is small.
 * Worked example (SGT student, PT instructor, April):
 *   - 02:00 UTC → 10:00 SGT (student sq 4) + 19:00 PDT (instructor sq 49, weighted 12.25) → 16.25
 *   - 04:00 UTC → 12:00 SGT (student sq 0) + 21:00 PDT (instructor sq 81, weighted 20.25) → 20.25
 * Under the old sum the 02:00 slot won despite the 04:00 slot being
 * ideally aligned for the student. The lex sort below puts 04:00 first
 * (student sq 0 < 4) and only uses the instructor distance as a tiebreaker.
 *
 * Lower score = better. The function does not mutate the input array.
 *
 * Backwards-compat: when `studentTimeZone` is `null`, the student score is
 * `+Infinity` for every entry, so the comparison falls through to the
 * instructor side exactly like the pre-fix behaviour. When neither tz is
 * known, both scores are `+Infinity` and the stable sort preserves the
 * chronological order from the candidate loop.
 */
export function rankSlotsForTwoParties(
  slots: string[],
  studentTimeZone: string | null | undefined,
  instructorTimeZone: string | null | undefined
): string[] {
  if (!studentTimeZone && !instructorTimeZone) return [...slots];
  return [...slots]
    .map((iso) => ({
      iso,
      student: squareDistanceFromMidDay(iso, studentTimeZone),
      instructor: squareDistanceFromMidDay(iso, instructorTimeZone),
    }))
    .sort((a, b) => {
      // Primary: student distance. Compare numerically so the +Infinity
      // sentinel still sorts correctly (it always loses to a finite value).
      if (a.student !== b.student) return a.student - b.student;
      // Tiebreak: instructor distance, same semantics.
      return a.instructor - b.instructor;
    })
    .map(({ iso }) => iso);
}

/**
 * Format a UTC instant as a short, human-readable label like
 * "Tue, Mar 4 · 7:00pm PDT" in `timeZone`.
 *
 * Falls back to the runtime-default zone when `timeZone` is `null`. Returns
 * `null` for invalid inputs so callers can choose to render a fallback
 * label instead of crashing.
 */
export function formatSlotLabel(
  iso: string,
  timeZone: string | null | undefined
): string | null {
  try {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return null;
    const tz = timeZone ?? undefined;
    return new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
      timeZone: tz,
    }).format(date);
  } catch {
    return null;
  }
}
