"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Id } from "@/convex/_generated/dataModel";
import { deleteDailyRecording } from "@/lib/queries/api-client";

/**
 * Re-runs only the Daily-side delete for a recording whose B2 copy is
 * already `ready` but whose Daily source still exists
 * (`recordingDailyCleanupStatus === "failed"`).
 *
 * Invalidates the workspace recordings query on success so the card
 * reflects the new cleanup state.
 */
export function useRecordingCleanupRetry(sessionId: Id<"sessions">): {
  cleanup: () => void;
  isPending: boolean;
  error: Error | null;
} {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (): Promise<void> => {
      await deleteDailyRecording(sessionId);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["convexQuery", "sessions.getCallRecordingsForWorkspace"],
      });
    },
  });

  return {
    cleanup: () => mutation.mutate(),
    isPending: mutation.isPending,
    error: mutation.error instanceof Error ? mutation.error : null,
  };
}
