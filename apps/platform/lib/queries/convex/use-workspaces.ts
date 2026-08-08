"use client";

import { useQuery, useMutation, useQueryClient, type UseMutationResult, type UseQueryResult } from "@tanstack/react-query";
import { convexQuery, useConvexMutation, useConvexPaginatedQuery } from "@convex-dev/react-query";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { type UsePaginatedQueryReturnType } from "convex/react";
import { type FunctionReturnType } from "convex/server";

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
 *
 * Accepts `null` / `undefined` / `""` to disable the query, in which
 * case the underlying Convex subscription is short-circuited via
 * the `"skip"` arg sentinel (see `useLiveSessionNote` for the
 * rationale — `@convex-dev/react-query` ignores `enabled: false` on
 * the "added" observer event, so a sentinel-shaped workspaceId would
 * otherwise leak to the server and fail `v.id("workspaces")`
 * validation while still polluting TanStack Query's cache key).
 */
export function useWorkspaceMessages(
  workspaceId: string | null | undefined
) {
  return useQuery(
    convexQuery(
      api.workspaces.getWorkspaceMessages,
      workspaceId
        ? { workspaceId: workspaceId as Id<"workspaces"> }
        : "skip"
    )
  );
}

/**
 * Fetches a paginated list of chat messages for a workspace, newest first.
 * Use this in apps/platform; the legacy {@link useWorkspaceMessages} remains
 * for apps/web until it is migrated.
 *
 * The hook returns `results` in server order (newest first). The chat UI
 * should reverse the array so messages render oldest-first.
 *
 * Accepts `null` / `undefined` to disable the query via the `"skip"`
 * sentinel so the Convex subscription is short-circuited.
 */
export function useWorkspaceMessagesPaginated(
  workspaceId: string | null | undefined
) {
  return useConvexPaginatedQuery(
    api.workspaces.getWorkspaceMessagesPaginated,
    workspaceId
      ? { workspaceId: workspaceId as Id<"workspaces"> }
      : "skip",
    { initialNumItems: 50 }
  );
}

/**
 * Fetches the exact per-role file message counts for a workspace.
 *
 * PR #convex-egress-1: replaces the client-side count that was based on
 * the loaded paginated slice. The server uses a narrow index so the
 * count is cheap and accurate even when the chat history is large.
 *
 * Accepts `null` / `undefined` to disable the query via the `"skip"`
 * sentinel.
 */
export function useWorkspaceFileCounts(
  workspaceId: string | null | undefined
) {
  return useQuery(
    convexQuery(
      api.workspaces.getWorkspaceFileCounts,
      workspaceId
        ? { workspaceId: workspaceId as Id<"workspaces"> }
        : "skip"
    )
  );
}

/**
 * Fetches a paginated metadata-only list of notes for a workspace.
 * Used in the Notes tab and the resource "embed in note" dialog.
 *
 * PR #convex-egress-2: returns only the fields needed for the list
 * (`_id`, `title`, `updatedAt`, `createdBy`, `sessionId`,
 * `isLiveSessionNote`, `deletedAt`). Full TipTap content is loaded
 * separately via {@link useWorkspaceNoteById} when a note is selected.
 *
 * Notes are returned newest-first; the UI can load older notes via
 * `loadMore(50)`. Callers should pass `null` / `undefined` to disable
 * the query via the `"skip"` sentinel.
 */
export function useWorkspaceNotesPaginated(
  workspaceId: Id<"workspaces"> | null | undefined
): UsePaginatedQueryReturnType<typeof api.workspaces.getWorkspaceNotesPaginated> {
  return useConvexPaginatedQuery(
    api.workspaces.getWorkspaceNotesPaginated,
    workspaceId ? { workspaceId } : "skip",
    { initialNumItems: 50 }
  );
}

/**
 * Fetches the full workspace note for a given ID, including TipTap
 * `content`.
 *
 * PR #convex-egress-2: used by the Notes tab to load note content only
 * after the user selects a note from the metadata-only list.
 *
 * Callers should pass `null` / `undefined` to disable the query via the
 * `"skip"` sentinel.
 */
export function useWorkspaceNoteById(
  noteId: Id<"workspaceNotes"> | null | undefined
): UseQueryResult<FunctionReturnType<typeof api.workspaces.getWorkspaceNoteById>> {
  return useQuery(
    convexQuery(
      api.workspaces.getWorkspaceNoteById,
      noteId ? { noteId } : "skip"
    )
  );
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

/**
 * Fetches a paginated list of links for a workspace, newest first.
 * Use this in apps/platform; the legacy {@link useWorkspaceLinks} remains
 * for apps/web.
 *
 * PR #convex-egress-3: replaces the unbounded `getWorkspaceLinks`
 * subscription in apps/platform to reduce Convex Data Egress.
 */
export function useWorkspaceLinksPaginated(
  workspaceId: Id<"workspaces"> | null | undefined
): UsePaginatedQueryReturnType<typeof api.workspaces.getWorkspaceLinksPaginated> {
  return useConvexPaginatedQuery(
    api.workspaces.getWorkspaceLinksPaginated,
    workspaceId ? { workspaceId } : "skip",
    { initialNumItems: 50 }
  );
}

/**
 * A workspace image document plus the signed imageUrl returned by the
 * paginated query.
 */
export type WorkspaceImage = FunctionReturnType<
  typeof api.workspaces.getWorkspaceImagesPaginated
>["page"][number];

/**
 * Return type for {@link useWorkspaceImagesPaginated} with a strongly-typed
 * results array.
 */
export type UseWorkspaceImagesPaginatedReturnType = Omit<
  UsePaginatedQueryReturnType<typeof api.workspaces.getWorkspaceImagesPaginated>,
  "results"
> & { results: WorkspaceImage[] };

/**
 * Fetches a paginated list of images for a workspace, newest first.
 * Use this in apps/platform; the legacy {@link useWorkspaceImages} remains
 * for apps/web.
 *
 * PR #convex-egress-3: replaces the unbounded `getWorkspaceImages`
 * subscription in apps/platform to reduce Convex Data Egress.
 */
export function useWorkspaceImagesPaginated(
  workspaceId: Id<"workspaces"> | null | undefined,
  uploadedBy: "all" | "me" | "instructor" | "student" = "all"
): UseWorkspaceImagesPaginatedReturnType {
  return useConvexPaginatedQuery(
    api.workspaces.getWorkspaceImagesPaginated,
    workspaceId ? { workspaceId, uploadedBy } : "skip",
    { initialNumItems: 24 }
  ) as UseWorkspaceImagesPaginatedReturnType;
}

// Mutations

/**
 * Mutation hook for creating a new chat message in a workspace.
 *
 * The chat subscription is reactive, so the new message appears
 * automatically without an explicit invalidation. PR #convex-egress-1
 * removed the `getWorkspaceMessages` invalidation because it would
 * reset the paginated subscription state and re-fetch the entire
 * first page unnecessarily.
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
 *
 * PR #convex-egress-2: the paginated note list is a reactive Convex
 * subscription, so the new note appears automatically without an
 * explicit invalidation. Invalidating the list would reset pagination
 * state and re-fetch the first page unnecessarily.
 *
 * Pass `sessionId` when posting during an active video call — the
 * note is then auto-tagged to that session for the Notes tab.
 */
export function useCreateWorkspaceNote(): UseMutationResult<
  Id<"workspaceNotes">,
  Error,
  { workspaceId: Id<"workspaces">; title: string; content: string; sessionId?: Id<"sessions"> },
  unknown
> {
  return useMutation({
    mutationFn: useConvexMutation(api.workspaces.createWorkspaceNote),
  });
}

/**
 * Mutation hook for updating an existing workspace note.
 *
 * PR #convex-egress-2: the paginated note list and the note detail
 * query are reactive Convex subscriptions, so title/session changes and
 * auto-saved content appear automatically without an explicit
 * invalidation. Invalidating the list would reset pagination state and
 * re-fetch the first page unnecessarily.
 *
 * Pass `clearSessionId: true` from the "Tag to current call" untag
 * toggle to remove a note's `sessionId` while leaving title and
 * content untouched.
 */
export function useUpdateWorkspaceNote() {
  return useMutation({
    mutationFn: useConvexMutation(api.workspaces.updateWorkspaceNote),
  });
}

/**
 * Fetches the single live session note for a given session, or null
 * if it has not yet been created. Used by the Notes tab to pin it
 * at the top while the call is active.
 *
 * Uses the `"skip"` arg pattern instead of a sentinel +
 * `enabled: false`. `@convex-dev/react-query`'s `subscribeInner`
 * unconditionally calls `convexClient.watchQuery(func, args)` on
 * the React Query "added" event without honoring `enabled:
 * false`, so the sentinel-shaped string leaks through to the
 * server and fails `v.id("sessions")` validation. Passing
 * `"skip"` short-circuits the subscription entirely, which is
 * the library's documented disabled-query pattern.
 */
export function useLiveSessionNote(sessionId: string | null | undefined) {
  return useQuery(
    convexQuery(
      api.workspaces.getLiveSessionNote,
      sessionId ? { sessionId: sessionId as Id<"sessions"> } : "skip"
    )
  );
}

/**
 * Mutation hook for deleting a workspace note.
 *
 * PR #convex-egress-2: the paginated note list is a reactive Convex
 * subscription, so the deleted note disappears automatically without
 * an explicit invalidation. Invalidating the list would reset
 * pagination state and re-fetch the first page unnecessarily.
 */
export function useDeleteWorkspaceNote() {
  return useMutation({
    mutationFn: useConvexMutation(api.workspaces.deleteWorkspaceNote),
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
 *
 * Uses the `"skip"` arg pattern instead of a sentinel + `enabled:
 * false` so we don't risk sending a non-Id string to the server
 * (which would fail the `v.id("workspaceNotes")` validator).
 */
export function useNoteComments(noteId: Id<"workspaceNotes"> | null) {
  return useQuery(
    convexQuery(
      api.workspaces.getNoteComments,
      noteId ? { noteId } : "skip"
    )
  );
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
 *
 * PR #convex-egress-3: the paginated links subscription is reactive,
 * so the new link appears automatically without an explicit
 * invalidation. Invalidating it would reset pagination state and
 * re-fetch the first page unnecessarily.
 */
export function useCreateWorkspaceLink() {
  return useMutation({
    mutationFn: useConvexMutation(api.workspaces.createWorkspaceLink),
  });
}

/**
 * Mutation hook for deleting a shared link from a workspace.
 *
 * PR #convex-egress-3: the paginated links subscription is reactive,
 * so the deleted link is removed automatically without an explicit
 * invalidation.
 */
export function useDeleteWorkspaceLink() {
  return useMutation({
    mutationFn: useConvexMutation(api.workspaces.deleteWorkspaceLink),
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
 *
 * The chat and image subscriptions are reactive, so the new message and
 * image appear automatically without explicit invalidation. PR
 * #convex-egress-1 removed the `getWorkspaceMessages` invalidation
 * and PR #convex-egress-3 removed the `getWorkspaceImages`
 * invalidation to avoid resetting paginated subscription state.
 */
export function useCreateWorkspaceImageAndMessage() {
  return useMutation({
    mutationFn: useConvexMutation(api.workspaces.createWorkspaceImageAndMessage),
  });
}

/**
 * Mutation hook for creating a file chat message from an uploaded storage ID.
 * Used for uploading non-image files directly to chat.
 *
 * The chat subscription is reactive, so the new file message appears
 * automatically without an explicit invalidation. PR #convex-egress-1
 * removed the `getWorkspaceMessages` invalidation to avoid resetting
 * the paginated subscription state.
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
 *
 * PR #convex-egress-4: this is a live Convex subscription to
 * `workspaces.getWorkspaceExports`, so export status updates without
 * any polling. The previous `refetchInterval: 2000` was removed
 * because reactive queries already push changes as they happen.
 *
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
      queryClient.invalidateQueries({ queryKey: ["convexQuery", "workspaces.getWorkspaceExports"] });
    },
    onError: () => {
      // The mutation may still have inserted a failed export row, so refresh
      // the list so the user sees the errorMessage instead of a generic toast.
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
 *
 * PR #convex-egress-2: the paginated note list and note detail query
 * are reactive, so the embedded image appears automatically in the
 * selected note without invalidating the note list.
 *
 * PR #convex-egress-3: the paginated images subscription is reactive,
 * so the new image also appears in the Images tab without an explicit
 * invalidation.
 */
export function useEmbedImageInNote() {
  return useMutation({
    mutationFn: useConvexMutation(api.workspaces.embedImageInNote),
  });
}

export interface InstructorResource {
  _id: Id<"instructorResources">;
  _creationTime: number;
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
 *
 * The chat and images subscriptions are reactive, so the shared message
 * and image appear automatically without explicit invalidation. PR
 * #convex-egress-1 removed the `getWorkspaceMessages` invalidation
 * and PR #convex-egress-3 removed the `getWorkspaceImages`
 * invalidation to avoid resetting paginated subscription state.
 */
export function useShareResourceToChat() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.instructorResources.shareResourceToChat),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["convexQuery", "instructorResources.getInstructorResources"] });
    },
  });
}

/**
 * Mutation hook for embedding an instructor resource in a workspace note.
 * Also creates a workspaceImage record when the resource is an image.
 *
 * PR #convex-egress-2: the paginated note list and note detail query
 * are reactive, so the embedded resource appears automatically in the
 * selected note without invalidating the note list.
 *
 * PR #convex-egress-3: the paginated images subscription is reactive,
 * so the new image also appears in the Images tab without an explicit
 * invalidation.
 */
export function useEmbedResourceInNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.instructorResources.embedResourceInNote),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["convexQuery", "instructorResources.getInstructorResources"] });
    },
  });
}
