"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

/**
 * Fetches a single session pack by ID.
 * @param {string} id - The session pack ID
 * @returns {UseQueryResult} Query result containing the session pack
 */
export function useSessionPack(id: string) {
  return useQuery({
    ...convexQuery(api.sessionPacks.getSessionPackById, { id: id as Id<"sessionPacks"> }),
    enabled: !!id,
  });
}

/**
 * Fetches all session packs for a specific user.
 * @param {string} userId - The user's ID
 * @returns {UseQueryResult} Query result containing the user's session packs
 */
export function useSessionPacksByUser(userId: string) {
  return useQuery({
    ...convexQuery(api.sessionPacks.getUserSessionPacks, { userId }),
    enabled: !!userId,
  });
}

/**
 * Fetches active session packs for a specific user.
 * @param {string} userId - The user's ID
 * @returns {UseQueryResult} Query result containing the user's active session packs
 */
export function useActiveSessionPacksByUser(userId: string) {
  return useQuery({
    ...convexQuery(api.sessionPacks.getUserActiveSessionPacks, { userId }),
    enabled: !!userId,
  });
}

/**
 * Fetches all session packs for a specific instructor.
 * @param {string} instructorId - The instructor's ID
 * @returns {UseQueryResult} Query result containing the instructor's session packs
 */
export function useSessionPacksByInstructor(instructorId: string) {
  return useQuery({
    ...convexQuery(api.sessionPacks.getInstructorSessionPacks, { instructorId: instructorId as Id<"instructors"> }),
    enabled: !!instructorId,
  });
}

export function useWorkspaceBySessionPack(_sessionPackId: string) {
  return { data: null };
}

/**
 * Fetches the total remaining sessions for a user across all session packs.
 * @param {string} userId - The user's ID
 * @returns {UseQueryResult} Query result containing the total remaining sessions count
 */
export function useUserTotalRemainingSessions(userId: string) {
  return useQuery({
    ...convexQuery(api.sessionPacks.getUserTotalRemainingSessions, { userId }),
    enabled: !!userId,
  });
}

/**
 * Mutation hook for creating a new session pack.
 * Invalidates session pack and workspace queries on success.
 */
export function useCreateSessionPack() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.sessionPacks.createSessionPack),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sessionPacks"] });
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
    },
  });
}

/**
 * Mutation hook for updating a session pack.
 * Invalidates session pack queries on success.
 */
export function useUpdateSessionPack() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.sessionPacks.updateSessionPack),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sessionPacks"] });
    },
  });
}

/**
 * Mutation hook for using a session from a session pack.
 * Invalidates session pack queries on success.
 */
export function useUseSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.sessionPacks.useSession),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sessionPacks"] });
    },
  });
}

/**
 * Mutation hook for processing expired session packs.
 * Invalidates session pack queries on success.
 */
export function useProcessExpiredSessionPacks() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.sessionPacks.processExpiredSessionPacks),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sessionPacks"] });
    },
  });
}