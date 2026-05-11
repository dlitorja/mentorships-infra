"use client";

import { useQuery } from "@convex-dev/react-query";

export function useSessionPacksByUser(userId: string) {
  return useQuery("sessionPacks:listByUser", { userId });
}

export function useActiveSessionPacksByUser(userId: string) {
  return useQuery("sessionPacks:listActiveByUser", { userId });
}

export function useSessionPack(id: string) {
  return useQuery("sessionPacks:getById", { id: id as any });
}

export function useWorkspaceBySessionPack(sessionPackId: string) {
  return useQuery("sessionPacks:getWorkspaceBySessionPack", { sessionPackId: sessionPackId as any });
}

export function useUserTotalRemainingSessions(userId: string) {
  return useQuery("sessionPacks:getUserTotalRemainingSessions", { userId });
}