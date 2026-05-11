"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";

export function useWorkspace(id: string) {
  return useQuery({
    ...convexQuery(api.workspaces.getById, { id: id as Id<"workspaces"> }),
    enabled: !!id,
  });
}

export function useWorkspacesByOwner(ownerId: string) {
  return useQuery({
    ...convexQuery(api.workspaces.listByOwner, { ownerId }),
    enabled: !!ownerId,
  });
}

export function useWorkspacesByInstructor(instructorId: string) {
  return useQuery({
    ...convexQuery(api.workspaces.listByInstructor, { instructorId: instructorId as Id<"instructors"> }),
    enabled: !!instructorId,
  });
}

export function useWorkspaceMessages(workspaceId: string) {
  return useQuery({
    ...convexQuery(api.workspaces.listMessages, { workspaceId: workspaceId as Id<"workspaces"> }),
    enabled: !!workspaceId,
  });
}

export function useWorkspaceNotes(workspaceId: string) {
  return useQuery({
    ...convexQuery(api.workspaces.listNotes, { workspaceId: workspaceId as Id<"workspaces"> }),
    enabled: !!workspaceId,
  });
}

export function useWorkspaceLinks(workspaceId: string) {
  return useQuery({
    ...convexQuery(api.workspaces.listLinks, { workspaceId: workspaceId as Id<"workspaces"> }),
    enabled: !!workspaceId,
  });
}

export function useWorkspaceImages(workspaceId: string) {
  return useQuery({
    ...convexQuery(api.workspaces.listImages, { workspaceId: workspaceId as Id<"workspaces"> }),
    enabled: !!workspaceId,
  });
}

export function useAllWorkspaces() {
  return useQuery({
    ...convexQuery(api.workspaces.listAll, {}),
  });
}

// Mutations

export function useCreateWorkspaceMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.workspaces.sendMessage),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspaceMessages"] });
    },
  });
}

export function useCreateWorkspaceNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.workspaces.createNote),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspaceNotes"] });
    },
  });
}

export function useUpdateWorkspaceNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.workspaces.updateNote),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspaceNotes"] });
    },
  });
}

export function useDeleteWorkspaceNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.workspaces.deleteNote),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspaceNotes"] });
    },
  });
}

export function useCreateWorkspaceLink() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.workspaces.createLink),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspaceLinks"] });
    },
  });
}

export function useDeleteWorkspaceLink() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.workspaces.deleteLink),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspaceLinks"] });
    },
  });
}

export function useCreateWorkspaceImage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.workspaces.uploadImage),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspaceImages"] });
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
    },
  });
}

export function useDeleteWorkspaceImage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.workspaces.deleteImage),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspaceImages"] });
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
    },
  });
}

export function useCreateWorkspace() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.workspaces.create),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
    },
  });
}

export function useUpdateWorkspace() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.workspaces.update),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
    },
  });
}

// Stub hooks for workspace exports (not implemented in apps/platform MVP)
export function useWorkspaceExports(_workspaceId: string) {
  return { data: [] };
}

export function useCreateWorkspaceExport() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.workspaces.create as any),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspaceExports"] });
    },
  });
}