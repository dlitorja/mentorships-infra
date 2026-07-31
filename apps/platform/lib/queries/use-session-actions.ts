"use client";

import { useMutation } from "@tanstack/react-query";
import {
  rescheduleSession,
  cancelSession,
  updateSessionNotes,
} from "./api-client";

export type RescheduleSessionVariables = {
  sessionId: string;
  newScheduledAt: number;
};

export type CancelSessionVariables = {
  sessionId: string;
  reason?: string;
};

export type UpdateSessionNotesVariables = {
  sessionId: string;
  notes: string;
};

/**
 * Mutation hook for rescheduling a session.
 */
export function useRescheduleSession() {
  return useMutation({
    mutationFn: ({ sessionId, newScheduledAt }: RescheduleSessionVariables) =>
      rescheduleSession(sessionId, newScheduledAt),
  });
}

/**
 * Mutation hook for canceling a session.
 */
export function useCancelSession() {
  return useMutation({
    mutationFn: ({ sessionId, reason }: CancelSessionVariables) =>
      cancelSession(sessionId, reason),
  });
}

/**
 * Mutation hook for updating session notes.
 */
export function useUpdateSessionNotes() {
  return useMutation({
    mutationFn: ({ sessionId, notes }: UpdateSessionNotesVariables) =>
      updateSessionNotes(sessionId, notes),
  });
}
