"use client";

import React, { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";

type WorkingHoursInterval = { start: string; end: string };
type WorkingHours = Record<string, WorkingHoursInterval[]>;

const dayLabels: Record<0 | 1 | 2 | 3 | 4 | 5 | 6, string> = {
  0: "Sunday",
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday",
};

const commonTimezones = [
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

interface SchedulingSettingsFormProps {
  initialTimeZone: string | null;
  initialWorkingHours: WorkingHours | null;
}

export function SchedulingSettingsForm({
  initialTimeZone,
  initialWorkingHours,
}: SchedulingSettingsFormProps) {
  const [timeZone, setTimeZone] = useState(initialTimeZone ?? "");
  const [workingHours, setWorkingHours] = useState<WorkingHours>(initialWorkingHours ?? {});

  const saveMutation = useMutation({
    mutationFn: async (data: { timeZone: string | null; workingHours: WorkingHours }) => {
      const response = await fetch("/api/instructor/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error("Failed to save");
      return response.json();
    },
    onSuccess: () => toast.success("Settings saved!"),
    onError: () => toast.error("Failed to save settings"),
  });

  function handleTimeZoneChange(e: React.ChangeEvent<HTMLSelectElement>) {
    setTimeZone(e.target.value);
  }

  function handleDayToggle(day: number, enabled: boolean) {
    const dayKey = String(day);
    if (enabled) {
      setWorkingHours({ ...workingHours, [dayKey]: [{ start: "09:00", end: "17:00" }] });
    } else {
      const { [dayKey]: _, ...rest } = workingHours;
      setWorkingHours(rest);
    }
  }

  function addInterval(day: number) {
    const dayKey = String(day);
    const current = workingHours[dayKey] || [];
    setWorkingHours({ ...workingHours, [dayKey]: [...current, { start: "09:00", end: "17:00" }] });
  }

  function removeInterval(day: number, index: number) {
    const dayKey = String(day);
    const current = workingHours[dayKey] || [];
    setWorkingHours({ ...workingHours, [dayKey]: current.filter((_, i) => i !== index) });
  }

  function handleTimeChange(day: number, index: number, field: 'start' | 'end', value: string) {
    const dayKey = String(day);
    const current = workingHours[dayKey] || [];
    const updated = [...current];
    updated[index] = { ...updated[index], [field]: value };
    setWorkingHours({ ...workingHours, [dayKey]: updated });
  }

  function save() {
    saveMutation.mutate({ timeZone: timeZone || null, workingHours });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Scheduling Settings</CardTitle>
        <CardDescription>
          Set your timezone and working hours.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Time zone</label>
          <select
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            value={timeZone}
            onChange={handleTimeZoneChange}
          >
            <option value="">(not set)</option>
            {commonTimezones.map((tz) => (
              <option key={tz} value={tz}>{tz}</option>
            ))}
          </select>
        </div>

        <div className="space-y-3">
          <div className="text-sm font-medium">Working hours</div>
          {([0, 1, 2, 3, 4, 5, 6] as const).map((day) => {
            const intervals = workingHours[String(day)] || [];
            const enabled = intervals.length > 0;
            return (
              <div key={day} className="rounded-md border p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={(e) => handleDayToggle(day, e.target.checked)}
                    />
                    <span className="text-sm font-medium">{dayLabels[day]}</span>
                  </label>
                  {enabled && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => addInterval(day)} className="h-8 px-2">
                      <Plus className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                {enabled && (
                  <div className="space-y-2 ml-6">
                    {intervals.map((interval, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <input
                          type="time"
                          value={interval.start}
                          onChange={(e) => handleTimeChange(day, index, 'start', e.target.value)}
                          className="rounded-md border bg-background px-2 py-1 text-sm"
                        />
                        <span className="text-sm text-muted-foreground">to</span>
                        <input
                          type="time"
                          value={interval.end}
                          onChange={(e) => handleTimeChange(day, index, 'end', e.target.value)}
                          className="rounded-md border bg-background px-2 py-1 text-sm"
                        />
                        {intervals.length > 1 && (
                          <Button type="button" variant="ghost" size="sm" onClick={() => removeInterval(day, index)} className="h-8 px-2 text-red-500">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <Button onClick={save} disabled={saveMutation.isPending}>
          {saveMutation.isPending ? "Saving…" : "Save settings"}
        </Button>
      </CardContent>
    </Card>
  );
}