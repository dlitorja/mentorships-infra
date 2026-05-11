"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";

export function useSession(id: string) {
  return useQuery({
    ...convexQuery(api.sessions.getById, { id: id as Id<"sessions"> }),
    enabled: !!id,
  });
}

export function useStudentSessions(studentId: string) {
  return useQuery({
    ...convexQuery(api.sessions.listByStudent, { studentId }),
    enabled: !!studentId,
  });
}

export function useUpcomingStudentSessions(studentId: string) {
  return useQuery({
    ...convexQuery(api.sessions.listUpcomingByStudent, { studentId }),
    enabled: !!studentId,
  });
}

export function useInstructorSessions(instructorId: string) {
  return useQuery({
    ...convexQuery(api.sessions.listByInstructor, { instructorId: instructorId as Id<"instructors"> }),
    enabled: !!instructorId,
  });
}

export function useCreateSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.sessions.create),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });
}

export function useCompleteSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.sessions.complete),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });
}

export function useCancelSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.sessions.cancel),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });
}

export function useUpdateSessionStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.sessions.updateStatus),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });
}