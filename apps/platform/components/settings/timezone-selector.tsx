"use client";

import React, { useMemo, useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { useCurrentInstructor, useUpdateInstructor } from "@/lib/queries/convex";

const fallbackTimeZones = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Toronto",
  "America/Vancouver",
  "America/Mexico_City",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Madrid",
  "Europe/Rome",
  "Europe/Amsterdam",
  "Europe/Stockholm",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Hong_Kong",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Australia/Sydney",
  "Australia/Melbourne",
  "Pacific/Auckland",
  "Pacific/Honolulu",
];

function getTimeZones(): string[] {
  const fn = (Intl as unknown as { supportedValuesOf?: (key: "timeZone") => string[] })
    .supportedValuesOf;
  if (typeof fn === "function") {
    try {
      return fn("timeZone");
    } catch {
      return fallbackTimeZones;
    }
  }
  return fallbackTimeZones;
}

function formatTimeZone(tz: string): string {
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      timeZoneName: "long",
    });
    const parts = formatter.formatToParts(now);
    const short = parts.find((p) => p.type === "timeZoneName")?.value;
    return `${tz} (${short})`;
  } catch {
    return tz;
  }
}

/**
 * Timezone selector card for instructors to set their local timezone.
 * Saves selection to the instructor's Convex record.
 */
export function TimeZoneSelector() {
  const timeZones = useMemo(() => getTimeZones(), []);

  const { data: instructor, isLoading } = useCurrentInstructor();
  const updateInstructor = useUpdateInstructor();

  const [browserTz, setBrowserTz] = useState<string | null>(null);

  useEffect(() => {
    try {
      setBrowserTz(Intl.DateTimeFormat().resolvedOptions().timeZone);
    } catch {
      setBrowserTz(null);
    }
  }, []);

  console.log("[TimeZoneSelector] render - instructor:", instructor?._id, "timeZone:", instructor?.timeZone);

  const handleTimeZoneChange = async (timeZone: string) => {
    console.log("[TimeZoneSelector] handleTimeZoneChange - timeZone:", timeZone, "instructor:", instructor?._id);
    if (!instructor) {
      console.log("[TimeZoneSelector] NO INSTRUCTOR - returning early");
      return;
    }
    try {
      console.log("[TimeZoneSelector] calling mutateAsync with id:", instructor._id, "timeZone:", timeZone);
      await updateInstructor.mutateAsync({ id: instructor._id, timeZone });
      console.log("[TimeZoneSelector] mutation completed");
      toast.success("Timezone saved");
    } catch (error) {
      console.log("[TimeZoneSelector] mutation error:", error);
      toast.error(error instanceof Error ? error.message : "Failed to save timezone");
    }
  };

  const currentTimeZone = instructor?.timeZone;
  const isSaving = updateInstructor.isPending;

  console.log("[TimeZoneSelector] currentTimeZone:", currentTimeZone, "isSaving:", isSaving);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Timezone</CardTitle>
        <CardDescription>
          Your local timezone for displaying session times.
          {browserTz && <> We detected your timezone as <span className="font-medium">{browserTz}</span>.</>}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : (
          <>
            <select
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={currentTimeZone ?? ""}
              onChange={(e) => handleTimeZoneChange(e.target.value)}
              disabled={isSaving}
            >
              <option value="">Select your timezone...</option>
              {timeZones.map((tz) => (
                <option key={tz} value={tz}>
                  {formatTimeZone(tz)}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              Session times will be displayed in your selected timezone.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}