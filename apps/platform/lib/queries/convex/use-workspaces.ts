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
export interface WorkspaceExport {
  _id: Id<"workspaceExports">;
  workspaceId: Id<"workspaces">;
  userId: string;
  format: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  downloadUrl?: string;
  expiresAt?: number;
  createdAt: number;
}

/**
 * Fetches export jobs for a specific workspace.
 * Returns the 10 most recent exports in descending order by creation time.
 */
export function useWorkspaceExports(workspaceId: Id<"workspaces">) {
  return useQuery({
    ...convexQuery(api.workspaces.getWorkspaceExports, { workspaceId }),
    enabled: !!workspaceId,
  });
}

/**
 * Mutation hook for creating a workspace export job (ZIP, PDF, or Markdown).
 * Triggers a background task to prepare the export file.
 */
export function useCreateWorkspaceExport() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.workspaces.createWorkspaceExport),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspaceExports"] });
    },
  });
}

/**
 * Represents a retention warning notification for workspace deletion.
 */
export interface RetentionNotification {
  _id: Id<"workspaceRetentionNotifications">;
  workspaceId: Id<"workspaces">;
  userId: string;
  notificationType: 'expiry_warning' | 'deleted';
  sentAt: number;
  acknowledgedAt?: number;
}

/**
 * Fetches unacknowledged retention notifications for workspace deletion warnings.
 * These are warnings sent at 90, 30, and 7 days before workspace deletion.
 */
export function useUnacknowledgedRetentionNotifications() {
  return useQuery({
    ...convexQuery(api.workspaces.getUnacknowledgedRetentionNotifications, {}),
  });
}

/**
 * Mutation hook for acknowledging a retention notification.
 * Marks the notification as seen by the user to hide the warning banner.
 */
export function useAcknowledgeRetentionNotification() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.workspaces.acknowledgeNotification),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["unacknowledgedRetentionNotifications"] });
    },
  });
}