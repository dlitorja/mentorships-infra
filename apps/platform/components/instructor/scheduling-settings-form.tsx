"use client";

import React from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { updateInstructorSettings } from "@/lib/queries/api-client";
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

const timeZones = getTimeZones();
const NOT_SET_VALUE = "__not_set__";

interface SchedulingSettingsFormProps {
  initialTimeZone: string | null;
  initialWorkingHours: WorkingHours | null;
}

export function SchedulingSettingsForm({
  initialTimeZone,
  initialWorkingHours,
}: SchedulingSettingsFormProps) {
  const [timeZone, setTimeZone] = React.useState<string>(initialTimeZone ?? "");
  const [workingHours, setWorkingHours] = React.useState<WorkingHours>(initialWorkingHours ?? {});
  const baseId = React.useId();

  const saveMutation = useMutation({
    mutationFn: (data: { timeZone: string | null; workingHours: WorkingHours }) => {
      return updateInstructorSettings({
        timeZone: data.timeZone,
        workingHours: data.workingHours,
      });
    },
    onSuccess: (_, variables) => {
      setTimeZone(variables.timeZone ?? "");
      setWorkingHours(variables.workingHours);
      toast.success("Settings saved successfully");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to save settings");
    },
  });

  const saving = saveMutation.isPending;

  function handleTimeZoneChange(value: string) {
    setTimeZone(value === NOT_SET_VALUE ? "" : value);
  }

  function handleDayToggle(day: number, enabled: boolean) {
    const dayKey = String(day);
    const current = workingHours[dayKey] || [];

    if (enabled && current.length === 0) {
      setWorkingHours({ ...workingHours, [dayKey]: [{ start: "09:00", end: "17:00" }] });
    } else if (!enabled) {
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
    const tzToSave = timeZone || null;
    saveMutation.mutate({ timeZone: tzToSave, workingHours });
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
        <div className="space-y-2">
          <Label htmlFor={`${baseId}-timezone`}>Time zone</Label>
          <Select value={timeZone || NOT_SET_VALUE} onValueChange={handleTimeZoneChange}>
            <SelectTrigger id={`${baseId}-timezone`} className="w-full">
              <SelectValue placeholder="Select a timezone" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NOT_SET_VALUE}>(not set)</SelectItem>
              {timeZones.map((tz) => (
                <SelectItem key={tz} value={tz}>
                  {tz}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Use an IANA timezone (e.g. <code>America/Los_Angeles</code>).
          </p>
        </div>

        <div className="space-y-3">
          <div className="text-sm font-medium">Working hours</div>
          <div className="grid gap-3">
            {([0, 1, 2, 3, 4, 5, 6] as const).map((day) => {
              const intervals = workingHours[String(day)] || [];
              const enabled = intervals.length > 0;
              const dayId = `${baseId}-day-${day}`;

              return (
                <div key={day} className="rounded-md border p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id={dayId}
                        checked={enabled}
                        onCheckedChange={(checked) => handleDayToggle(day, checked === true)}
                      />
                      <Label htmlFor={dayId} className="text-sm font-medium">
                        {dayLabels[day]}
                      </Label>
                    </div>
                    {enabled && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => addInterval(day)}
                        className="h-8 px-2"
                        aria-label={`Add interval for ${dayLabels[day]}`}
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    )}
                  </div>

                  {enabled && (
                    <div className="space-y-2 ml-6">
                      {intervals.map((interval, index) => (
                        <div key={index} className="flex items-center gap-2">
                          <Input
                            type="time"
                            id={`${dayId}-start-${index}`}
                            value={interval.start}
                            onChange={(e) => handleTimeChange(day, index, 'start', e.target.value)}
                            className="w-auto"
                            aria-label={`Start time for ${dayLabels[day]} interval ${index + 1}`}
                          />
                          <span className="text-sm text-muted-foreground">to</span>
                          <Input
                            type="time"
                            id={`${dayId}-end-${index}`}
                            value={interval.end}
                            onChange={(e) => handleTimeChange(day, index, 'end', e.target.value)}
                            className="w-auto"
                            aria-label={`End time for ${dayLabels[day]} interval ${index + 1}`}
                          />
                          {intervals.length > 1 && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => removeInterval(day, index)}
                              className="h-8 px-2 text-red-500 hover:text-red-600"
                              aria-label={`Remove ${dayLabels[day]} interval ${index + 1}`}
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
