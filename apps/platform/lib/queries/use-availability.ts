"use client";

import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

const availabilityPreviewSchema = z.discriminatedUnion("connected", [
  z.object({
    connected: z.literal(false),
    slots: z.array(z.never()),
    message: z.string(),
  }),
  z.object({
    connected: z.literal(true),
    instructorTimeZone: z.string().nullable(),
    slots: z.array(z.string()),
  }),
]);

export type AvailabilityPreviewResponse = z.infer<typeof availabilityPreviewSchema>;

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
  const json = await res.json();
  const parsed = availabilityPreviewSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`Invalid availability response: ${parsed.error.message}`);
  }
  return parsed.data;
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