"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";

export function useSessionPack(id: string) {
  return useQuery({
    ...convexQuery(api.sessionPacks.getById, { id: id as Id<"sessionPacks"> }),
    enabled: !!id,
  });
}

export function useSessionPacksByUser(userId: string) {
  return useQuery({
    ...convexQuery(api.sessionPacks.listByUser, { userId }),
    enabled: !!userId,
  });
}

export function useActiveSessionPacksByUser(userId: string) {
  return useQuery({
    ...convexQuery(api.sessionPacks.listActiveByUser, { userId }),
    enabled: !!userId,
  });
}

export function useSessionPacksByInstructor(instructorId: string) {
  return useQuery({
    ...convexQuery(api.sessionPacks.listByInstructor, { instructorId: instructorId as Id<"instructors"> }),
    enabled: !!instructorId,
  });
}

export function useWorkspaceBySessionPack(sessionPackId: string) {
  return useQuery({
    ...convexQuery(api.sessionPacks.getWorkspaceBySessionPack, { sessionPackId: sessionPackId as Id<"sessionPacks"> }),
    enabled: !!sessionPackId,
  });
}

export function useUserTotalRemainingSessions(userId: string) {
  return useQuery({
    ...convexQuery(api.sessionPacks.getUserTotalRemainingSessions, { userId }),
    enabled: !!userId,
  });
}

export function useCreateSessionPack() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.sessionPacks.create),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sessionPacks"] });
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
    },
  });
}

export function useUpdateSessionPack() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.sessionPacks.update),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sessionPacks"] });
    },
  });
}

export function useUseSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.sessionPacks.useSession),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sessionPacks"] });
    },
  });
}

export function useProcessExpiredSessionPacks() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.sessionPacks.processExpired),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sessionPacks"] });
    },
  });
}