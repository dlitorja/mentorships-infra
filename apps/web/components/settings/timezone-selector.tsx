"use client";

import React, { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { getUserSettings, updateUserTimeZoneSetting } from "@/lib/queries/api-client";

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

function getBrowserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
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

export function TimeZoneSelector() {
  const timeZones = useMemo(() => getTimeZones(), []);
  const queryClient = useQueryClient();
  const browserTz = useMemo(() => getBrowserTimeZone(), []);

  const { data: settings, isLoading } = useQuery({
    queryKey: ["userSettings"],
    queryFn: getUserSettings,
  });

  const updateMutation = useMutation({
    mutationFn: (timeZone: string) => updateUserTimeZoneSetting(timeZone),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["userSettings"] });
      toast.success("Timezone saved");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to save timezone");
    },
  });

  const currentTimeZone = settings?.timeZone;
  const isSaving = updateMutation.isPending;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Timezone</CardTitle>
        <CardDescription>
          Your local timezone for displaying session times. We detected your timezone as{" "}
          <span className="font-medium">{browserTz}</span>.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : (
          <>
            <select
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={currentTimeZone || ""}
              onChange={(e) => updateMutation.mutate(e.target.value)}
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
