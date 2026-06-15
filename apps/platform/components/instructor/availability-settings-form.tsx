"use client";

import React, { useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

  const defaultValues: AvailabilityValues = {
    bufferMinutesBetweenSessions: initialBufferMinutes ?? 0,
    minBookingLeadMinutes: initialMinBookingLeadMinutes ?? 1440,
    maxBookingAdvanceDays: initialMaxBookingAdvanceDays ?? 30,
    blockedDateRanges: initialBlockedDateRanges ?? [],
  };

  const form = useForm({
    defaultValues,
    validators: {
      onChange: availabilitySettingsSchema,
    },
  });

  const blockedDateRanges = form.getFieldValue("blockedDateRanges") as BlockedDateRange[] ?? [];

  function logDebug(...args: unknown[]): void {
    if (process.env.NODE_ENV !== "production") {
      console.log(...args);
    }
  }

  const saveMutation = useMutation({
    mutationFn: (capturedData: AvailabilityValues) => {
      logDebug(
        "[DEBUG AvailabilitySettingsForm] saveMutation.mutationFn",
        "buffer:", capturedData.bufferMinutesBetweenSessions,
        "minLead:", capturedData.minBookingLeadMinutes,
        "maxAdvance:", capturedData.maxBookingAdvanceDays,
        "blocked:", capturedData.blockedDateRanges?.length ?? 0
      );
      return updateInstructorSettings({
        timeZone: null,
        workingHours: {},
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
      logDebug("[DEBUG AvailabilitySettingsForm] saveMutation.onError - error:", error instanceof Error ? error.message : String(error));
      toast.error(error instanceof Error ? error.message : "Failed to save settings");
    },
  });

  const saving = saveMutation.isPending;

  function addBlockedRange() {
    const today = new Date().toISOString().split("T")[0];
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split("T")[0];
    form.setFieldValue("blockedDateRanges", [...blockedDateRanges, { start: today, end: tomorrow, label: "Busy" }]);
  }

  function removeBlockedRange(index: number) {
    form.setFieldValue("blockedDateRanges", blockedDateRanges.filter((_, i) => i !== index));
  }

  function updateBlockedRange(index: number, field: "start" | "end" | "label", value: string) {
    const updated = [...blockedDateRanges];
    updated[index] = { ...updated[index], [field]: value };
    form.setFieldValue("blockedDateRanges", updated);
  }

  function save() {
    const values = form.getState().values;
    saveMutation.mutate(values as AvailabilityValues);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Availability Settings</CardTitle>
        <CardDescription>
          Configure booking rules, buffer times, and blocked dates for your availability.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="bufferMinutesBetweenSessions">Buffer between sessions</Label>
            <select
              id="bufferMinutesBetweenSessions"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={form.getFieldValue("bufferMinutesBetweenSessions") ?? 0}
              onChange={(e) => form.setFieldValue("bufferMinutesBetweenSessions", parseInt(e.target.value) || 0)}
            >
              <option value={0}>No buffer</option>
              <option value={5}>5 minutes</option>
              <option value={10}>10 minutes</option>
              <option value={15}>15 minutes</option>
              <option value={30}>30 minutes</option>
              <option value={60}>1 hour</option>
            </select>
            <p className="text-xs text-muted-foreground">
              Gap between sessions when students cannot book.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="minBookingLeadMinutes">Minimum booking notice</Label>
            <select
              id="minBookingLeadMinutes"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={form.getFieldValue("minBookingLeadMinutes") ?? 1440}
              onChange={(e) => form.setFieldValue("minBookingLeadMinutes", parseInt(e.target.value) || 1440)}
            >
              <option value={60}>1 hour</option>
              <option value={240}>4 hours</option>
              <option value={720}>12 hours</option>
              <option value={1440}>24 hours</option>
              <option value={2880}>48 hours</option>
              <option value={4320}>72 hours</option>
            </select>
            <p className="text-xs text-muted-foreground">
              How far in advance students must book.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="maxBookingAdvanceDays">Maximum advance booking</Label>
            <select
              id="maxBookingAdvanceDays"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={form.getFieldValue("maxBookingAdvanceDays") ?? 30}
              onChange={(e) => form.setFieldValue("maxBookingAdvanceDays", parseInt(e.target.value) || 30)}
            >
              <option value={7}>7 days</option>
              <option value={14}>14 days</option>
              <option value={30}>30 days</option>
              <option value={60}>60 days</option>
              <option value={90}>90 days</option>
              <option value={180}>180 days</option>
              <option value={365}>1 year</option>
            </select>
            <p className="text-xs text-muted-foreground">
              How far ahead students can book sessions.
            </p>
          </div>
        </div>

        <div className="space-y-3">
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
                      <Label className="text-xs">Start date</Label>
                      <Input
                        type="date"
                        value={range.start}
                        onChange={(e) => updateBlockedRange(index, "start", e.target.value)}
                        className="h-8"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">End date</Label>
                      <Input
                        type="date"
                        value={range.end}
                        onChange={(e) => updateBlockedRange(index, "end", e.target.value)}
                        className="h-8"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Label (optional)</Label>
                      <Input
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
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          <Button type="button" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save availability settings"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}