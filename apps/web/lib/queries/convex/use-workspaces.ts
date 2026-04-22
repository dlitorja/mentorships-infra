import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";

export function useWorkspace(id: Id<"workspaces">) {
  return useQuery({
    ...convexQuery(api.workspaces.getWorkspaceById, { id }),
    enabled: !!id,
  });
}

export function useUserWorkspaces(ownerId: string) {
  return useQuery({
    ...convexQuery(api.workspaces.getUserWorkspaces, { ownerId }),
    enabled: !!ownerId,
  });
}

export function useInstructorWorkspaces(mentorId: Id<"instructors">) {
  return useQuery({
    ...convexQuery(api.workspaces.getMentorWorkspaces, { mentorId }),
    enabled: !!mentorId,
  });
}

export function useWorkspaceBySeatReservation(seatReservationId: Id<"seatReservations">) {
  return useQuery({
    ...convexQuery(api.workspaces.getWorkspaceBySeatReservation, { seatReservationId }),
    enabled: !!seatReservationId,
  });
}

export function useWorkspaceRole(workspaceId: Id<"workspaces">) {
  return useQuery({
    ...convexQuery(api.workspaces.getUserWorkspaceRole, { workspaceId }),
    enabled: !!workspaceId,
  });
}

export function useWorkspaceNotes(workspaceId: Id<"workspaces">) {
  return useQuery({
    ...convexQuery(api.workspaces.getWorkspaceNotes, { workspaceId }),
    enabled: !!workspaceId,
  });
}

export function useWorkspaceLinks(workspaceId: Id<"workspaces">) {
  return useQuery({
    ...convexQuery(api.workspaces.getWorkspaceLinks, { workspaceId }),
    enabled: !!workspaceId,
  });
}

export function useWorkspaceImages(workspaceId: Id<"workspaces">) {
  return useQuery({
    ...convexQuery(api.workspaces.getWorkspaceImages, { workspaceId }),
    enabled: !!workspaceId,
  });
}

export function useWorkspaceMessages(workspaceId: Id<"workspaces">) {
  return useQuery({
    ...convexQuery(api.workspaces.getWorkspaceMessages, { workspaceId }),
    enabled: !!workspaceId,
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

export function useDeleteWorkspace() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.workspaces.deleteWorkspace),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
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

export function useCreateWorkspaceMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.workspaces.createWorkspaceMessage),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspaceMessages"] });
    },
  });
}

export function useCreateWorkspaceExport() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.workspaces.createWorkspaceExport),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspaceExports"] });
    },
  });
}

export function useWorkspaceExports(workspaceId: Id<"workspaces">) {
  return useQuery({
    ...convexQuery(api.workspaces.getWorkspaceExports, { workspaceId }),
    enabled: !!workspaceId,
  });
}
