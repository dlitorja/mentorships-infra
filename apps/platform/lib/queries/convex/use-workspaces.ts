"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

/**
 * Fetches a single workspace by ID.
 * Returns the query result object where data is undefined while loading
 * or when the workspace is not found.
 */
export function useWorkspace(id: string) {
  return useQuery({
    ...convexQuery(api.workspaces.getWorkspaceById, { id: id as Id<"workspaces"> }),
    enabled: !!id,
  });
}

/**
 * Fetches all workspaces owned by a specific user.
 * Used on dashboard pages to display user's workspaces.
 */
export function useWorkspacesByOwner(ownerId: string) {
  return useQuery({
    ...convexQuery(api.workspaces.getUserWorkspaces, { ownerId }),
    enabled: !!ownerId,
  });
}

/**
 * Fetches all workspaces associated with a specific instructor.
 * Includes workspaces created by the instructor and any shared with them.
 */
export function useWorkspacesByInstructor(instructorId: string) {
  return useQuery({
    ...convexQuery(api.workspaces.getInstructorWorkspaces, { instructorId: instructorId as Id<"instructors"> }),
    enabled: !!instructorId,
  });
}

/**
 * Fetches all chat messages for a workspace.
 * Messages are returned in chronological order.
 */
export function useWorkspaceMessages(workspaceId: string) {
  return useQuery({
    ...convexQuery(api.workspaces.getWorkspaceMessages, { workspaceId: workspaceId as Id<"workspaces"> }),
    enabled: !!workspaceId,
  });
}

/**
 * Fetches all notes for a workspace.
 * Used in the Notes tab of the workspace page.
 */
export function useWorkspaceNotes(workspaceId: string) {
  return useQuery({
    ...convexQuery(api.workspaces.getWorkspaceNotes, { workspaceId: workspaceId as Id<"workspaces"> }),
    enabled: !!workspaceId,
  });
}

/**
 * Fetches all shared links for a workspace.
 * Used in the Links section of the workspace.
 */
export function useWorkspaceLinks(workspaceId: string) {
  return useQuery({
    ...convexQuery(api.workspaces.getWorkspaceLinks, { workspaceId: workspaceId as Id<"workspaces"> }),
    enabled: !!workspaceId,
  });
}

/**
 * Fetches all images for a workspace.
 * Used in the Images tab of the workspace page.
 */
export function useWorkspaceImages(workspaceId: string) {
  return useQuery({
    ...convexQuery(api.workspaces.getWorkspaceImages, { workspaceId: workspaceId as Id<"workspaces"> }),
    enabled: !!workspaceId,
  });
}

/**
 * Stub: returns empty array as workspace fetching is not yet implemented.
 * When real fetching is added, this will fetch all workspaces for admin dashboard.
 */
export function useAllWorkspaces() {
  return { data: [] as any[] };
}

// Mutations

/**
 * Mutation hook for creating a new chat message in a workspace.
 * Invalidates workspace messages queries on success to refresh chat.
 */
export function useCreateWorkspaceMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.workspaces.createWorkspaceMessage),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspaceMessages"] });
    },
  });
}

/**
 * Mutation hook for creating a new note in a workspace.
 * Invalidates workspace notes queries on success to refresh note list.
 */
export function useCreateWorkspaceNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.workspaces.createWorkspaceNote),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspaceNotes"] });
    },
  });
}

/**
 * Mutation hook for updating an existing workspace note.
 * Invalidates workspace notes queries on success to refresh data.
 */
export function useUpdateWorkspaceNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.workspaces.updateWorkspaceNote),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspaceNotes"] });
    },
  });
}

/**
 * Mutation hook for deleting a workspace note.
 * Invalidates workspace notes queries on success to refresh list.
 */
export function useDeleteWorkspaceNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.workspaces.deleteWorkspaceNote),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspaceNotes"] });
    },
  });
}

/**
 * Mutation hook for creating a shared link in a workspace.
 * Invalidates workspace links queries on success to refresh list.
 */
export function useCreateWorkspaceLink() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.workspaces.createWorkspaceLink),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspaceLinks"] });
    },
  });
}

/**
 * Mutation hook for deleting a shared link from a workspace.
 * Invalidates workspace links queries on success to refresh list.
 */
export function useDeleteWorkspaceLink() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.workspaces.deleteWorkspaceLink),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspaceLinks"] });
    },
  });
}

/**
 * Mutation hook for uploading an image to a workspace.
 * Invalidates workspace images and workspace queries on success.
 */
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

/**
 * Mutation hook for deleting an image from a workspace.
 * Invalidates workspace images and workspace queries on success.
 */
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

/**
 * Mutation hook for creating a new workspace.
 * Invalidates workspaces queries on success to refresh list.
 */
export function useCreateWorkspace() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.workspaces.createWorkspace),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
    },
  });
}

/**
 * Mutation hook for updating workspace settings or metadata.
 * Invalidates workspaces queries on success to refresh data.
 */
export function useUpdateWorkspace() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.workspaces.updateWorkspace),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
    },
  });
}

/**
 * Represents a workspace export job (ZIP, PDF, or Markdown).
 */
interface WorkspaceExport {
  _id: string;
  workspaceId: string;
  userId: string;
  format: string;
  status: 'pending' | 'processing' | 'completed';
  downloadUrl?: string;
  createdAt: number;
}

/**
 * Fetches export jobs for a specific workspace.
 * Returns empty array as export functionality is not yet implemented.
 */
export function useWorkspaceExports(_workspaceId: string) {
  return { data: [] as WorkspaceExport[] };
}

/**
 * Mutation hook for creating a workspace export job (ZIP, PDF, or Markdown).
 * Currently throws error as Convex API is not available.
 */
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

/**
 * Represents a retention warning notification for workspace deletion.
 */
interface RetentionNotification {
  _id: string;
  workspaceId: string;
  notificationType: string;
}

/**
 * Fetches unacknowledged retention notifications for workspace deletion warnings.
 * Returns empty array as retention notifications are not yet implemented.
 */
export function useUnacknowledgedRetentionNotifications() {
  return { data: [] as RetentionNotification[] };
}

/**
 * Mutation hook for acknowledging a retention notification.
 * Marks the notification as seen by the user.
 * Currently throws error as Convex API is not available.
 */
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