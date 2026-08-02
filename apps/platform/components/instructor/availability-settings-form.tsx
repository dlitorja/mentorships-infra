"use client";

import React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { useForm } from "@tanstack/react-form";
import { z } from "zod";
import { Plus, Trash2 } from "lucide-react";

type BlockedDateRange = { start: string; end: string; label?: string };

const availabilitySettingsSchema = z.object({
  bufferMinutesBetweenSessions: z.number().int().min(0).max(60).optional(),
  minBookingLeadMinutes: z.number().int().min(0).max(10080).optional(),
  maxBookingAdvanceDays: z.number().int().min(1).max(365).optional(),
  blockedDateRanges: z.array(z.object({
    start: z.string(),
    end: z.string(),
    label: z.string().optional(),
  })).optional(),
});

type AvailabilityValues = z.infer<typeof availabilitySettingsSchema>;

const BUFFER_OPTIONS = [
  { value: 0, label: "No buffer" },
  { value: 5, label: "5 minutes" },
  { value: 10, label: "10 minutes" },
  { value: 15, label: "15 minutes" },
  { value: 30, label: "30 minutes" },
  { value: 60, label: "1 hour" },
];

const LEAD_TIME_OPTIONS = [
  { value: 60, label: "1 hour" },
  { value: 240, label: "4 hours" },
  { value: 720, label: "12 hours" },
  { value: 1440, label: "24 hours" },
  { value: 2880, label: "48 hours" },
  { value: 4320, label: "72 hours" },
];

const ADVANCE_OPTIONS = [
  { value: 7, label: "7 days" },
  { value: 14, label: "14 days" },
  { value: 30, label: "30 days" },
  { value: 60, label: "60 days" },
  { value: 90, label: "90 days" },
  { value: 180, label: "180 days" },
  { value: 365, label: "1 year" },
];

