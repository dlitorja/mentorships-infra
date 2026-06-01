"use client";

import { useQuery, UseQueryResult } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

export type UpcomingSession = {
  id: Id<"sessions">;
  scheduledAt: number;
  status: string;
  studentEmail: string | null;
  remainingSessions: number | null;
};

export function useInstructorUpcomingSessions(instructorId: Id<"instructors"> | undefined): UseQueryResult<UpcomingSession[], Error> {
  return useQuery({
    ...convexQuery(api.sessions.getInstructorUpcomingSessions, {
      instructorId: instructorId as Id<"instructors">,
    }),
    enabled: !!instructorId,
  });
}