"use client";

import { Loader2, Calendar } from "lucide-react";
import { useInstructorAvailabilityPreview } from "@/lib/queries/use-availability";
import { Id } from "@/convex/_generated/dataModel";

function formatSlot(isoString: string, timeZone: string | null): string {
  const date = new Date(isoString);
  const userTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const options: Intl.DateTimeFormatOptions = {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  };

  return date.toLocaleString("en-US", {
    ...options,
    timeZone: timeZone || userTimeZone,
  });
}

interface AvailabilityPreviewProps {
  instructorId: Id<"instructors">;
  instructorName?: string;
}

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
          <span>Availability shown after purchase</span>
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
            • {formatSlot(slot, data.instructorTimeZone)}
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