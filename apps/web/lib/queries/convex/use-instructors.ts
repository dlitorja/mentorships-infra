import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { api } from "../../../../convex/_generated/api";

export function useInstructorBySlug(slug: string) {
  return useQuery({
    ...convexQuery(api.instructors.getInstructorBySlug, { slug }),
    enabled: !!slug,
  });
}

export function useInstructorById(id: string) {
  return useQuery({
    ...convexQuery(api.instructors.getInstructorById, { id: id as any }),
    enabled: !!id,
  });
}

export function useInstructorByMentorId(mentorId: string) {
  return useQuery({
    ...convexQuery(api.instructors.getInstructorByMentorId, { mentorId }),
    enabled: !!mentorId,
  });
}

export function useListInstructors() {
  return useQuery({
    ...convexQuery(api.instructors.listInstructors, {}),
  });
}

export function useActiveInstructors() {
  return useQuery({
    ...convexQuery(api.instructors.listActiveInstructors, {}),
  });
}

export function useInstructorTestimonials(instructorId: string) {
  return useQuery({
    ...convexQuery(api.instructors.getTestimonials, { instructorId: instructorId as any }),
    enabled: !!instructorId,
  });
}

export function useMenteeResults(instructorId: string) {
  return useQuery({
    ...convexQuery(api.instructors.getMenteeResults, { instructorId: instructorId as any }),
    enabled: !!instructorId,
  });
}
