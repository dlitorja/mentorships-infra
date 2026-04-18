import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { api } from "../../../../convex/_generated/api";

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

export function useMentorSessions(mentorId: string) {
  return useQuery({
    ...convexQuery(api.sessions.getMentorSessions, { mentorId: mentorId as any }),
    enabled: !!mentorId,
  });
}

export function useSessionById(id: string) {
  return useQuery({
    ...convexQuery(api.sessions.getSessionById, { id: id as any }),
    enabled: !!id,
  });
}

export function useSessionByCalendarEventId(eventId: string) {
  return useQuery({
    ...convexQuery(api.sessions.getSessionByCalendarEventId, { eventId }),
    enabled: !!eventId,
  });
}
