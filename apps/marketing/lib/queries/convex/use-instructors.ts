"use client";

import { useState, useCallback } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import {
  convexQuery,
  useConvexMutation,
} from "@convex-dev/react-query";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

/**
 * PR admin-mirror #4: hook layer for the marketing /admin/instructors
 * page. Mirrors `apps/platform/lib/queries/convex/use-instructors.ts`
 * shape (one hook per Convex query, wrapped in `convexQuery`). The
 * `InstructorWithStats` + `InstructorWithStudents` shapes here match
 * the Drizzle `packages/db/src/lib/queries/admin.ts` types so the
 * existing client component (refactored to consume Convex) doesn't
 * have to remap fields.
 *
 * Naming: `instructorId` is the Convex `_id` cast to string — the
 * admin UI keys off this string (legacy field). `userId` stays the
 * Clerk subject.
 */

export type InstructorWithStats = {
  instructorId: string;
  userId: string;
  email: string;
  bio: string | null;
  oneOnOneInventory: number;
  groupInventory: number;
  maxActiveStudents: number;
  activeStudentCount: number;
  createdAt: number;
};

export type InstructorStudentRow = {
  userId: string;
  email: string | null;
  sessionPackId: Id<"sessionPacks">;
  totalSessions: number;
  remainingSessions: number;
  status: "active" | "depleted" | "expired" | "refunded";
  expiresAt: number | null;
  lastSessionCompletedAt: number | null;
  completedSessionCount: number;
  seatStatus: "active" | "grace" | "released";
  seatExpiresAt: number | null;
};

export type InstructorWithStudents = InstructorWithStats & {
  students: InstructorStudentRow[];
};

export type FullAdminReportRow = {
  instructorEmail: string | null;
  studentEmail: string | null;
  totalSessions: number;
  remainingSessions: number;
  packStatus: "active" | "depleted" | "expired" | "refunded";
  packExpiresAt: number | null;
  lastSessionDate: number | null;
  completedSessionsCount: number;
  seatStatus: "active" | "grace" | "released";
};

/**
 * Cursor-paginated instructor list for the admin table. Replaces
 * `getAllInstructorsWithStats(search, page, pageSize)` from
 * `packages/db/src/lib/queries/admin.ts` (the source of the
 * `operator does not exist: text = uuid` 500 in marketing's
 * `/admin/instructors` page).
 *
 * Each fetched cursor becomes its own Convex subscription via
 * `useQueries` so that reactive updates to ANY previously-loaded
 * page propagate to the rendered list (not just the most-recently
 * fetched cursor). Pages are accumulated in a stable order by
 * insertion sequence; the displayed list is derived from the
 * accumulated pages.
 */
type InstructorListPage = {
  page: InstructorWithStats[];
  isDone: boolean;
  continueCursor: string;
};
// Reserved type alias for future per-page metadata export.
type _InstructorListPageReserved = InstructorListPage;

