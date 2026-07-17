import type { Doc } from "../../../../convex/_generated/dataModel";

export type StaleRowPage = {
  rows: Doc<"adminOnboardings">[];
  continueCursor: string | null;
  isDone: boolean;
};

export type StaleRowFetcher = (
  cursor: string | null,
  numItems: number
) => Promise<StaleRowPage>;

export type PaginateStaleOptions = {
  maxRows?: number;
  pageSize?: number;
};

export type PaginateStaleResult = {
  rows: Doc<"adminOnboardings">[];
  truncated: boolean;
  totalFetched: number;
};

export const DEFAULT_STALE_PAGE_SIZE = 1000;
export const DEFAULT_STALE_MAX_ROWS = 10_000;

/**
 * R3 (PR 7): iterate `getStaleOnboardingsAction` pages until either
 * `isDone` or the configured safety cap (`maxRows`) is reached. The
 * Inngest caller loops the returned rows through `send-digest` and
 * `release-placeholders`. If `truncated` is true, the caller MUST
 * surface a `reportError` so monitoring catches the unprocessed tail —
 * the next cron run will pick the rest up.
 *
 * Pure async helper — accepts a fetcher function so unit tests can
 * exercise pagination without touching Convex.
 */
export async function paginateStaleOnboardings(
  fetch: StaleRowFetcher,
  options: PaginateStaleOptions = {}
): Promise<PaginateStaleResult> {
  const maxRows = options.maxRows ?? DEFAULT_STALE_MAX_ROWS;
  const pageSize = options.pageSize ?? DEFAULT_STALE_PAGE_SIZE;
  const rows: Doc<"adminOnboardings">[] = [];
  let cursor: string | null = null;
  let isDone = false;
  let totalFetched = 0;

  while (!isDone && rows.length < maxRows) {
    const remaining = maxRows - rows.length;
    const numItems = Math.min(pageSize, remaining);
    const page = await fetch(cursor, numItems);
    rows.push(...page.rows);
    totalFetched += page.rows.length;
    cursor = page.continueCursor;
    isDone = page.isDone;
  }

  return { rows, truncated: !isDone, totalFetched };
}
