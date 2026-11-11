"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

/**
 * ZIP archives of a student's onboarding artwork ("download all").
 *
 * Mirrors the workspace-export hooks: the Convex query is a live
 * subscription, so a reviewer watching the button sees the status flip
 * from `pending` → `processing` → `completed` without polling.
 */
export interface OnboardingArtworkExport {
  _id: Id<"onboardingArtworkExports">;
  _creationTime: number;
  onboardingId: Id<"adminOnboardings">;
  requestedBy: string;
  status: "pending" | "processing" | "completed" | "failed";
  downloadUrl?: string;
  expiresAt?: number;
  errorMessage?: string;
  fileCount?: number;
}

/** Latest artwork exports for an onboarding, newest first (max 5). */
export function useOnboardingArtworkExports(
  onboardingId: Id<"adminOnboardings"> | string | null | undefined
): UseQueryResult<OnboardingArtworkExport[], Error> {
  return useQuery({
    ...convexQuery(
      (api as any).onboardingArtworkExports.getOnboardingArtworkExports,
      onboardingId
        ? { onboardingId: onboardingId as Id<"adminOnboardings"> }
        : { onboardingId: "" as Id<"adminOnboardings"> }
    ),
    enabled: !!onboardingId,
  });
}

/** Creates a pending artwork export and triggers the ZIP task. */
export function useCreateOnboardingArtworkExport(): UseMutationResult<
  { exportId: Id<"onboardingArtworkExports">; errorMessage?: string },
  Error,
  { onboardingId: Id<"adminOnboardings"> }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: useConvexMutation(
      (api as any).onboardingArtworkExports.createOnboardingArtworkExport
    ) as any,
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["convexQuery", "onboardingArtworkExports.getOnboardingArtworkExports"],
      });
    },
    onError: () => {
      // The mutation may still have inserted a failed row, so refresh
      // the list to surface the errorMessage instead of a bare toast.
      queryClient.invalidateQueries({
        queryKey: ["convexQuery", "onboardingArtworkExports.getOnboardingArtworkExports"],
      });
    },
  });
}

/** Cancels an in-flight artwork export (marks it failed). */
export function useCancelOnboardingArtworkExport(): UseMutationResult<
  null,
  Error,
  { id: Id<"onboardingArtworkExports"> }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: useConvexMutation(
      (api as any).onboardingArtworkExports.cancelOnboardingArtworkExport
    ) as any,
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["convexQuery", "onboardingArtworkExports.getOnboardingArtworkExports"],
      });
    },
  });
}
