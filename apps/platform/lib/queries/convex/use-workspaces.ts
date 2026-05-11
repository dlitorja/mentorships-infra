"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

export function useWorkspace(id: string) {
  return useQuery({
    ...convexQuery(api.workspaces.getWorkspaceById, { id: id as Id<"workspaces"> }),
    enabled: !!id,
  });
}

export function useWorkspacesByOwner(ownerId: string) {
  return useQuery({
    ...convexQuery(api.workspaces.getUserWorkspaces, { ownerId }),
    enabled: !!ownerId,
  });
}

export function useWorkspacesByInstructor(instructorId: string) {
  return useQuery({
    ...convexQuery(api.workspaces.getInstructorWorkspaces, { mentorId: instructorId as Id<"instructors"> }),
    enabled: !!instructorId,
  });
}

export function useWorkspaceMessages(workspaceId: string) {
  return useQuery({
    ...convexQuery(api.workspaces.getWorkspaceMessages, { workspaceId: workspaceId as Id<"workspaces"> }),
    enabled: !!workspaceId,
  });
}

export function useWorkspaceNotes(workspaceId: string) {
  return useQuery({
    ...convexQuery(api.workspaces.getWorkspaceNotes, { workspaceId: workspaceId as Id<"workspaces"> }),
    enabled: !!workspaceId,
  });
}

export function useWorkspaceLinks(workspaceId: string) {
  return useQuery({
    ...convexQuery(api.workspaces.getWorkspaceLinks, { workspaceId: workspaceId as Id<"workspaces"> }),
    enabled: !!workspaceId,
  });
}

export function useWorkspaceImages(workspaceId: string) {
  return useQuery({
    ...convexQuery(api.workspaces.getWorkspaceImages, { workspaceId: workspaceId as Id<"workspaces"> }),
    enabled: !!workspaceId,
  });
}

export function useAllWorkspaces() {
  return { data: [] as any[] };
}

// Mutations

export function useCreateWorkspaceMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.workspaces.createWorkspaceMessage),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspaceMessages"] });
    },
  });
}

export function useCreateWorkspaceNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.workspaces.createWorkspaceNote),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspaceNotes"] });
    },
  });
}

export function useUpdateWorkspaceNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.workspaces.updateWorkspaceNote),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspaceNotes"] });
    },
  });
}

export function useDeleteWorkspaceNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.workspaces.deleteWorkspaceNote),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspaceNotes"] });
    },
  });
}

export function useCreateWorkspaceLink() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.workspaces.createWorkspaceLink),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspaceLinks"] });
    },
  });
}

export function useDeleteWorkspaceLink() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.workspaces.deleteWorkspaceLink),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspaceLinks"] });
    },
  });
}

export function useCreateWorkspaceImage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.workspaces.createWorkspaceImage),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspaceImages"] });
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
    },
  });
}

export function useDeleteWorkspaceImage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.workspaces.deleteWorkspaceImage),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspaceImages"] });
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
    },
  });
}

export function useCreateWorkspace() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.workspaces.createWorkspace),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
    },
  });
}

export function useUpdateWorkspace() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.workspaces.updateWorkspace),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
    },
  });
}

interface WorkspaceExport {
  _id: string;
  workspaceId: string;
  userId: string;
  format: string;
  status: 'pending' | 'processing' | 'completed';
  downloadUrl?: string;
  createdAt: number;
}

export function useWorkspaceExports(_workspaceId: string) {
  return { data: [] as WorkspaceExport[] };
}

export function useCreateWorkspaceExport() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (vars: { workspaceId: string; userId: string; format: "pdf" | "markdown" | "zip" }) => {
      throw new Error("Not implemented: createWorkspaceExport not available in platform Convex API");
    },
    onError: (error) => {
      console.error("useCreateWorkspaceExport error:", error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspaceExports"] });
    },
  });
}

interface RetentionNotification {
  _id: string;
  workspaceId: string;
  notificationType: string;
}

export function useUnacknowledgedRetentionNotifications() {
  return { data: [] as RetentionNotification[] };
}

export function useAcknowledgeRetentionNotification() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (vars: { id: string }) => {
      throw new Error("Not implemented");
    },
    onError: (error) => {
      console.error("useAcknowledgeRetentionNotification error:", error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["retentionNotifications"] });
    },
  });
}