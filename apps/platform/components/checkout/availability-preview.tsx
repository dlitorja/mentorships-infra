"use client";

import { Loader2, Calendar } from "lucide-react";
import { useInstructorAvailabilityPreview } from "@/lib/queries/use-availability";
import { Id } from "@/convex/_generated/dataModel";
import { formatSlotLabel } from "@/lib/timezone";

/**
 * Render a single slot as a human label across two zones, e.g.
 *
 *   "Tue, Mar 4 · 7:00pm PDT (your time)"
 *   "Tue, Mar 4 · 10:00am PDT your time / 1:00pm EDT instructor time"
 *
 * When only one zone is known, we render in that zone and add "(your time)"
 * if it is the student's. When neither zone is known we fall through to a
 * runtime-default label, matching the pre-PR behavior.
 */
function renderSlotLabel(
  isoString: string,
  studentTimeZone: string | null | undefined,
  instructorTimeZone: string | null | undefined
): string {
  const studentLabel = formatSlotLabel(isoString, studentTimeZone ?? null);
  const instructorLabel = formatSlotLabel(isoString, instructorTimeZone ?? null);

  if (studentLabel && instructorLabel && studentTimeZone && instructorTimeZone) {
    return `${studentLabel} your time / ${instructorLabel} instructor time`;
  }
  if (studentLabel && studentTimeZone) {
    return `${studentLabel} your time`;
  }
  if (instructorLabel) {
    return instructorLabel;
  }
  // Fallback to runtime-default zone — last resort so we never show raw ISO.
  return studentLabel ?? isoString;
}

interface AvailabilityPreviewProps {
  instructorId: Id<"instructors">;
  instructorName?: string;
}

/**
 * Displays a preview of an instructor's next available session slots.
 * Shows a loading state, "not connected" message, or lists the next 5 available times.
 *
 * @param instructorId - Instructor's Convex ID
 * @param instructorName - Optional instructor name for display
 */
export function AvailabilityPreview({ instructorId, instructorName }: AvailabilityPreviewProps) {
  const { data, isLoading, isError } = useInstructorAvailabilityPreview(instructorId as string);

  if (isLoading) {
    return (
      <div className="border rounded-lg p-4 bg-muted/30">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Checking availability...</span>
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return null;
  }

  if (!data.connected) {
    return (
      <div className="border rounded-lg p-4 bg-muted/30">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Calendar className="h-4 w-4" />
          <span>
            {instructorName
              ? `${instructorName} has not connected their calendar yet. Bookings will be available once they enable scheduling.`
              : "This instructor has not connected their calendar yet. Bookings will be available once they enable scheduling."}
          </span>
        </div>
      </div>
    );
  }

  if (data.slots.length === 0) {
    return (
      <div className="border rounded-lg p-4 bg-muted/30">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Calendar className="h-4 w-4" />
          <span>No available slots in the next 2 weeks</span>
        </div>
      </div>
    );
  }

  return (
    <div className="border rounded-lg p-4 bg-muted/30">
      <div className="flex items-center gap-2 mb-3">
        <Calendar className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium">Next available times</span>
      </div>
      <ul className="space-y-1">
        {data.slots.map((slot, index) => (
          <li key={index} className="text-sm text-muted-foreground">
            • {renderSlotLabel(slot, data.studentTimeZone ?? null, data.instructorTimeZone ?? null)}
          </li>
        ))}
      </ul>
      {data.slots.length > 0 && (
        <p className="text-xs text-muted-foreground mt-2">
          More times shown after purchase
        </p>
      )}
    </div>
  );
}