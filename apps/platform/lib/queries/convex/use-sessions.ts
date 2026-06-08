"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

/**
 * Retrieves a session by its ID.
 * @param {string} id - The unique identifier of the session
 * @returns {UseQueryResult<Session>} A query result containing the session data
 */
export function useSession(id: string) {
  return useQuery({
    ...convexQuery(api.sessions.getSessionById, { id: id as Id<"sessions"> }),
    enabled: !!id,
  });
}

/**
 * Retrieves all sessions for a specific student.
 * @param {string} studentId - The unique identifier of the student
 * @returns {UseQueryResult<Session[]>} A query result containing the student's sessions
 */
export function useStudentSessions(studentId: string) {
  return useQuery({
    ...convexQuery(api.sessions.getStudentSessions, { studentId }),
    enabled: !!studentId,
  });
}

/**
 * Retrieves upcoming sessions for a specific student.
 * @param {string} studentId - The unique identifier of the student
 * @returns {UseQueryResult<Session[]>} A query result containing the student's upcoming sessions
 */
export function useUpcomingStudentSessions(studentId: string) {
  return useQuery({
    ...convexQuery(api.sessions.getUpcomingSessions, { studentId }),
    enabled: !!studentId,
  });
}

/**
 * Retrieves recent sessions for a specific student with instructor details.
 * @param {string} studentId - The unique identifier of the student
 * @returns {UseQueryResult<Session[]>} A query result containing recent student sessions with instructor info
 */
export function useAllStudentSessions(studentId: string) {
  return useQuery({
    ...convexQuery(api.sessions.getRecentSessionsWithInstructor, { studentId }),
    enabled: !!studentId,
  });
}

/**
 * Retrieves all sessions for a specific instructor.
 * @param {string} instructorId - The unique identifier of the instructor
 * @returns {UseQueryResult<Session[]>} A query result containing the instructor's sessions
 */
export function useInstructorSessions(instructorId: string) {
  return useQuery({
    ...convexQuery(api.sessions.getInstructorSessions, { instructorId: instructorId as Id<"instructors"> }),
    enabled: !!instructorId,
  });
}

/**
 * Creates a mutation for creating a new session.
 * Invalidates session queries on success.
 * @returns {UseMutationResult} A mutation result for creating sessions
 */
export function useCreateSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.sessions.createSession),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });
}

/**
 * Creates a mutation for completing a session.
 * Invalidates session queries on success.
 * @returns {UseMutationResult} A mutation result for completing sessions
 */
export function useCompleteSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.sessions.completeSession),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });
}

/**
 * Creates a mutation for cancelling a session.
 * Invalidates session queries on success.
 * @returns {UseMutationResult} A mutation result for cancelling sessions
 */
export function useCancelSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.sessions.cancelSession),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });
}

/**
 * Creates a mutation for updating a session's status.
 * Invalidates session queries on success.
 * @returns {UseMutationResult} A mutation result for updating session status
 */
export function useUpdateSessionStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: useConvexMutation(api.sessions.updateSession),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });
}