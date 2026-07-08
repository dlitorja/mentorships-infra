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
 * PR #4c-3: fetches links tagged to the currently active video-call
 * session. Drives the "Shared during current call" subpanel that
 * appears above the existing Links list while a call is active.
 *
 * `enabled` gates on `sessionId` so the query never fires with a
 * `null` sessionId (which the Convex `v.id("sessions")` validator
 * would reject). The `sessionId as Id<"sessions">` cast is safe
 * behind the `enabled` guard.
 */
export function useSharedLinksForActiveSession(
  workspaceId: string,
  sessionId: string | null,
) {
  return useQuery({
    ...convexQuery(api.workspaces.getSharedLinksForActiveSession, {
      workspaceId: workspaceId as Id<"workspaces">,
      sessionId: sessionId as Id<"sessions">,
    }),
    enabled: !!workspaceId && !!sessionId,
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
 * Creates a new chat message. Convex subscriptions update matching queries.
 *
 * Pass `sessionId` when posting during an active video call — the
 * message is then auto-tagged to that session for the Chat tab
 * in-call banner.
 */
export function useCreateWorkspaceMessage() {
  return useMutation({
    mutationFn: useConvexMutation(api.workspaces.createWorkspaceMessage),
  });
}

/**
 * Mutation hook for creating a new note in a workspace.
 * Refetches workspace notes queries on success to refresh note list.
 *
 * Pass `sessionId` when posting during an active video call — the
 * note is then auto-tagged to that session for the Notes tab.
 */
export function useCreateWorkspaceNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.workspaces.createWorkspaceNote),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["convexQuery", "workspaces.getWorkspaceNotes"],
      });
    },
  });
}

/**
 * Mutation hook for updating an existing workspace note.
 * Refetches workspace notes queries on success to refresh data.
 *
 * Pass `clearSessionId: true` from the "Tag to current call" untag
 * toggle to remove a note's `sessionId` while leaving title and
 * content untouched.
 */
export function useUpdateWorkspaceNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.workspaces.updateWorkspaceNote),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["convexQuery", "workspaces.getWorkspaceNotes"],
      });
    },
  });
}

/**
 * Fetches the single live session note for a given session, or null
 * if it has not yet been created. Used by the Notes tab to pin it
 * at the top while the call is active.
 *
 * PR #4b (Greptile R2 P2): the sentinel `"0000…01"` is required by
 * Convex's typed argument validator (sessionId must be an
 * `Id<"sessions">` string, not null). When `sessionId` is null the
 * sentinel is substituted solely to satisfy the type, and the
 * `enabled: false` flag prevents the request from being executed.
 * In current TanStack Query versions (4.x, 5.x) `enabled` and
 * `queryKey` are evaluated together, so the sentinel never reaches
 * the server. Greptile flagged this as potentially fragile under
 * future TanStack Query changes; the mitigation here is the
 * explicit, narrowly-scoped cast and the documented invariant
 * that the sentinel is dead client-side data.
 */
export function useLiveSessionNote(sessionId: string | null | undefined) {
  return useQuery({
    ...convexQuery(api.workspaces.getLiveSessionNote, {
      sessionId: (sessionId ?? "00000000000000000000000001") as Id<"sessions">,
    }),
    enabled: !!sessionId,
  });
}

/**
 * Mutation hook for deleting a workspace note.
 * Refetches workspace notes queries on success to refresh list.
 */
export function useDeleteWorkspaceNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.workspaces.deleteWorkspaceNote),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["convexQuery", "workspaces.getWorkspaceNotes"],
      });
    },
  });
}

/**
 * Represents a comment on a workspace note.
 */
export interface NoteComment {
  _id: Id<"workspaceNoteComments">;
  noteId: Id<"workspaceNotes">;
  content: string;
  createdBy: string;
  createdAt: number;
  deletedAt?: number;
  storageId?: string;
}

/**
 * Fetches all comments for a specific note.
 * Returns comments ordered by creation time.
 */
export function useNoteComments(noteId: Id<"workspaceNotes"> | null) {
  return useQuery({
    ...convexQuery(api.workspaces.getNoteComments, { 
      noteId: noteId ?? "00000000000000000000000001" as Id<"workspaceNotes">,
    }),
    enabled: !!noteId,
  });
}

