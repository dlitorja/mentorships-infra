"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

export function useSessionPack(id: string) {
  return useQuery({
    ...convexQuery(api.sessionPacks.getSessionPackById, { id: id as Id<"sessionPacks"> }),
    enabled: !!id,
  });
}

export function useSessionPacksByUser(userId: string) {
  return useQuery({
    ...convexQuery(api.sessionPacks.getUserSessionPacks, { userId }),
    enabled: !!userId,
  });
}

export function useActiveSessionPacksByUser(userId: string) {
  return useQuery({
    ...convexQuery(api.sessionPacks.getUserActiveSessionPacks, { userId }),
    enabled: !!userId,
  });
}

export function useSessionPacksByInstructor(instructorId: string) {
  return useQuery({
    ...convexQuery(api.sessionPacks.getInstructorSessionPacks, { instructorId: instructorId as Id<"instructors"> }),
    enabled: !!instructorId,
  });
}

export function useWorkspaceBySessionPack(_sessionPackId: string) {
  return { data: null };
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
    mutationFn: useConvexMutation(api.sessionPacks.createSessionPack),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sessionPacks"] });
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
    },
  });
}

export function useUpdateSessionPack() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.sessionPacks.updateSessionPack),
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
    mutationFn: useConvexMutation(api.sessionPacks.processExpiredSessionPacks),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sessionPacks"] });
    },
  });
}