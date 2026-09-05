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
      // The Clerk webhook will eventually link userId to this instructor.
      // Refetching now surfaces the latest server state; once accepted, the
      // "Clerk Status" badge will flip to "Connected".
      queryClient.invalidateQueries({ queryKey: ["instructor", instructorId] });
    },
  });
}
