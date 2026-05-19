import { useQuery, useMutation, useQueryClient, UseQueryResult } from "@tanstack/react-query";
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

export type PublicInstructor = {
  _id: Id<"instructors">;
  userId?: string;
  name?: string;
  slug?: string;
  email?: string;
  googleCalendarId?: string;
  timeZone?: string;
  workingHours?: any;
  maxActiveStudents?: number;
  bio?: string;
  pricing?: string;
  oneOnOneInventory?: number;
  groupInventory?: number;
  deletedAt?: number;
  legacyId?: string;
  isActive?: boolean;
  isNew?: boolean;
  isHidden?: boolean;
  background?: string[];
  specialties?: string[];
  portfolioImages?: string[];
  portfolioImageStorageIds?: string[];
  profileImageUrl?: string;
  profileImageStorageId?: string;
  profileImageUploadPath?: string;
  socials?: any;
  tagline?: string;
  updatedAt?: number;
};

export function usePublicInstructors(): UseQueryResult<PublicInstructor[], Error> {
  return useQuery({
    ...convexQuery(api.instructors.getPublicInstructors, {}),
  }) as UseQueryResult<PublicInstructor[], Error>;
}

export function usePublicInstructorBySlug(slug: string) {
  return useQuery({
    ...convexQuery(api.instructors.getInstructorBySlug, { slug }),
    enabled: !!slug,
  });
}

export type AdminInstructor = PublicInstructor;

export function useAdminInstructors(): UseQueryResult<AdminInstructor[], Error> {
  return useQuery({
    ...convexQuery(api.instructors.getInstructorsForAdmin, {}),
  }) as UseQueryResult<AdminInstructor[], Error>;
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