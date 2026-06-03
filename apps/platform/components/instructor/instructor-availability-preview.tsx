"use client";

import { AvailabilityPreview } from "@/components/checkout/availability-preview";
import { Id } from "@/convex/_generated/dataModel";

interface InstructorAvailabilityPreviewProps {
  instructorId: Id<"instructors">;
  instructorName?: string;
}

export function InstructorAvailabilityPreview({
  instructorId,
  instructorName,
}: InstructorAvailabilityPreviewProps) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Availability Preview</h2>
        <p className="text-sm text-muted-foreground">
          See what students see when booking a session with you.
        </p>
      </div>
      <AvailabilityPreview
        instructorId={instructorId}
        instructorName={instructorName}
      />
    </div>
  );
}