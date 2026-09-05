'use client';

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiRoutes } from "@/lib/routes";
import { ApiError } from "../types";

export interface SendInstructorInvitationResult {
  success: boolean;
  message: string;
  invitationId?: string;
  email?: string;
}

const ACCEPTANCE_REFRESH_DELAY_MS = 15_000;

async function sendInvitation(instructorId: string): Promise<SendInstructorInvitationResult> {
  const response = await fetch(ApiRoutes.adminInstructorInvite(instructorId), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });

  const result = await response.json();

  if (!response.ok) {
    throw new ApiError(
      result.error || "Failed to send invitation",
      result,
      response.status
    );
  }

  return result as SendInstructorInvitationResult;
}

export function useSendInstructorInvitation({
  instructorId,
}: {
  instructorId: string;
}) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => sendInvitation(instructorId),
    onSuccess: () => {
      // Immediate refresh: surfaces current server state.
      queryClient.invalidateQueries({ queryKey: ["instructor", instructorId] });
      // The Clerk webhook links userId to this instructor when the user accepts.
      // A short delayed refetch covers the common case where acceptance happens
      // within seconds; for slower acceptances the badge updates on the next
      // page load or after another edit + refetch.
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["instructor", instructorId] });
      }, ACCEPTANCE_REFRESH_DELAY_MS);
    },
  });
}
