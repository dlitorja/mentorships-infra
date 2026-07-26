"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type { Id } from "@/convex/_generated/dataModel";

const retryErrorResponseSchema = z.object({
  error: z.string().optional(),
});

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
      const response = await fetch(
        `/api/video/recording/${sessionId}/retry`,
        {
          method: "POST",
          credentials: "include",
        }
      );
      if (!response.ok) {
        const raw = (await response.json().catch(() => ({}))) as unknown;
        const parsed = retryErrorResponseSchema.safeParse(raw);
        const message = parsed.success ? parsed.data.error : undefined;
        throw new Error(message ?? `Retry failed (HTTP ${response.status})`);
      }
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
