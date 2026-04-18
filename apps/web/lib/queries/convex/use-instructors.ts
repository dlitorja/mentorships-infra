import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";

export function useInstructorBySlug(slug: string) {
  return useQuery({
    ...convexQuery(api.instructors.getInstructorBySlug, { slug }),
    enabled: !!slug,
  });
}

export function useInstructorById(id: Id<"instructors">) {
  return useQuery({
    ...convexQuery(api.instructors.getInstructorById, { id }),
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

export function useInstructorTestimonials(instructorId: Id<"instructors">) {
  return useQuery({
    ...convexQuery(api.instructors.getTestimonials, { instructorId }),
    enabled: !!instructorId,
  });
}

export function useMenteeResults(instructorId: Id<"instructors">) {
  return useQuery({
    ...convexQuery(api.instructors.getMenteeResults, { instructorId }),
    enabled: !!instructorId,
  });
}
