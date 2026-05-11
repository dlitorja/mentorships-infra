"use client";

import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

export type PublicInstructor = {
  _id: Id<"instructors">;
  name: string;
  slug: string;
  tagline?: string;
  bio?: string;
  profileImageUrl?: string;
  specialties?: string[];
  isActive: boolean;
  isHidden?: boolean;
  deletedAt?: number;
};

export function usePublicInstructors() {
  const { data, isLoading, isError, error } = useQuery({
    ...convexQuery(api.instructors.getPublicInstructors, {}),
  });

  const filteredData = useMemo(() => {
    if (!data) return [];
    return data.filter((i: any) => i.isActive && !i.deletedAt && !i.isHidden);
  }, [data]);

  return {
    data: filteredData,
    isLoading,
    isError,
    error,
  };
}

export function useInstructor(id: string) {
  return useQuery({
    ...convexQuery(api.instructors.getInstructorById, { id: id as Id<"instructors"> }),
    enabled: !!id,
  });
}

export function useInstructors() {
  const instructors = useQuery({
    ...convexQuery(api.instructors.listInstructors, {}),
  });

  return useMemo(() => {
    if (!instructors.data) return [];
    return instructors.data
      .filter((i) => i.isActive && !i.deletedAt)
      .sort(() => Math.random() - 0.5);
  }, [instructors.data]);
}

export function usePublicInstructorBySlug(slug: string) {
  return useQuery({
    ...convexQuery(api.instructors.getInstructorBySlug, { slug }),
    enabled: !!slug,
  });
}

export function useInstructorBySlug(slug: string) {
  return useQuery({
    ...convexQuery(api.instructors.getInstructorBySlug, { slug }),
    enabled: !!slug,
  });
}

export function useAllInstructors() {
  return useQuery({
    ...convexQuery(api.instructors.getInstructorsForAdmin, {}),
  });
}

export function useInstructorTestimonials(instructorId: string) {
  return useQuery({
    ...convexQuery(api.instructors.getTestimonialsByInstructorId, { instructorId: instructorId as Id<"instructors"> }),
    enabled: !!instructorId,
  });
}

export function useInstructorMenteeResults(instructorId: string) {
  return useQuery({
    ...convexQuery(api.instructors.getMenteeResultsByInstructorId, { instructorId: instructorId as Id<"instructors"> }),
    enabled: !!instructorId,
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

export function useCreateTestimonial() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.instructors.createTestimonial),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["instructorTestimonials"] });
    },
  });
}

export function useDeleteTestimonial() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.instructors.deleteTestimonial),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["instructorTestimonials"] });
    },
  });
}

export function useCreateMenteeResult() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.instructors.createMenteeResult),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["menteeResults"] });
    },
  });
}

export function useDeleteMenteeResult() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.instructors.deleteMenteeResult),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["menteeResults"] });
    },
  });
}

export function useUpdateInstructorInventory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.instructors.updateInstructorInventory),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["instructors"] });
    },
  });
}

export function useUploadInstructorProfileImage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.instructors.uploadInstructorProfileImage),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["instructors"] });
    },
  });
}

export function useAddInstructorPortfolioImage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.instructors.uploadInstructorPortfolioImage),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["instructors"] });
    },
  });
}