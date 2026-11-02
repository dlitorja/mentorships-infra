"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { Loader2, RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { updateInstructorSettings } from "@/lib/queries/api-client";
import {
  buildZoneGroups,
  detectClientTimezone,
  friendlyOffsetLabel,
} from "@/lib/timezones";

interface InstructorTimezoneSettingsFormProps {
  /** Saved IANA zone on the instructor record, or null. */
  initialTimeZone: string | null;
}

/**
 * Minimal instructor timezone settings card.
 *
 * Deliberately scoped to timezone only — availability and scheduling
 * controls live on `/instructor/availability` and are not surfaced
 * here. The saved zone is used by the onboarding review card to tell
 * the instructor how the student's timezone compares to their own.
 */
export function InstructorTimezoneSettingsForm({
  initialTimeZone,
}: InstructorTimezoneSettingsFormProps) {
  const router = useRouter();
  const [detected, setDetected] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>(initialTimeZone ?? "");
  const [savedAs, setSavedAs] = useState<string | null>(initialTimeZone);

  const groups = useMemo(() => buildZoneGroups(), []);
  const now = useMemo(() => new Date(), []);

  useEffect(() => {
    const nextDetected = detectClientTimezone();
    setDetected(nextDetected);
    setSelected((current) => current || nextDetected || "");
  }, []);

  const saveMutation = useMutation({
    mutationFn: (timeZone: string) =>
      updateInstructorSettings({ timeZone }),
    onSuccess: (_result, timeZone) => {
      setSavedAs(timeZone);
      setSelected(timeZone);
      toast.success("Timezone saved", {
        description: "Future timezone comparisons use this zone.",
      });
      router.refresh();
    },
    onError: (error) => {
      toast.error("Couldn't save your timezone", {
        description:
          error instanceof Error ? error.message : "Please try again.",
      });
    },
  });

  function save(timeZone: string): void {
    if (!timeZone) return;
    saveMutation.mutate(timeZone);
  }

  // Include the selected zone even if the runtime's IANA list omits it
  // (e.g. an older saved value) so the dropdown never shows blank.
  const groupsWithSelected = useMemo(() => {
    if (!selected) return groups;
    const present = groups.some((group) => group.zones.includes(selected));
    if (present) return groups;
    return [{ group: "Saved zone", zones: [selected] }, ...groups];
  }, [groups, selected]);

  const saving = saveMutation.isPending;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Time zone</CardTitle>
        <CardDescription>
          Used to show you how a student&apos;s timezone compares to yours
          while reviewing their onboarding. Availability and scheduling stay
          on the availability page.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="instructor-timezone" className="text-sm font-medium">
            Timezone
          </label>
          <Select
            value={selected}
            onValueChange={(value) => setSelected(value)}
            disabled={saving}
          >
            <SelectTrigger id="instructor-timezone" className="w-full sm:max-w-md">
              <SelectValue placeholder="Select a timezone" />
            </SelectTrigger>
            <SelectContent className="max-h-80">
              {groupsWithSelected.map((group) => (
                <SelectGroup key={group.group}>
                  <SelectLabel>{group.group}</SelectLabel>
                  {group.zones.map((zone) => (
                    <SelectItem key={zone} value={zone}>
                      {zone}
                      {friendlyOffsetLabel(zone, now)
                        ? ` (${friendlyOffsetLabel(zone, now)})`
                        : ""}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Detected from your browser:{" "}
            {detected ? (
              <span className="font-medium text-foreground">{detected}</span>
            ) : (
              <span className="italic">unavailable — pick one manually</span>
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            {savedAs
              ? `Saved: ${savedAs}`
              : detected
                ? `No saved timezone yet — comparisons use the browser-detected ${detected} until you save one.`
                : "No saved timezone yet."}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            onClick={() => save(selected)}
            disabled={!selected || saving}
          >
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            <Save className="mr-2 h-4 w-4" />
            Save timezone
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => detected && save(detected)}
            disabled={!detected || saving}
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            Reset to auto-detected
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
