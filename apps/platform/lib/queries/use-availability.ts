"use client";

import { useQuery } from "@tanstack/react-query";

type AvailabilityPreviewResponse =
  | { connected: false; slots: never[]; message: string }
  | { connected: true; instructorTimeZone: string | null; slots: string[] };

async function fetchInstructorAvailabilityPreview(
  instructorId: string,
  slots: number = 3,
  days: number = 14
): Promise<AvailabilityPreviewResponse> {
  const url = `/api/instructors/${instructorId}/availability-preview?slots=${slots}&days=${days}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error("Failed to fetch availability");
  }
  return res.json();
}

export function useInstructorAvailabilityPreview(
  instructorId: string,
  options?: { slots?: number; days?: number }
) {
  return useQuery({
    queryKey: ["instructor-availability-preview", instructorId, options?.slots, options?.days],
    queryFn: () =>
      fetchInstructorAvailabilityPreview(instructorId, options?.slots ?? 3, options?.days ?? 14),
    enabled: !!instructorId,
    staleTime: 60 * 1000,
  });
}