/**
 * Mutation hook for creating a comment on a workspace note.
 * Both instructors and students can comment.
 */
export function useCreateNoteComment() {
  return useMutation({
    mutationFn: useConvexMutation(api.workspaces.createNoteComment),
  });
}

/**
 * Mutation hook for deleting a note comment.
 * Only the comment author can delete their own comments.
 */
export function useDeleteNoteComment() {
  return useMutation({
    mutationFn: useConvexMutation(api.workspaces.deleteNoteComment),
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
      queryClient.invalidateQueries({
        queryKey: ["convexQuery", "workspaces.getWorkspaceLinks"],
      });
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
      queryClient.invalidateQueries({
        queryKey: ["convexQuery", "workspaces.getWorkspaceLinks"],
      });
    },
  });
}

/**
 * Mutation hook for uploading an image to a workspace.
 * Convex subscriptions update matching image queries.
 */
export function useCreateWorkspaceImage() {
  return useMutation({
    mutationFn: useConvexMutation(api.workspaces.createWorkspaceImage),
  });
}

/**
 * Mutation hook for deleting an image from a workspace.
 * Convex subscriptions update matching image queries.
 */
export function useDeleteWorkspaceImage() {
  return useMutation({
    mutationFn: useConvexMutation(api.workspaces.deleteWorkspaceImage),
  });
}

/**
 * Mutation hook for creating an image AND a chat message in one call.
 * Used for uploading images directly to chat.
 */
export function useCreateWorkspaceImageAndMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.workspaces.createWorkspaceImageAndMessage),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["convexQuery", "workspaces.getWorkspaceImages"] });
    },
  });
}

/**
 * Mutation hook for creating a file chat message from an uploaded storage ID.
 * Used for uploading non-image files directly to chat.
 */
export function useCreateWorkspaceFileMessage() {
  return useMutation({
    mutationFn: useConvexMutation(api.workspaces.createWorkspaceFileMessage),
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
      queryClient.invalidateQueries({
        queryKey: ["convexQuery", "workspaces.getUserWorkspaces"],
      });
      queryClient.invalidateQueries({
        queryKey: ["convexQuery", "workspaces.getInstructorWorkspaces"],
      });
    },
  });
}

/**
 * Mutation hook for updating workspace settings or metadata.
 * Invalidates workspace detail and list queries on success.
 */
export function useUpdateWorkspace() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.workspaces.updateWorkspace),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["convexQuery", "workspaces.getWorkspaceById"],
      });
      queryClient.invalidateQueries({
        queryKey: ["convexQuery", "workspaces.getUserWorkspaces"],
      });
      queryClient.invalidateQueries({
        queryKey: ["convexQuery", "workspaces.getInstructorWorkspaces"],
      });
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
    refetchInterval: ((queryResult: { data?: { status: string }[] }) => {
      const latest = queryResult.data?.[0];
      return latest?.status === 'pending' || latest?.status === 'processing' ? 2000 : false;
    }) as unknown as (query: unknown) => number | false,
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
      queryClient.invalidateQueries({ queryKey: ["convexQuery", "workspaces.getWorkspaceExports"] });
    },
  });
}

/**
 * Mutation hook for cancelling a stuck workspace export.
 * Marks the export as failed so a new one can be started.
 */
export function useCancelWorkspaceExport() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.workspaces.cancelWorkspaceExport),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["convexQuery", "workspaces.getWorkspaceExports"] });
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

/**
 * Mutation hook for embedding an image in a workspace note.
 * Creates a workspaceImage record and updates the note's imageUrl.
 * Enforces instructor image caps.
 */
export function useEmbedImageInNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.workspaces.embedImageInNote),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["convexQuery", "workspaces.getWorkspaceImages"] });
      queryClient.invalidateQueries({ queryKey: ["convexQuery", "workspaces.getWorkspaceNotes"] });
    },
  });
}

