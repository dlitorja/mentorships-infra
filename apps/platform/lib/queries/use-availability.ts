"use client";

import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { fetchInstructorAvailabilityPreview } from "./api-client";

const availabilityPreviewSchema = z.discriminatedUnion("connected", [
  z.object({
    connected: z.literal(false),
    slots: z.array(z.never()),
    message: z.string(),
  }),
  z.object({
    connected: z.literal(true),
    instructorTimeZone: z.string().nullable(),
    studentTimeZone: z.string().nullable().optional(),
    slots: z.array(z.string()),
  }),
]);

export type AvailabilityPreviewResponse = z.infer<typeof availabilityPreviewSchema>;

async function fetchAvailabilityPreview(
  instructorId: string,
  slots: number = 3,
  days: number = 14,
  options?: { studentTimeZone?: string | null }
): Promise<AvailabilityPreviewResponse> {
  const json = await fetchInstructorAvailabilityPreview(instructorId, slots, days, options);
  const parsed = availabilityPreviewSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`Invalid availability response: ${parsed.error.message}`);
  }
  return parsed.data;
}

/**
 * Detect the student's IANA zone from the browser, with a defensive
 * fallback for runtimes that strip or restrict `Intl`.
 *
 * Mirrors the auto-detection path on the questionnaire timezone picker
 * (`apps/platform/components/onboarding/timezone-picker.tsx`). The picker
 * is the user's source of truth: they can change their preference in the
 * dropdown, but the runtime-detected zone is the one we ship up to the
 * server for the availability preview so it doesn't'depend on a saved
 * preference being set.
 */
function detectClientTimeZone(): string | null {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (typeof zone === "string" && zone.length > 0 && zone.length <= 64) {
      return zone;
    }
  } catch {
    // Some test environments polyfill Intl weirdly; fall through.
  }
  return null;
}

export function useInstructorAvailabilityPreview(
  instructorId: string,
  options?: { slots?: number; days?: number; studentTimeZone?: string | null }
) {
  const studentTimeZone = options?.studentTimeZone ?? detectClientTimeZone();
  return useQuery({
    queryKey: [
      "instructor-availability-preview",
      instructorId,
      options?.slots,
      options?.days,
      studentTimeZone,
    ],
    queryFn: () =>
      fetchAvailabilityPreview(
        instructorId,
        options?.slots ?? 3,
        options?.days ?? 14,
        { studentTimeZone }
      ),
    enabled: !!instructorId,
    staleTime: 60 * 1000,
  });
}