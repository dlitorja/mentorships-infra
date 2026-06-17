"use client";

import React from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

interface TimezoneSettingsFormProps {
  initialTimeZone: string | null;
}

export function TimezoneSettingsForm({ initialTimeZone }: TimezoneSettingsFormProps) {
  console.log("[TimezoneSettingsForm] initialTimeZone:", initialTimeZone);

  const [selectedTimezone, setSelectedTimezone] = React.useState(initialTimeZone ?? "");
  console.log("[TimezoneSettingsForm] selectedTimezone state:", selectedTimezone);

  const timezones = [
    "UTC",
    "America/Los_Angeles",
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "Europe/London",
    "Europe/Paris",
    "Europe/Berlin",
    "Asia/Tokyo",
    "Asia/Shanghai",
    "Australia/Sydney",
  ];

  const handleTimezoneChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    console.log("[TimezoneSettingsForm] handleTimezoneChange called, value:", e.target.value);
    setSelectedTimezone(e.target.value);
  };

  const saveMutation = useMutation({
    mutationFn: async (timezone: string | null) => {
      console.log("[TimezoneSettingsForm] saveMutation called with:", timezone);
      const response = await fetch("/api/instructor/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timeZone: timezone }),
      });
      if (!response.ok) {
        throw new Error("Failed to save");
      }
      return response.json();
    },
    onSuccess: () => {
      console.log("[TimezoneSettingsForm] saveMutation onSuccess");
      toast.success("Timezone saved!");
    },
    onError: () => {
      console.log("[TimezoneSettingsForm] saveMutation onError");
      toast.error("Failed to save timezone");
    },
  });

  const handleSave = () => {
    console.log("[TimezoneSettingsForm] handleSave called, selectedTimezone:", selectedTimezone);
    saveMutation.mutate(selectedTimezone || null);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Timezone Settings</CardTitle>
        <CardDescription>
          Select your timezone for scheduling.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="timezone-select" className="text-sm font-medium">
            Time zone
          </label>
          <select
            id="timezone-select"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            value={selectedTimezone}
            onChange={handleTimezoneChange}
          >
            <option value="">-- Select timezone --</option>
            {timezones.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
        </div>
        <Button onClick={handleSave} disabled={saveMutation.isPending}>
          {saveMutation.isPending ? "Saving..." : "Save Timezone"}
        </Button>
      </CardContent>
    </Card>
  );
}