export interface InstructorResource {
  _id: Id<"instructorResources">;
  instructorId: Id<"instructors">;
  workspaceId: Id<"workspaces">;
  storageId: Id<"_storage">;
  fileName: string;
  contentType: string;
  size: number;
  type: "image" | "file";
  createdAt: number;
  url: string | null;
  // PR #5: tags the resource to an active video-call session.
  // Drives the "Shared during current call" subpanel in the Links
  // tab. Undefined on resources created before PR #5 — those don't
  // appear in the subpanel (matches the documented pre-#4b links
  // limitation at workspaces.ts:917).
  sessionId?: Id<"sessions">;
}

/**
 * Fetches all instructor resources for a workspace.
 * Only returns resources for the current user's instructor in that workspace.
 */
export function useInstructorResources(workspaceId: string) {
  return useQuery({
    ...convexQuery(api.instructorResources.getInstructorResources, { workspaceId: workspaceId as Id<"workspaces"> }),
    enabled: !!workspaceId,
  });
}

/**
 * PR #5: fetches instructor resources tagged to the currently
 * active video-call session. Drives the resource side of the
 * "Shared during current call" subpanel that appears above the
 * Links list while a call is active. Role-agnostic — both
 * instructor and student can read; auth is enforced server-side by
 * `assertParticipantForSession`.
 *
 * `enabled` gates on `sessionId` so the query never fires with a
 * `null` sessionId (which the Convex `v.id("sessions")` validator
 * would reject). The `sessionId as Id<"sessions">` cast is safe
 * behind the `enabled` guard.
 */
export function useSharedResourcesForActiveSession(
  workspaceId: string,
  sessionId: string | null,
) {
  return useQuery({
    ...convexQuery(api.instructorResources.getSharedResourcesForActiveSession, {
      workspaceId: workspaceId as Id<"workspaces">,
      sessionId: sessionId as Id<"sessions">,
    }),
    enabled: !!workspaceId && !!sessionId,
  });
}

/**
 * Mutation hook for uploading a new instructor resource.
 * The caller should first get a signed upload URL from Convex storage
 * and upload the file before calling this mutation.
 */
export function useUploadInstructorResource() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.instructorResources.uploadInstructorResource),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["convexQuery", "instructorResources.getInstructorResources"] });
    },
  });
}

/**
 * Mutation hook for deleting an instructor resource.
 */
export function useDeleteInstructorResource() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.instructorResources.deleteInstructorResource),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["convexQuery", "instructorResources.getInstructorResources"] });
    },
  });
}

/**
 * PR #5: mutation hook for updating an instructor resource.
 * Refetches the instructor-resources list and the shared-during-call
 * subpanel query on success so the Tag/Untag toggle stays in sync
 * with the underlying data.
 *
 * Pass `clearSessionId: true` from the untag toggle to remove the
 * resource's `sessionId`. Mirror of `useUpdateWorkspaceNote`.
 */
export function useUpdateInstructorResource() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.instructorResources.updateInstructorResource),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["convexQuery", "instructorResources.getInstructorResources"] });
      queryClient.invalidateQueries({ queryKey: ["convexQuery", "instructorResources.getSharedResourcesForActiveSession"] });
    },
  });
}

/**
 * Mutation hook for sharing an instructor image resource to the workspace chat.
 * Also creates a workspaceImage record so it appears in the Images tab.
 */
export function useShareResourceToChat() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.instructorResources.shareResourceToChat),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["convexQuery", "instructorResources.getInstructorResources"] });
      queryClient.invalidateQueries({ queryKey: ["convexQuery", "workspaces.getWorkspaceMessages"] });
      queryClient.invalidateQueries({ queryKey: ["convexQuery", "workspaces.getWorkspaceImages"] });
    },
  });
}

/**
 * Mutation hook for embedding an instructor image resource in a workspace note.
 * Also creates a workspaceImage record and updates the note's imageUrl.
 */
export function useEmbedResourceInNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.instructorResources.embedResourceInNote),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["convexQuery", "instructorResources.getInstructorResources"] });
      queryClient.invalidateQueries({ queryKey: ["convexQuery", "workspaces.getWorkspaceImages"] });
      queryClient.invalidateQueries({ queryKey: ["convexQuery", "workspaces.getWorkspaceNotes"] });
    },
  });
}
