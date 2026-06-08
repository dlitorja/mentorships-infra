"use client";

import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

export type PublicInstructor = {
  _id: Id<"instructors">;
  name?: string;
  slug?: string;
  tagline?: string;
  bio?: string;
  profileImageUrl?: string;
  specialties?: string[];
  isActive?: boolean;
  isHidden?: boolean;
  deletedAt?: number;
  // Computed on the server: true if sold out of all mentorship types they currently offer
  isCompletelySoldOut?: boolean;
};

/**
 * Fetches public instructors for the marketplace.
 * Filters out deleted, hidden, and inactive instructors.
 * Includes computed isCompletelySoldOut flag based on inventory.
 */
export function usePublicInstructors() {
  const { data, isLoading, isError, error } = useQuery({
    ...convexQuery(api.instructors.getPublicInstructors, {}),
  });

  const filteredData = useMemo<PublicInstructor[]>(() => {
    if (!data) return [];
    const list = (data as unknown as PublicInstructor[]) ?? [];
    // Treat undefined isActive as active for backward compatibility
    return list.filter((i: PublicInstructor) => (i.isActive !== false) && !i.deletedAt && !(i as any).isHidden);
  }, [data]);

  return {
    data: filteredData,
    isLoading,
    isError,
    error,
  };
}

/**
 * Fetches a single instructor by ID for authenticated users.
 * Requires authentication and returns the instructor with fresh profile image URL.
 */
export function useInstructor(id: string) {
  return useQuery({
    ...convexQuery(api.instructors.getInstructorById, { id: id as Id<"instructors"> }),
    enabled: !!id,
  });
}

/**
 * Fetches all non-deleted instructors for authenticated users.
 * Returns shuffled list with active-only filtering. Admin use only.
 */
export function useInstructors(): {
  data: PublicInstructor[];
  isLoading: boolean;
  isError: boolean;
} {
  const query = useQuery({
    ...convexQuery(api.instructors.listInstructors, {}),
  });

  const data = useMemo<PublicInstructor[]>(() => {
    if (!query.data) return [];
    return query.data
      // Treat undefined isActive as active for backward compatibility
      .filter((i: PublicInstructor) => (i.isActive !== false) && !i.deletedAt)
      .sort(() => Math.random() - 0.5);
  }, [query.data]);

  return { data, isLoading: query.isLoading, isError: query.isError };
}

/**
 * Fetches public instructor profile by slug for unauthenticated users.
 * Falls back to instructor table if no profile exists.
 */
export function usePublicInstructorBySlug(slug: string) {
  return useQuery({
    ...convexQuery(api.instructors.getInstructorBySlug, { slug }),
    enabled: !!slug,
  });
}

/**
 * Fetches instructor profile by slug for authenticated users.
 * Includes inventory data for purchase/waitlist logic.
 */
export function useInstructorBySlug(slug: string) {
  return useQuery({
    ...convexQuery(api.instructors.getInstructorBySlug, { slug }),
    enabled: !!slug,
  });
}

/**
 * Fetches all instructors for admin dashboard with inventory data.
 * Excludes sensitive fields like googleRefreshToken.
 */
export function useAllInstructors() {
  return useQuery({
    ...convexQuery(api.instructors.getInstructorsForAdmin, {}),
  });
}

/**
 * Fetches all testimonials for a given instructor.
 */
export function useInstructorTestimonials(instructorId: string) {
  return useQuery({
    ...convexQuery(api.instructors.getTestimonialsByInstructorId, { instructorId: instructorId as Id<"instructors"> }),
    enabled: !!instructorId,
  });
}

/**
 * Fetches all student results (success stories) for a given instructor.
 */
export function useInstructorStudentResults(instructorId: string) {
  return useQuery({
    ...convexQuery(api.instructors.getStudentResultsByInstructorId, { instructorId: instructorId as Id<"instructors"> }),
    enabled: !!instructorId,
  });
}

/**
 * Mutation hook to update instructor fields.
 * Invalidates instructors query cache on success.
 */
export function useUpdateInstructor() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.instructors.updateInstructor),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["instructors"] });
    },
  });
}

/**
 * Mutation hook to create a new instructor.
 * Returns existing instructor ID if one already exists for the user.
 */
export function useCreateInstructor() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.instructors.createInstructor),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["instructors"] });
    },
  });
}

/**
 * Mutation hook to soft-delete an instructor.
 * Sets deletedAt timestamp instead of permanent deletion. Admin only.
 */
export function useDeleteInstructor() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.instructors.deleteInstructor),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["instructors"] });
    },
  });
}

/**
 * Mutation hook to permanently delete an instructor. Irreversible. Admin only.
 */
export function useHardDeleteInstructor() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.instructors.hardDeleteInstructor),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["instructors"] });
    },
  });
}

/**
 * Mutation hook to create a testimonial for an instructor. Admin only.
 */
export function useCreateTestimonial() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.instructors.createTestimonial),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["instructorTestimonials"] });
    },
  });
}

/**
 * Mutation hook to delete a testimonial. Admin or instructor owner only.
 */
export function useDeleteTestimonial() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.instructors.deleteTestimonial),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["instructorTestimonials"] });
    },
  });
}

/**
 * Mutation hook to create a student result (success story) with image URL. Admin only.
 */
export function useCreateStudentResult() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.instructors.createStudentResult),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["studentResults"] });
    },
  });
}

/**
 * Mutation hook to delete a student result. Admin or instructor owner only.
 */
export function useDeleteStudentResult() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.instructors.deleteStudentResult),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["studentResults"] });
    },
  });
}

/**
 * Mutation hook to update instructor inventory fields (oneOnOneInventory, groupInventory, maxActiveStudents). Admin only.
 */
export function useUpdateInstructorInventory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.instructors.updateInstructorInventory),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["instructors"] });
    },
  });
}

/**
 * Mutation hook to upload and update instructor profile image.
 * Stores image in Convex storage and updates instructor record.
 */
export function useUploadInstructorProfileImage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.instructors.uploadInstructorProfileImage),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["instructors"] });
    },
  });
}

/**
 * Mutation hook to add a portfolio image to an instructor.
 * Supports adding images at specific index positions.
 */
export function useAddInstructorPortfolioImage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.instructors.uploadInstructorPortfolioImage),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["instructors"] });
    },
  });
}