export function AvailabilitySettingsForm({
  initialBufferMinutes,
  initialMinBookingLeadMinutes,
  initialMaxBookingAdvanceDays,
  initialBlockedDateRanges,
}: {
  initialBufferMinutes: number | null;
  initialMinBookingLeadMinutes: number | null;
  initialMaxBookingAdvanceDays: number | null;
  initialBlockedDateRanges: BlockedDateRange[] | null;
}) {
  const queryClient = useQueryClient();
  const baseId = React.useId();

  const defaultValues: AvailabilityValues = {
    bufferMinutesBetweenSessions: initialBufferMinutes ?? 0,
    minBookingLeadMinutes: initialMinBookingLeadMinutes ?? 1440,
    maxBookingAdvanceDays: initialMaxBookingAdvanceDays ?? 30,
    blockedDateRanges: initialBlockedDateRanges ?? [],
  };

  const saveMutation = useMutation({
    mutationFn: (capturedData: AvailabilityValues) => {
      return updateInstructorSettings({
        bufferMinutesBetweenSessions: capturedData.bufferMinutesBetweenSessions ?? null,
        minBookingLeadMinutes: capturedData.minBookingLeadMinutes ?? null,
        maxBookingAdvanceDays: capturedData.maxBookingAdvanceDays ?? null,
        blockedDateRanges: capturedData.blockedDateRanges?.length ? capturedData.blockedDateRanges : null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["instructorSettings"] });
      toast.success("Availability settings saved successfully");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to save settings");
    },
  });

  const form = useForm({
    defaultValues,
    validators: {
      onChange: availabilitySettingsSchema,
    },
    onSubmit: async ({ value }) => {
      saveMutation.mutate(value);
    },
  });

  const saving = saveMutation.isPending || form.state.isSubmitting;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Availability Settings</CardTitle>
        <CardDescription>
          Configure booking rules, buffer times, and blocked dates for your availability.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            form.handleSubmit();
          }}
        >
          <div className="grid gap-6 md:grid-cols-2">
            <form.Field name="bufferMinutesBetweenSessions">
              {(field) => {
                const id = `${baseId}-${field.name}`;
                const value = field.state.value ?? 0;
                return (
                  <div className="space-y-2">
                    <Label htmlFor={id}>Buffer between sessions</Label>
                    <Select
                      value={String(value)}
                      onValueChange={(v) => field.handleChange(parseInt(v, 10) || 0)}
                    >
                      <SelectTrigger id={id} className="w-full">
                        <SelectValue placeholder="Select a buffer" />
                      </SelectTrigger>
                      <SelectContent>
                        {BUFFER_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={String(option.value)}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Gap between sessions when students cannot book.
                    </p>
                  </div>
                );
              }}
            </form.Field>

            <form.Field name="minBookingLeadMinutes">
              {(field) => {
                const id = `${baseId}-${field.name}`;
                const value = field.state.value ?? 1440;
                return (
                  <div className="space-y-2">
                    <Label htmlFor={id}>Minimum booking notice</Label>
                    <Select
                      value={String(value)}
                      onValueChange={(v) => field.handleChange(parseInt(v, 10) || 1440)}
                    >
                      <SelectTrigger id={id} className="w-full">
                        <SelectValue placeholder="Select a notice window" />
                      </SelectTrigger>
                      <SelectContent>
                        {LEAD_TIME_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={String(option.value)}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      How far in advance students must book.
                    </p>
                  </div>
                );
              }}
            </form.Field>

            <form.Field name="maxBookingAdvanceDays">
              {(field) => {
                const id = `${baseId}-${field.name}`;
                const value = field.state.value ?? 30;
                return (
                  <div className="space-y-2">
                    <Label htmlFor={id}>Maximum advance booking</Label>
                    <Select
                      value={String(value)}
                      onValueChange={(v) => field.handleChange(parseInt(v, 10) || 30)}
                    >
                      <SelectTrigger id={id} className="w-full">
                        <SelectValue placeholder="Select a booking window" />
                      </SelectTrigger>
                      <SelectContent>
                        {ADVANCE_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={String(option.value)}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      How far ahead students can book sessions.
                    </p>
                  </div>
                );
              }}
            </form.Field>
          </div>

          <form.Field name="blockedDateRanges" mode="array">
            {(field) => {
              const blockedDateRanges = field.state.value ?? [];

              function addBlockedRange() {
                const today = new Date().toISOString().split("T")[0];
                const tomorrow = new Date(Date.now() + 86400000).toISOString().split("T")[0];
                field.pushValue({ start: today, end: tomorrow, label: "Busy" });
              }

              function removeBlockedRange(index: number) {
                field.removeValue(index);
              }

              function updateBlockedRange(index: number, key: "start" | "end" | "label", value: string) {
                field.setValue((prev) => {
                  const ranges = prev ?? [];
                  const updated = [...ranges];
                  updated[index] = { ...updated[index], [key]: value };
                  return updated;
                });
              }

              return (
                <div className="space-y-3 mt-6">
                  <div className="flex items-center justify-between">
                    <Label>Blocked dates</Label>
                    <Button type="button" variant="outline" size="sm" onClick={addBlockedRange}>
                      <Plus className="h-4 w-4 mr-1" />
                      Add blocked range
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Block date ranges when you are unavailable (vacations, conferences, etc.).
                  </p>

                  {blockedDateRanges.length === 0 ? (
                    <div className="text-center py-4 text-muted-foreground text-sm border rounded-md">
                      No blocked dates set
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {blockedDateRanges.map((range, index) => (
                        <div key={index} className="flex items-center gap-3 p-3 border rounded-md">
                          <div className="flex-1 grid grid-cols-3 gap-3">
                            <div className="space-y-1">
                              <Label htmlFor={`${baseId}-blocked-start-${index}`} className="text-xs">Start date</Label>
                              <Input
                                id={`${baseId}-blocked-start-${index}`}
                                type="date"
                                value={range.start}
                                onChange={(e) => updateBlockedRange(index, "start", e.target.value)}
                                className="h-8"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label htmlFor={`${baseId}-blocked-end-${index}`} className="text-xs">End date</Label>
                              <Input
                                id={`${baseId}-blocked-end-${index}`}
                                type="date"
                                value={range.end}
                                onChange={(e) => updateBlockedRange(index, "end", e.target.value)}
                                className="h-8"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label htmlFor={`${baseId}-blocked-label-${index}`} className="text-xs">Label (optional)</Label>
                              <Input
                                id={`${baseId}-blocked-label-${index}`}
                                placeholder="Busy"
                                value={range.label ?? ""}
                                onChange={(e) => updateBlockedRange(index, "label", e.target.value)}
                                className="h-8"
                              />
                            </div>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => removeBlockedRange(index)}
                            className="h-8 px-2 text-red-500 hover:text-red-600"
                            aria-label="Remove blocked date range"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            }}
          </form.Field>

          <div className="flex items-center gap-3 mt-6">
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save availability settings"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
