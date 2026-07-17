import { describe, expect, it } from "vitest";
import {
  paginateStaleOnboardings,
  DEFAULT_STALE_MAX_ROWS,
  DEFAULT_STALE_PAGE_SIZE,
  type StaleRowPage,
  type StaleRowFetcher,
} from "./paginate-stale-onboardings";

function makeRow(i: number) {
  return {
    _id: "row_" + i as any,
    _creationTime: 0,
    email: "u" + i + "@example.com",
    status: "completed" as const,
    createdAt: 1_700_000_000_000 - i * 1000,
    perInstructor: [],
  } as any;
}

/**
 * Build a fetcher that simulates a Convex paginated scan returning
 * `rowsPerPage` rows per call until `totalRows` are produced.
 */
function makeChunkedFetcher(totalRows: number, rowsPerPage: number): { fetcher: StaleRowFetcher; calls: number[] } {
  const calls: number[] = [];
  let served = 0;
  let cursorSeq = 0;
  const fetcher: StaleRowFetcher = async (_cursor, numItems) => {
    calls.push(numItems);
    const remaining = totalRows - served;
    const thisBatch = Math.min(numItems, remaining);
    const rows = Array.from({ length: thisBatch }, (_, k) => makeRow(served + k));
    served += thisBatch;
    const isDone = served >= totalRows;
    cursorSeq += 1;
    const page: StaleRowPage = {
      rows,
      continueCursor: isDone ? null : "cursor_" + cursorSeq,
      isDone,
    };
    return page;
  };
  return { fetcher, calls };
}

/**
 * Build a fetcher that produces a single page (no further pages).
 */
function makeSinglePageFetcher(rows: any[]): { fetcher: StaleRowFetcher; callCount: { value: number } } {
  const callCount = { value: 0 };
  const fetcher: StaleRowFetcher = async () => {
    callCount.value += 1;
    return { rows, continueCursor: null, isDone: true };
  };
  return { fetcher, callCount };
}

/**
 * Build a fetcher that always returns `rowsPerPage` rows and signals
 * more pages remain (simulates "filter rejected some upstream but
 * candidates keep coming").
 */
function makeEndlessFetcher(rowsPerPage: number): { fetcher: StaleRowFetcher; calls: number[] } {
  const calls: number[] = [];
  let served = 0;
  let cursorSeq = 0;
  const fetcher: StaleRowFetcher = async (_cursor, numItems) => {
    calls.push(numItems);
    const thisBatch = Math.min(numItems, rowsPerPage);
    const rows = Array.from({ length: thisBatch }, (_, k) => makeRow(served + k));
    served += thisBatch;
    cursorSeq += 1;
    return { rows, continueCursor: "cursor_" + cursorSeq, isDone: false };
  };
  return { fetcher, calls };
}

