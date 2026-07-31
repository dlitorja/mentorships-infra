"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Id } from "@/convex/_generated/dataModel";
import { retryRecordingTransfer } from "@/lib/queries/api-client";

/**
 * Re-triggers the Daily → B2 recording transfer for a session and
 * invalidates the workspace recordings query on success so the UI
 * reflects the new transfer status.
 *
 * The mutation POSTs to `/api/video/recording/{sessionId}/retry` and
 * validates the error payload with zod instead of trusting the runtime
 * shape.
 */
export function useRecordingRetry(sessionId: Id<"sessions">): {
  retry: () => void;
  isPending: boolean;
  error: Error | null;
} {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (): Promise<void> => {
      await retryRecordingTransfer(sessionId);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["convexQuery", "sessions.getCallRecordingsForWorkspace"],
      });
    },
  });

  return {
    retry: () => mutation.mutate(),
    isPending: mutation.isPending,
    error: mutation.error instanceof Error ? mutation.error : null,
  };
}
