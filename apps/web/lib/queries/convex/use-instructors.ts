import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";

export function useInstructorByUserId(userId: string) {
  return useQuery({
    ...convexQuery(api.instructors.getInstructorByUserId, { userId }),
    enabled: !!userId,
  });
}

export function useInstructorById(id: Id<"instructors">) {
  return useQuery({
    ...convexQuery(api.instructors.getInstructorById, { id }),
    enabled: !!id,
  });
}

export function useListInstructors() {
  return useQuery({
    ...convexQuery(api.instructors.listInstructors, {}),
  });
}

export function useActiveInstructors() {
  return useQuery({
    ...convexQuery(api.instructors.getActiveInstructors, {}),
  });
}

export function usePublicInstructors() {
  return useQuery({
    ...convexQuery(api.instructors.getPublicInstructors, {}),
  });
}

export function usePublicInstructorBySlug(slug: string) {
  return useQuery({
    ...convexQuery(api.instructors.getInstructorBySlug, { slug }),
    enabled: !!slug,
  });
}

export function useAdminInstructors() {
  return useQuery({
    ...convexQuery(api.instructors.getInstructorsForAdmin, {}),
  });
}

export function useUpdateInstructor() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.instructors.updateInstructor),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["instructors"] });
    },
  });
}

export function useCreateInstructor() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.instructors.createInstructor),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["instructors"] });
    },
  });
}

export function useDeleteInstructor() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.instructors.deleteInstructor),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["instructors"] });
    },
  });
}