export function useInstructorsWithStatsForAdmin(args: {
  search?: string;
  pageSize?: number;
}) {
  const numItems = args.pageSize ?? 50;
  const [cursorChain, setCursorChain] = useState<Array<string | null>>([null]);
  const [lastSeenSearch, setLastSeenSearch] = useState<string | undefined>(args.search);

  // Reset when the search term changes.
  if (lastSeenSearch !== args.search) {
    setLastSeenSearch(args.search);
    setCursorChain([null]);
  }

  // One Convex subscription per loaded cursor — `useQueries` returns
  // an array of results in the same order as the input array, so
  // `cursorChain[i]` corresponds to `results[i]`.
  const results = useQueries({
    queries: cursorChain.map((cursor) =>
      convexQuery(api.admin.getInstructorsWithStatsForAdmin, {
        search: args.search,
        paginationOpts: { numItems, cursor },
      })
    ),
  });

  const accumulated: InstructorWithStats[] = [];
  let firstError: unknown = null;
  let isFirstPageLoading = false;
  let lastIsDone = true;
  let lastContinueCursor: string | null = null;

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.error) firstError = firstError ?? r.error;
    if (i === 0 && r.isLoading) isFirstPageLoading = true;
    if (r.data) {
      accumulated.push(...r.data.page);
      lastIsDone = r.data.isDone;
      lastContinueCursor = r.data.continueCursor;
    }
  }

  const loadMore = useCallback(
    (_n: number) => {
      if (!lastIsDone && lastContinueCursor != null) {
        // Only advance if the new cursor isn't already loaded.
        if (!cursorChain.includes(lastContinueCursor)) {
          setCursorChain((prev) => [...prev, lastContinueCursor]);
        }
      }
    },
    [lastIsDone, lastContinueCursor, cursorChain]
  );

  return {
    data: accumulated,
    isLoading: isFirstPageLoading && accumulated.length === 0,
    isFetchingMore: isFirstPageLoading && accumulated.length > 0,
    error: firstError,
    canLoadMore: !lastIsDone && !isFirstPageLoading,
    loadMore,
  };
}

/**
 * Fetches a single instructor with their full student list.
 * Replaces `getInstructorWithStudents(instructorId)`.
 */
export function useInstructorWithStudents(instructorId: Id<"instructors"> | null | undefined) {
  return useQuery({
    ...convexQuery(api.admin.getInstructorWithStudents, {
      instructorId: (instructorId ?? ("_skip_" as Id<"instructors">)) as Id<"instructors">,
    }),
    enabled: !!instructorId,
  });
}

/**
 * Fetches the full admin CSV report (every session pack joined with
 * instructor + student email). Replaces `getFullAdminCsvData()`.
 * Used by the "Export CSV" button.
 *
 * `enabled` defaults to `false` — the full scan is expensive and
 * should only run when the admin actually clicks "Export CSV".
 *
 * Returns `{ data, refetch, bumpNonce }`. The caller must `bumpNonce()`
 * on every click so the query key changes; otherwise TanStack Query
 * reuses the cached result from the previous export.
 */
export function useFullAdminCsvData(enabled: boolean = false) {
  const [nonce, setNonce] = useState(0);
  const result = useQuery({
    ...convexQuery(api.admin.getFullAdminCsvData, { nonce }),
    enabled,
  });
  return {
    ...result,
    bumpNonce: () => setNonce((n) => n + 1),
  };
}

/**
 * Atomically increments `sessionPacks.remainingSessions` by 1 and
 * flips status `depleted → active` if the new balance is positive.
 * Replaces `incrementRemainingSessions(packId)` from Drizzle.
 */
export function useIncrementRemainingSessions() {
  return useConvexMutation(api.admin.incrementRemainingSessions);
}

/**
 * Atomically decrements `sessionPacks.remainingSessions` by 1 (floored
 * at 0) and flips status to `depleted` if the new balance is 0.
 * Replaces `decrementRemainingSessions(packId)` from Drizzle.
 */
export function useDecrementRemainingSessions() {
  return useConvexMutation(api.admin.decrementRemainingSessions);
}

/**
 * Derive the max page number from a total count + page size.
 * Convenience helper for the client component pagination.
 */
export function totalPagesFor(total: number | undefined, pageSize: number): number {
  if (!total || total <= 0) return 1;
  return Math.max(1, Math.ceil(total / pageSize));
}

/**
 * Convert Convex instructor rows into a stable-shape list. The Convex
 * `getInstructorsWithStatsForAdmin` already returns `InstructorWithStats`,
 * but if the consumer wants a stable field order (for CSV / printing),
 * this helper reorders. Currently a no-op identity — kept as a hook
 * for future shape migrations.
 */
export function normalizeInstructorList(rows: InstructorWithStats[] | undefined): InstructorWithStats[] {
  if (!rows) return [];
  return rows.map((r) => ({ ...r }));
}
