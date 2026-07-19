"use client";

import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

/**
 * R12: returns the user's unacknowledged call-recording
 * retention notifications. Each row corresponds to one
 * recording approaching deletion at one of the 30/7/1-day
 * windows. The banner reads this list to decide which
 * countdown to surface.
 *
 * Mirrors the `useUnacknowledgedRetentionNotifications` hook
 * for workspace retention (`apps/platform/lib/queries/convex/use-workspaces.ts:484`)
 * — same shape, same ack-required semantics.
 */
export function useUnacknowledgedRecordingRetentionNotifications() {
  return useQuery({
    ...convexQuery(
      api.recordingRetention.getUnacknowledgedRecordingRetentionNotifications,
      {}
    ),
  });
}

/**
 * R12: mutation hook for acknowledging a recording-retention
 * warning. Marks the notification row as seen so the banner
 * stops surfacing it. Invalidate the unacknowledged list so
 * the banner re-fetches.
 */
export function useAcknowledgeRecordingRetentionNotification() {
  const queryClient = useQueryClient();

  const mutationFn = useConvexMutation(
    api.recordingRetention.acknowledgeRecordingRetentionNotification
  );

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: [
        "recordingRetentionNotifications",
        "unacknowledged",
      ],
    });
  }, [queryClient]);

  return useMutation({
    mutationFn: async (args: { id: Id<"recordingRetentionNotifications"> }) => {
      await mutationFn(args);
    },
    onSuccess: invalidate,
  });
}

/**
 * R12: bulk-ack hook — dismisses every unacknowledged
 * notification belonging to the current user in a single
 * round-trip. The banner uses this so the "Dismiss" button
 * hides the banner permanently instead of cycling through
 * one notification per click (Greptile P2).
 */
export function useAcknowledgeAllRecordingRetentionNotifications() {
  const queryClient = useQueryClient();

  const mutationFn = useConvexMutation(
    api.recordingRetention.acknowledgeAllRecordingRetentionNotifications
  );

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: [
        "recordingRetentionNotifications",
        "unacknowledged",
      ],
    });
  }, [queryClient]);

  return useMutation({
    mutationFn: async () => {
      await mutationFn({});
    },
    onSuccess: invalidate,
  });
}
