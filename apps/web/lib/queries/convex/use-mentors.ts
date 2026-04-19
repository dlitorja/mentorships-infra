import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
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
    mutationFn: async (args: { id: Id<"mentors">; type: "oneOnOne" | "group" }) => {
      return await api.mentors.decrementInventory(args);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mentors"] });
    },
  });
}

export function useIncrementInventory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (args: { id: Id<"mentors">; type: "oneOnOne" | "group" }) => {
      return await api.mentors.incrementInventory(args);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mentors"] });
    },
  });
}

export function useUpdateMentor() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (args: {
      id: Id<"mentors">;
      oneOnOneInventory?: number;
      groupInventory?: number;
      maxActiveStudents?: number;
      bio?: string;
      pricing?: string;
    }) => {
      return await api.mentors.updateMentor(args);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mentors"] });
    },
  });
}

export function useCreateMentor() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (args: {
      userId: string;
      oneOnOneInventory?: number;
      groupInventory?: number;
      maxActiveStudents?: number;
    }) => {
      return await api.mentors.createMentor(args);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mentors"] });
    },
  });
}

export function useDeleteMentor() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (args: { id: Id<"mentors"> }) => {
      return await api.mentors.deleteMentor(args);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mentors"] });
    },
  });
}