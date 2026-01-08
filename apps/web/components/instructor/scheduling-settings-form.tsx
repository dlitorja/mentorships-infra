"use client";

import React, { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { updateInstructorSettings } from "@/lib/queries/api-client";
import { useForm } from "@tanstack/react-form";
import { z } from "zod";

type WorkingHoursInterval = { start: string; end: string };
type WorkingHours = Partial<Record<0 | 1 | 2 | 3 | 4 | 5 | 6, WorkingHoursInterval[]>>;

const dayLabels: Record<0 | 1 | 2 | 3 | 4 | 5 | 6, string> = {
  0: "Sunday",
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday",
};

function getTimeZones(): string[] {
  const fn = (Intl as unknown as { supportedValuesOf?: (key: "timeZone") => string[] })
    .supportedValuesOf;
  if (typeof fn === "function") {
    try {
      return fn("timeZone");
    } catch {
      // ignore
    }
  }
  return ["UTC", "America/Los_Angeles", "America/New_York", "Europe/London", "Europe/Berlin"];
}

function normalizeWorkingHours(input: WorkingHours): Record<string, WorkingHoursInterval[]> {
  const out: Record<string, WorkingHoursInterval[]> = {};
  for (const day of [0, 1, 2, 3, 4, 5, 6] as const) {
    const intervals = input[day];
    if (intervals && intervals.length > 0) {
      out[String(day)] = intervals;
    }
  }
  return out;
}

const settingsSchema = z.object({
  timeZone: z.string().optional(),
  workingHours: z.record(z.string(), z.array(z.object({
    start: z.string(),
    end: z.string(),
  }))).optional(),
});

type SettingsValues = z.infer<typeof settingsSchema>;

export function SchedulingSettingsForm({
  initialTimeZone,
  initialWorkingHours,
}: {
  initialTimeZone: string | null;
  initialWorkingHours: WorkingHours | null;
}) {
  const timeZones = useMemo(() => getTimeZones(), []);
  const queryClient = useQueryClient();

  const defaultValues: SettingsValues = {
    timeZone: initialTimeZone || "",
    workingHours: initialWorkingHours ? normalizeWorkingHours(initialWorkingHours) : {},
  };

  const form = useForm({
    defaultValues,
    validators: {
      onChange: settingsSchema,
    },
  });

  const timeZone = form.getFieldValue("timeZone") as string;
  const workingHours = form.getFieldValue("workingHours") as Record<string, WorkingHoursInterval[]>;

  const saveMutation = useMutation({
    mutationFn: () =>
      updateInstructorSettings({
        timeZone: timeZone || null,
        workingHours: workingHours || {},
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["instructorSettings"] });
    },
  });

  const saving = saveMutation.isPending;
  const message = saveMutation.isSuccess
    ? "Saved."
    : saveMutation.error instanceof Error
      ? saveMutation.error.message
      : null;

  function handleDayToggle(day: number, enabled: boolean, start: string, end: string) {
    const dayKey = String(day);
    const current = (workingHours || {})[dayKey] || [];
    
    if (enabled) {
      form.setFieldValue(`workingHours.${dayKey}`, [{ start, end }]);
    } else {
      form.setFieldValue(`workingHours.${dayKey}`, []);
    }
  }

  function handleTimeChange(day: number, field: 'start' | 'end', value: string) {
    const dayKey = String(day);
    const current = (workingHours || {})[dayKey] || [];
    const currentInterval = current[0] || { start: "09:00", end: "17:00" };
    
    form.setFieldValue(`workingHours.${dayKey}`, [{ ...currentInterval, [field]: value }]);
  }

  function save() {
    saveMutation.mutate();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Scheduling Settings</CardTitle>
        <CardDescription>
          Set your timezone and working hours. Student-visible slots will be filtered by these rules
          and your Google Calendar availability.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form.Field name="timeZone">
          {(field) => (
            <div className="space-y-2">
              <label className="text-sm font-medium">Time zone</label>
              <select
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={field.state.value as string}
                onChange={(e) => field.handleChange(e.target.value)}
              >
                <option value="">(not set)</option>
                {timeZones.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                Use an IANA timezone (e.g. <code>America/Los_Angeles</code>).
              </p>
            </div>
          )}
        </form.Field>

        <div className="space-y-3">
          <div className="text-sm font-medium">Working hours</div>
          <div className="grid gap-3">
            {([0, 1, 2, 3, 4, 5, 6] as const).map((day) => {
              const intervals = (workingHours || {})[String(day)] || [];
              const enabled = intervals.length > 0;
              const start = intervals[0]?.start ?? "09:00";
              const end = intervals[0]?.end ?? "17:00";

              return (
                <div key={day} className="flex flex-wrap items-center gap-3 rounded-md border p-3">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={(e) => handleDayToggle(day, e.target.checked, start, end)}
                    />
                    <span className="text-sm">{dayLabels[day]}</span>
                  </label>

                  <div className="flex items-center gap-2">
                    <input
                      type="time"
                      disabled={!enabled}
                      value={start}
                      onChange={(e) => handleTimeChange(day, 'start', e.target.value)}
                      className="rounded-md border bg-background px-2 py-1 text-sm"
                    />
                    <span className="text-sm text-muted-foreground">to</span>
                    <input
                      type="time"
                      disabled={!enabled}
                      value={end}
                      onChange={(e) => handleTimeChange(day, 'end', e.target.value)}
                      className="rounded-md border bg-background px-2 py-1 text-sm"
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            For now, we support one interval per day (we can extend to multiple later).
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button type="button" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save settings"}
          </Button>
          {message && <p className="text-sm text-muted-foreground">{message}</p>}
        </div>
      </CardContent>
    </Card>
  );
}
