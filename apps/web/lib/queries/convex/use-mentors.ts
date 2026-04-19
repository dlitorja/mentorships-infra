import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";

export function useMentorByUserId(userId: string) {
  return useQuery({
    ...convexQuery(api.mentors.getMentorByUserId, { userId }),
    enabled: !!userId,
  });
}

export function useMentorById(id: Id<"mentors">) {
  return useQuery({
    ...convexQuery(api.mentors.getMentorById, { id }),
    enabled: !!id,
  });
}

export function useListMentors() {
  return useQuery({
    ...convexQuery(api.mentors.listMentors, {}),
  });
}

export function useActiveMentors() {
  return useQuery({
    ...convexQuery(api.mentors.getActiveMentors, {}),
  });
}

export function useDecrementInventory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.mentors.decrementInventory),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mentors"] });
    },
  });
}

export function useIncrementInventory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.mentors.incrementInventory),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mentors"] });
    },
  });
}

export function useUpdateMentor() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.mentors.updateMentor),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mentors"] });
    },
  });
}

export function useCreateMentor() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.mentors.createMentor),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mentors"] });
    },
  });
}

export function useDeleteMentor() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.mentors.deleteMentor),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mentors"] });
    },
  });
}