"use client";

import { useQuery } from "@convex-dev/react-query";

export function useStudentSessions(studentId: string) {
  return useQuery("sessions:listByStudent", { studentId });
}

export function useUpcomingStudentSessions(studentId: string) {
  return useQuery("sessions:listUpcomingByStudent", { studentId });
}

export function useInstructorSessions(instructorId: string) {
  return useQuery("sessions:listByInstructor", { instructorId: instructorId as any });
}

export function useSession(id: string) {
  return useQuery("sessions:getById", { id: id as any });
}