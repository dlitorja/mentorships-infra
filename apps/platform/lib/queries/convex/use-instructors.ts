"use client";

import { useQuery } from "@convex-dev/react-query";
import { useMemo } from "react";

export function useInstructors() {
  const instructors = useQuery("instructors:list");

  return useMemo(() => {
    if (!instructors) return [];
    return instructors
      .filter((i) => i.isActive && !i.deletedAt)
      .sort(() => Math.random() - 0.5);
  }, [instructors]);
}

export function useInstructorBySlug(slug: string) {
  return useQuery("instructors:getBySlug", { slug });
}

export function useInstructor(id: string) {
  return useQuery("instructors:getById", { id: id as any });
}

export function useInstructorTestimonials(instructorId: string) {
  return useQuery("instructors:getTestimonials", { instructorId: instructorId as any });
}

export function useInstructorMenteeResults(instructorId: string) {
  return useQuery("instructors:getMenteeResults", { instructorId: instructorId as any });
}

export function useAllInstructors() {
  return useQuery("instructors:listAll");
}