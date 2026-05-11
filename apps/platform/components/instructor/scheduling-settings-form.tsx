"use client";

import React, { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { updateInstructorSettings } from "@/lib/queries/api-client";
import { useForm } from "@tanstack/react-form";
import { z } from "zod";
import { Plus, Trash2 } from "lucide-react";

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
      toast.success("Settings saved successfully");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to save settings");
    },
  });

  const saving = saveMutation.isPending;

  function handleDayToggle(day: number, enabled: boolean) {
    const dayKey = String(day);
    const current = (workingHours || {})[dayKey] || [];
    
    if (enabled && current.length === 0) {
      form.setFieldValue(`workingHours.${dayKey}`, [{ start: "09:00", end: "17:00" }]);
    } else if (!enabled) {
      form.setFieldValue(`workingHours.${dayKey}`, []);
    }
  }

  function addInterval(day: number) {
    const dayKey = String(day);
    const current = (workingHours || {})[dayKey] || [];
    form.setFieldValue(`workingHours.${dayKey}`, [...current, { start: "09:00", end: "17:00" }]);
  }

  function removeInterval(day: number, index: number) {
    const dayKey = String(day);
    const current = (workingHours || {})[dayKey] || [];
    const updated = current.filter((_, i) => i !== index);
    form.setFieldValue(`workingHours.${dayKey}`, updated);
  }

  function handleTimeChange(day: number, index: number, field: 'start' | 'end', value: string) {
    const dayKey = String(day);
    const current = (workingHours || {})[dayKey] || [];
    const updated = [...current];
    updated[index] = { ...updated[index], [field]: value };
    form.setFieldValue(`workingHours.${dayKey}`, updated);
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
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => addInterval(day)}
                        className="h-8 px-2"
                      >
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
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => removeInterval(day, index)}
                              className="h-8 px-2 text-red-500 hover:text-red-600"
                            >
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
          <p className="text-xs text-muted-foreground">
            Add multiple intervals per day if you have breaks (e.g., 9am-12pm and 2pm-5pm).
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button type="button" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save settings"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
