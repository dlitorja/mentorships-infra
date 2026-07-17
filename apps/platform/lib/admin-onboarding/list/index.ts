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
 * RFC 4180 CSV escaping: wraps a value in double quotes if it contains
 * a comma, double quote, carriage return, or newline. Inner double
 * quotes are doubled.
 */
export function escapeCsv(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
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
 */
export function rowsToCsv(items: AdminOnboardingListItem[]): string {
  const lines = [CSV_HEADERS.map(escapeCsv).join(",")];
  for (const item of items) {
    const renewalCount = item.perInstructor.filter((p) => p.isRenewal).length;
    const values = [
      new Date(item.createdAt).toISOString(),
      item.email,
      item.source,
      `${item.perInstructor.length} (${renewalCount} renewal)`,
      item.instructorNames.join("; "),
      statusLabel(item.status),
      String(item.attemptCount),
      item.failureReason ?? "",
    ];
    lines.push(values.map(escapeCsv).join(","));
  }
  return lines.join("\r\n");
}
