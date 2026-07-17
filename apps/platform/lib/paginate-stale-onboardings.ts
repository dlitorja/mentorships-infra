import type { Doc } from "@/convex/_generated/dataModel";

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
  totalRequested: number;
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
 * The cap (`maxRows`) bounds the **scan budget** — i.e. the total
 * number of rows the upstream `paginate(numItems)` call had to look
 * at across all iterations. This matters because `getStaleOnboardingsInternal`
 * server-side filters candidates by `createdAt` cutoff + placeholder
 * ownership, so a row that doesn't pass the filter still costs one
 * upstream DB read. Capping on `rows.length` (returned count) instead
 * would let a heavy-filter page silently issue many more scans than
 * intended, exhausting Inngest step cost without ever signalling
 * `truncated: true`. We bound by `numItems` requested per iteration
 * instead.
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
  let totalRequested = 0;

  while (!isDone && totalRequested < maxRows) {
    const remaining = maxRows - totalRequested;
    const numItems = Math.min(pageSize, remaining);
    const page = await fetch(cursor, numItems);
    rows.push(...page.rows);
    totalRequested += numItems;
    cursor = page.continueCursor;
    isDone = page.isDone;
  }

  return { rows, truncated: !isDone, totalRequested };
}
