"use client";

import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

/**
 * Subscribes to `api.sessions.getCurrentOrUpcomingSessionForWorkspace`
 * (PR #3) and returns the result. Used by the Join Call button and
 * VideoPanel mount logic on the workspace UI.
 *
 * Returns:
 *   - `null` while loading
 *   - `null` if the workspace is ended/deleted or caller not authorized
 *   - `{ status: "active", ... }` for an in-progress call
 *   - `{ status: "joinable", ... }` for a session within ±15min window
 *   - `{ status: "scheduled", ... }` for an upcoming session outside the window
 *
 * Re-runs whenever the query invalidates (e.g. after `markCallStarted`
 * or `endCall` mutations succeed). Stale time follows the global React
 * Query defaults (1m) configured in `lib/providers/query-provider.tsx`.
 *
 * PR workspace-live-calls: polls every 5s as a defensive fallback
 * because the Convex live subscription for this query occasionally
 * does not push updates when another party starts or ends a call.
 * Without the poll, the Join/End call pill can stay stale until the
 * user refreshes.
 */
export function useCurrentOrUpcomingSessionForWorkspace(workspaceId: Id<"workspaces"> | null) {
  return useQuery({
    ...convexQuery(api.sessions.getCurrentOrUpcomingSessionForWorkspace, {
      workspaceId: workspaceId as Id<"workspaces">,
    }),
    enabled: workspaceId !== null,
    refetchInterval: 5000,
  });
}