describe("paginateStaleOnboardings", () => {
  it("returns empty result when there is nothing to fetch", async () => {
    const { fetcher, callCount } = makeSinglePageFetcher([]);
    const result = await paginateStaleOnboardings(fetcher);
    expect(result.rows).toEqual([]);
    expect(result.truncated).toBe(false);
    expect(result.totalRequested).toBe(DEFAULT_STALE_PAGE_SIZE);
    expect(callCount.value).toBe(1);
  });

  it("returns single-page result without further fetcher calls when isDone", async () => {
    const rows = [makeRow(1), makeRow(2), makeRow(3)];
    const { fetcher, callCount } = makeSinglePageFetcher(rows);
    const result = await paginateStaleOnboardings(fetcher);
    expect(result.rows).toEqual(rows);
    expect(result.truncated).toBe(false);
    // totalRequested counts numItems asked, not what the fetcher returned;
    // the single page requested 1000 (default pageSize) and got 3 back.
    expect(result.totalRequested).toBe(DEFAULT_STALE_PAGE_SIZE);
    expect(callCount.value).toBe(1);
  });

  it("iterates multiple pages until isDone", async () => {
    const { fetcher, calls } = makeChunkedFetcher(2500, 1000);
    const result = await paginateStaleOnboardings(fetcher, { pageSize: 1000, maxRows: 10_000 });
    expect(result.rows).toHaveLength(2500);
    expect(result.truncated).toBe(false);
    expect(result.totalRequested).toBe(3000);
    // Each call requests pageSize (1000); final page receives fewer rows from the fetcher.
    expect(calls).toEqual([1000, 1000, 1000]);
  });

  it("accumulates whatever the fetcher returns even if final page is shorter", async () => {
    const { fetcher, calls } = makeChunkedFetcher(1234, 1000);
    const result = await paginateStaleOnboardings(fetcher, { pageSize: 1000, maxRows: 10_000 });
    expect(result.rows).toHaveLength(1234);
    expect(result.truncated).toBe(false);
    expect(result.totalRequested).toBe(2000);
    expect(calls).toEqual([1000, 1000]);
  });

  it("respects the safety cap and flags truncation when more rows remain (high filter accept)", async () => {
    const { fetcher, calls } = makeChunkedFetcher(15_000, 1000);
    const result = await paginateStaleOnboardings(fetcher, { pageSize: 1000, maxRows: DEFAULT_STALE_MAX_ROWS });
    expect(result.rows).toHaveLength(DEFAULT_STALE_MAX_ROWS);
    expect(result.truncated).toBe(true);
    expect(result.totalRequested).toBe(DEFAULT_STALE_MAX_ROWS);
    expect(calls).toEqual([1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000]);
  });

  it("bounds scan cost regardless of filter rate (Greptile P1 fix)", async () => {
    // Endless fetcher returns a full page each call and signals isDone=false.
    // With maxRows=10000 and pageSize=1000, the loop must terminate after 10
    // calls — never infinite — even if the upstream has millions of rows.
    const { fetcher, calls } = makeEndlessFetcher(1000);
    const result = await paginateStaleOnboardings(fetcher, { pageSize: 1000, maxRows: 10_000 });
    expect(result.rows).toHaveLength(10_000);
    expect(result.truncated).toBe(true);
    expect(result.totalRequested).toBe(10_000);
    expect(calls.length).toBe(10);
    expect(calls).toEqual([1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000]);
  });

  it("uses defaults when no options are passed (pageSize=1000, maxRows=10000)", async () => {
    const { fetcher, calls } = makeChunkedFetcher(2500, 1000);
    const result = await paginateStaleOnboardings(fetcher);
    expect(result.rows).toHaveLength(2500);
    expect(result.truncated).toBe(false);
    expect(calls).toEqual([1000, 1000, 1000]);
    expect(DEFAULT_STALE_PAGE_SIZE).toBe(1000);
    expect(DEFAULT_STALE_MAX_ROWS).toBe(10_000);
  });

  it("propagates fetcher cursor across calls", async () => {
    const seenCursors: Array<string | null> = [];
    let served = 0;
    const fetcher: StaleRowFetcher = async (cursor, numItems) => {
      seenCursors.push(cursor);
      const remaining = 1500 - served;
      const thisBatch = Math.min(numItems, remaining);
      const rows = Array.from({ length: thisBatch }, (_, k) => makeRow(served + k));
      served += thisBatch;
      const isDone = served >= 1500;
      return { rows, continueCursor: isDone ? null : "next-" + served, isDone };
    };
    const result = await paginateStaleOnboardings(fetcher);
    expect(result.rows).toHaveLength(1500);
    expect(seenCursors).toEqual([null, "next-1000"]);
  });

  it("respects a custom pageSize smaller than the default", async () => {
    const { fetcher, calls } = makeChunkedFetcher(300, 100);
    const result = await paginateStaleOnboardings(fetcher, { pageSize: 100, maxRows: 10_000 });
    expect(result.rows).toHaveLength(300);
    expect(result.truncated).toBe(false);
    expect(calls).toEqual([100, 100, 100]);
  });
});
