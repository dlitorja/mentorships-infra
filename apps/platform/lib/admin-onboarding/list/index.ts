import type { AdminOnboardingListItem } from "../../queries/convex/use-admin-onboardings";
import { statusLabel } from "../../admin-onboarding";

/**
 * PR 11: sort state for the admin onboarding list table.
 * Default is `createdAt desc` — matches the server-side ordering from
 * `listAdminOnboardingsInternal` so the initial render is stable.
 */
export type SortColumn = "createdAt" | "status" | "attemptCount";
export type SortDirection = "asc" | "desc";

export const DEFAULT_SORT_COLUMN: SortColumn = "createdAt";
export const DEFAULT_SORT_DIRECTION: SortDirection = "desc";

/**
 * Pure sort comparator. Returns a negative number if `a` should appear
 * before `b` under the current sort state, positive if after, 0 if equal.
 *
 * Status column sorts alphabetically on the user-facing label so
 * `Cancelled < Completed < Failed < Processing < Queued` — a useful
 * ops-triage ordering.
 */
export function compareItems(
  a: AdminOnboardingListItem,
  b: AdminOnboardingListItem,
  column: SortColumn,
  direction: SortDirection
): number {
  const sign = direction === "asc" ? 1 : -1;
  if (column === "createdAt") return sign * (a.createdAt - b.createdAt);
  if (column === "attemptCount") return sign * (a.attemptCount - b.attemptCount);
  return sign * statusLabel(a.status).localeCompare(statusLabel(b.status));
}

/**
 * Pure sort helper: returns a new sorted array (does not mutate the input).
 */
export function sortItems(
  items: AdminOnboardingListItem[],
  column: SortColumn,
  direction: SortDirection
): AdminOnboardingListItem[] {
  return [...items].sort((a, b) => compareItems(a, b, column, direction));
}

/**
 * RFC 4180 CSV escaping with OWASP CSV-injection mitigation:
 * - Wraps a value in double quotes if it contains a comma, double quote,
 *   carriage return, or newline. Inner double quotes are doubled.
 * - Prefix user-controlled text fields starting with `=`, `+`, `-`, `@`,
 *   tab, or carriage return with a single quote (`'`) so Excel /
 *   LibreOffice do not interpret them as a formula. (CWEs CWE-1236.)
 *   We always apply the prefix — it is a no-op for non-formula content.
 */
export function escapeCsv(value: string): string {
  let sanitized = value;
  if (/^[=+\-@\t\r]/.test(sanitized)) {
    sanitized = "'" + sanitized;
  }
  if (/[",\r\n]/.test(sanitized)) {
    return `"${sanitized.replace(/"/g, '""')}"`;
  }
  return sanitized;
}

const CSV_HEADERS = [
  "Submitted",
  "Email",
  "Source",
  "Instructors",
  "InstructorNames",
  "Status",
  "Attempts",
  "Failure",
] as const;

/**
 * Render the visible rows as a CSV string (RFC 4180 line endings: CRLF).
 * Does NOT prepend a UTF-8 BOM — that's the caller's job (see
 * `downloadCsv` in the page) so it stays composable.
 *
 * Each user-controlled value is run through `escapeCsv` BEFORE any
 * list-joining so the OWASP CSV-injection prefix (`'`) is applied to
 * the actual user value, not to the joined string. (E.g. instructor
 * names are escaped per-element before being concatenated with `; `.)
 */
export function rowsToCsv(items: AdminOnboardingListItem[]): string {
  const lines = [CSV_HEADERS.map(escapeCsv).join(",")];
  for (const item of items) {
    const renewalCount = item.perInstructor.filter((p) => p.isRenewal).length;
    const joinedNames = item.instructorNames.map(escapeCsv).join("; ");
    const values = [
      escapeCsv(new Date(item.createdAt).toISOString()),
      escapeCsv(item.email),
      escapeCsv(item.source),
      escapeCsv(`${item.perInstructor.length} (${renewalCount} renewal)`),
      joinedNames,
      escapeCsv(statusLabel(item.status)),
      escapeCsv(String(item.attemptCount)),
      escapeCsv(item.failureReason ?? ""),
    ];
    lines.push(values.join(","));
  }
  return lines.join("\r\n");
}
