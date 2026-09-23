"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

export type InventoryInstructor = {
  _id: Id<"instructors">;
  _creationTime?: number;
  userId?: string;
  name?: string | null;
  slug?: string | null;
  email?: string | null;
  oneOnOneInventory?: number;
  groupInventory?: number;
  maxActiveStudents?: number;
  activeStudentCount?: number;
  deletedAt?: number | null;
};

export type InventoryWaitlistEntry = {
  _id: Id<"marketingWaitlist">;
  email: string;
  instructorSlug: string;
  mentorshipType: "oneOnOne" | "group";
  notifiedAt: number | null;
  createdAt: number;
};

/**
 * PR 6: hook layer for the marketing /admin/inventory page.
 *
 * Replaces the Supabase-backed `getAllInstructorsWithInventory` +
 * `getWaitlistCounts` join (the source of the `text = uuid` 500 that
 * broke the page in apps/marketing) with Convex reads. PR 6a landed
 * the waitlist Convex port (PR #859); PR 6 reuses the now-deployed
 * `instructors.getInstructorsForAdmin` and the waitlist mutations.
 *
 * The page UI itself lives in
 * `apps/marketing/components/admin/inventory-table.tsx` and combines
 * this query with the static `apps/marketing/lib/instructors.ts`
 * config to render the `has_pricing_*` flags (the Convex shape does
 * not carry offer configuration; that's marketing copy, not data).
 */

const INVENTORY_QUERY_LIMIT = 200;

/**
 * Lists every non-deleted instructor for the admin inventory card grid.
 * The 200-row cap is well under the current ~28-instructor corpus and
 * keeps the page within Convex's per-query 8192-doc read budget. A
 * future PR can swap to cursor pagination once the corpus grows
 * past this cap (mirror the `getInstructorsWithStatsForAdmin`
 * pattern in `apps/marketing/lib/queries/convex/use-instructors.ts`).
 */
export function useInventoryInstructors() {
  return useQuery({
    ...convexQuery(api.instructors.getInstructorsForAdmin, {
      limit: INVENTORY_QUERY_LIMIT,
    }),
  });
}

/**
 * Updates an instructor's inventory fields. `useUpdateInventory` writes
 * the new value via `api.instructors.updateInstructor` (admin branch
 * already delegates to `internalAtomicFullUpdateInstructor` so the
 * patch + `updatedAt` flip is one transaction) and optimistically
 * patches the cache so rapid consecutive +/- clicks compose against
 * the cache before the server returns.
 *
 * The cache-key predicate matches every query that starts with the
 * `instructors.getInstructorsForAdmin` function reference so any
 * other page that consumes the same query (`/admin/instructors`,
 * future cursors) also sees the optimistic value. The `refetchType:
 * "all"` flag forces the refetch to wait for the in-flight mutation
 * to commit before re-running — without it, optimistic updates can
 * race a refetch and revert the UI.
 */
export function useUpdateInventory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.instructors.updateInstructor),
    onMutate: async (variables: {
      id: Id<"instructors">;
      oneOnOneInventory?: number;
      groupInventory?: number;
    }) => {
      await queryClient.cancelQueries({
        predicate: (q) =>
          q.queryKey[0] === "convexQuery" &&
          typeof q.queryKey[1] === "string" &&
          q.queryKey[1].startsWith("instructors:getInstructorsForAdmin"),
      });
      const previous = queryClient.getQueriesData({
        predicate: (q) =>
          q.queryKey[0] === "convexQuery" &&
          typeof q.queryKey[1] === "string" &&
          q.queryKey[1].startsWith("instructors:getInstructorsForAdmin"),
      });
      queryClient.setQueriesData(
        {
          predicate: (q) =>
            q.queryKey[0] === "convexQuery" &&
            typeof q.queryKey[1] === "string" &&
            q.queryKey[1].startsWith("instructors:getInstructorsForAdmin"),
        },
        (old: InventoryInstructor[] | undefined) => {
          if (!old) return old;
          return old.map((row) =>
            row._id === variables.id
              ? {
                  ...row,
                  oneOnOneInventory:
                    variables.oneOnOneInventory ?? row.oneOnOneInventory,
                  groupInventory: variables.groupInventory ?? row.groupInventory,
                }
              : row,
          );
        },
      );
      return { previous };
    },
    onError: (_err, _variables, context) => {
      if (!context) return;
      for (const [key, value] of context.previous) {
        queryClient.setQueryData(key, value);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        predicate: (q) =>
          q.queryKey[0] === "convexQuery" &&
          typeof q.queryKey[1] === "string" &&
          q.queryKey[1].startsWith("instructors:getInstructorsForAdmin"),
        refetchType: "all",
      });
    },
  });
}

/**
 * Fetches waitlist entries for the modal. Admin-gated server-side
 * (returns `[]` for non-admins). `mentorshipType` is optional — when
 * set, the server filters to one type via the
 * `by_instructorSlug_mentorshipType` index; when unset, returns every
 * entry for the slug (useful for the CSV export).
 *
 * `enabled` is `false` until the modal opens so the page does not
 * pay for an empty subscription when no modal is open.
 */
export function useWaitlistForInstructor(
  instructorSlug: string | null | undefined,
  mentorshipType?: "oneOnOne" | "group",
  enabled: boolean = true,
) {
  return useQuery({
    ...convexQuery(api.waitlist.getWaitlistForInstructor, {
      instructorSlug: instructorSlug ?? "",
      mentorshipType,
    }),
    enabled: enabled && !!instructorSlug,
  });
}

/**
 * Flips `notifiedAt = Date.now()` on every unnotified entry for an
 * instructor (+ optional `mentorshipType` filter). Server-side filter
 * is admin-gated; the modal calls this on "Mark All Notified" and the
 * card hover menu also calls it directly.
 *
 * `invalidateQueries(["waitlist"])` covers both the `getWaitlistForInstructor`
 * subscription (re-renders the modal's "Notified" badge column) and any
 * sibling page that reads waitlist data.
 */
export function useMarkNotifiedByInstructor() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.waitlist.markNotifiedByInstructor),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["waitlist"] });
    },
  });
}

/**
 * Deletes a batch of waitlist entries by `_id`. The modal collects
 * `_id`s from the checked rows and calls this on "Delete Selected".
 *
 * Server-side is admin-gated; the cache invalidation matches the
 * markNotifiedByInstructor hook so a follow-up "Mark All Notified"
 * after a delete doesn't see stale state.
 */
export function useRemoveMultipleFromWaitlist() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.waitlist.removeMultipleFromWaitlist),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["waitlist"] });
    },
  });
}

