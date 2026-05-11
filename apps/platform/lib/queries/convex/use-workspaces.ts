"use client";

import { useQuery } from "@convex-dev/react-query";

export function useWorkspacesByOwner(ownerId: string) {
  return useQuery("workspaces:listByOwner", { ownerId });
}

export function useWorkspacesByInstructor(instructorId: string) {
  return useQuery("workspaces:listByInstructor", { instructorId: instructorId as any });
}

export function useWorkspace(id: string) {
  return useQuery("workspaces:getById", { id: id as any });
}

export function useWorkspaceMessages(workspaceId: string) {
  return useQuery("workspaces:listMessages", { workspaceId: workspaceId as any });
}

export function useWorkspaceNotes(workspaceId: string) {
  return useQuery("workspaces:listNotes", { workspaceId: workspaceId as any });
}

export function useWorkspaceLinks(workspaceId: string) {
  return useQuery("workspaces:listLinks", { workspaceId: workspaceId as any });
}

export function useWorkspaceImages(workspaceId: string) {
  return useQuery("workspaces:listImages", { workspaceId: workspaceId as any });
}

export function useAllWorkspaces() {
  return useQuery("workspaces:listAll");
}