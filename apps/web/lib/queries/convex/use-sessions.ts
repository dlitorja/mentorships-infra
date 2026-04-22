import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";

export function useStudentSessions(studentId: string) {
  return useQuery({
    ...convexQuery(api.sessions.getStudentSessions, { studentId }),
    enabled: !!studentId,
  });
}

export function useUpcomingSessions(studentId: string) {
  return useQuery({
    ...convexQuery(api.sessions.getUpcomingSessions, { studentId }),
    enabled: !!studentId,
  });
}

export function useInstructorSessions(mentorId: Id<"instructors">) {
  return useQuery({
    ...convexQuery(api.sessions.getMentorSessions, { mentorId }),
    enabled: !!mentorId,
  });
}

export function useSessionById(id: Id<"sessions">) {
  return useQuery({
    ...convexQuery(api.sessions.getSessionById, { id }),
    enabled: !!id,
  });
}

export function useSessionByCalendarEventId(eventId: string) {
  return useQuery({
    ...convexQuery(api.sessions.getSessionByCalendarEventId, { eventId }),
    enabled: !!eventId,
  });
}
