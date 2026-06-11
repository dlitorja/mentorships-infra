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
 * Fetches a single instructor by ID for public display.
 * Returns null while loading or if instructor not found.
 */
export function useInstructor(id: string) {
  return useQuery({
    ...convexQuery(api.instructors.getInstructorById, { id: id as Id<"instructors"> }),
    enabled: !!id,
  });
}

export function useInstructorByUserId(userId: string) {
  return useQuery({
    ...convexQuery(api.instructors.getInstructorByUserId, { userId }),
    enabled: !!userId,
  });
}

/**
 * Fetches all instructors for admin listing.
 * Filters out deleted and inactive instructors.
 * Randomizes order for display variety.
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
      .filter((i: PublicInstructor) => (i.isActive !== false) && !i.deletedAt)
      .sort(() => Math.random() - 0.5);
  }, [query.data]);

  return { data, isLoading: query.isLoading, isError: query.isError };
}

/**
 * Fetches a single instructor by slug for public profile pages.
 * Returns null while loading or if instructor not found.
 */
export function usePublicInstructorBySlug(slug: string) {
  return useQuery({
    ...convexQuery(api.instructors.getInstructorBySlug, { slug }),
    enabled: !!slug,
  });
}

/**
 * Fetches a single instructor by slug.
 * Used for instructor dashboard and settings pages.
 */
export function useInstructorBySlug(slug: string) {
  return useQuery({
    ...convexQuery(api.instructors.getInstructorBySlug, { slug }),
    enabled: !!slug,
  });
}

/**
 * Fetches all instructors including inactive/hidden for admin management.
 * No filtering applied - returns complete instructor list.
 */
export function useAllInstructors() {
  return useQuery({
    ...convexQuery(api.instructors.getInstructorsForAdmin, {}),
  });
}

/**
 * Fetches testimonials for a specific instructor.
 * Used on instructor public profile pages.
 */
export function useInstructorTestimonials(instructorId: string) {
  return useQuery({
    ...convexQuery(api.instructors.getTestimonialsByInstructorId, { instructorId: instructorId as Id<"instructors"> }),
    enabled: !!instructorId,
  });
}

/**
 * Fetches student success stories/results for a specific instructor.
 * Used on instructor public profile pages.
 */
export function useInstructorStudentResults(instructorId: string) {
  return useQuery({
    ...convexQuery(api.instructors.getStudentResultsByInstructorId, { instructorId: instructorId as Id<"instructors"> }),
    enabled: !!instructorId,
  });
}

/**
 * Mutation hook for updating instructor profile information.
 * Invalidates instructor queries on success to refresh data.
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
 * Mutation hook for creating a new instructor.
 * Invalidates instructor queries on success to refresh list.
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
 * Mutation hook for soft-deleting an instructor.
 * Sets deletedAt timestamp but preserves data for potential recovery.
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
 * Mutation hook for permanently deleting an instructor.
 * WARNING: This is irreversible and removes all associated data.
 * Requires admin authentication.
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
 * Mutation hook for creating a testimonial for an instructor.
 * Invalidates testimonial queries on success.
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
 * Mutation hook for deleting a testimonial.
 * Invalidates testimonial queries on success.
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
 * Mutation hook for creating a student result/success story.
 * Invalidates student result queries on success.
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
 * Mutation hook for deleting a student result/success story.
 * Invalidates student result queries on success.
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
 * Mutation hook for updating instructor inventory (available session slots).
 * Invalidates instructor queries on success to refresh availability data.
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
 * Mutation hook for uploading instructor profile image.
 * Invalidates instructor queries on success to refresh image URL.
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
 * Mutation hook for adding a portfolio image to instructor profile.
 * Invalidates instructor queries on success to refresh portfolio gallery.
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