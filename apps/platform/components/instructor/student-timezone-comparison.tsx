"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Globe2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  describeTimeZoneDifference,
  detectClientTimezone,
  friendlyOffsetLabel,
} from "@/lib/timezones";

interface StudentTimezoneComparisonProps {
  studentTimeZone: string | null | undefined;
  /**
   * The viewing instructor's saved IANA zone. Null when they have not
   * saved one yet (or when the viewer is admin/support) — in that case
   * we fall back to the browser-detected zone so the comparison still
   * renders.
   */
  instructorTimeZone: string | null | undefined;
  /** Only instructors can reach `/instructor/settings`. */
  canEditInstructorTimeZone: boolean;
}

/**
 * Reviewer-facing timezone context on `/onboarding/[id]`.
 *
 * Shows the student's zone, the instructor's zone (saved or
 * browser-detected), and how far ahead/behind the student is. If the
 * instructor has no saved zone, this also links to Settings so they
 * can save one.
 */
export function StudentTimezoneComparison({
  studentTimeZone,
  instructorTimeZone,
  canEditInstructorTimeZone,
}: StudentTimezoneComparisonProps) {
  const [detected, setDetected] = useState<string | null>(null);
  useEffect(() => {
    setDetected(detectClientTimezone());
  }, []);

  const now = useMemo(() => new Date(), []);
  const effectiveInstructorZone = instructorTimeZone || detected;
  const usingDetected = !instructorTimeZone && Boolean(detected);
  const comparison = describeTimeZoneDifference(
    studentTimeZone,
    effectiveInstructorZone,
    now
  );

  return (
    <div className="space-y-1 rounded-md border bg-muted/30 p-3">
      <p className="flex items-center gap-2 text-sm font-medium">
        <Globe2 className="h-4 w-4 text-muted-foreground" aria-hidden />
        Student timezone
      </p>
      {studentTimeZone ? (
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{studentTimeZone}</span>
          {friendlyOffsetLabel(studentTimeZone, now)
            ? ` (${friendlyOffsetLabel(studentTimeZone, now)})`
            : ""}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground italic">
          Student hasn&apos;t set a timezone yet.
        </p>
      )}

      {effectiveInstructorZone && (
        <p className="text-sm text-muted-foreground">
          Your timezone:{" "}
          <span className="font-medium text-foreground">
            {effectiveInstructorZone}
          </span>
          {friendlyOffsetLabel(effectiveInstructorZone, now)
            ? ` (${friendlyOffsetLabel(effectiveInstructorZone, now)})`
            : ""}
          {usingDetected ? " — auto-detected from your browser, not saved" : ""}
        </p>
      )}

      {comparison && (
        <p className="text-sm font-medium">{comparison.label}</p>
      )}

      {!comparison && studentTimeZone && !effectiveInstructorZone && (
        <p className="text-sm text-muted-foreground">
          We couldn&apos;t detect your timezone. Save one in Settings to
          compare.
        </p>
      )}

      {canEditInstructorTimeZone && !instructorTimeZone && (
        <Button asChild size="sm" variant="outline" className="mt-2">
          <Link href="/instructor/settings">Set your timezone</Link>
        </Button>
      )}
    </div>
  );
}
