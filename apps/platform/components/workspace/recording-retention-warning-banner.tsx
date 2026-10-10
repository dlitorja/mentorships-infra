"use client";

import { AlertCircle, AlertTriangle, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  useAcknowledgeAllRecordingRetentionNotifications,
  useUnacknowledgedRecordingRetentionNotifications,
} from "@/lib/queries/convex/use-recordings";

/**
 * R12: in-app banner that surfaces unacknowledged
 * call-recording retention warnings for the current user.
 * Mirrors the workspace retention banner at
 * `apps/platform/components/workspace/retention-warning-banner.tsx`
 * — same severity palette (red ≤7d, yellow ≤30d, blue
 * otherwise) and same ack/dismiss interaction.
 *
 * The banner aggregates all unacknowledged notifications for
 * the user across every workspace; the worst (smallest
 * ACTUAL remaining time, computed from `recordingExpiresAt`)
 * drives the severity, and the message surfaces the count so
 * multi-recording cases don't bury the warning under a single
 * countdown.
 *
 * Greptile R5 P1 (fix): the headline used to read from the
 * static `daysUntilDeletion` dedup key (always 7), which would
 * promise 7 days even when the actual expiry was in hours. We
 * now compute the remaining time from `recordingExpiresAt` at
 * render time so the user sees the truth.
 *
 * Greptile P2 (fix): "Dismiss" now calls the bulk mutation
 * `acknowledgeAllRecordingRetentionNotifications` instead of
 * acking a single row at a time. The previous loop cycled
 * through one notification per click and the banner would
 * re-render to show the next pending row immediately,
 * making "Dismiss" feel broken.
 */

function getSeverity(actualRemainingDays: number) {
  if (actualRemainingDays <= 7) return { className: "border-red-500 bg-red-50 text-red-800", icon: AlertCircle };
  if (actualRemainingDays <= 30) return { className: "border-yellow-500 bg-yellow-50 text-yellow-800", icon: AlertTriangle };
  return { className: "border-blue-500 bg-blue-50 text-blue-800", icon: Clock };
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function formatActualRemaining(recordingExpiresAt: number, now: number): string {
  const remainingMs = recordingExpiresAt - now;
  if (remainingMs <= 0) return "less than an hour";
  if (remainingMs < DAY_MS) {
    const hours = Math.max(1, Math.ceil(remainingMs / HOUR_MS));
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  const days = Math.ceil(remainingMs / DAY_MS);
  return `${days} day${days === 1 ? "" : "s"}`;
}

export function RecordingRetentionWarningBanner() {
  const { data: notifications } =
    useUnacknowledgedRecordingRetentionNotifications();
  const acknowledgeAll =
    useAcknowledgeAllRecordingRetentionNotifications();

  const list = notifications ?? [];
  if (list.length === 0) return null;

  // Compute actual remaining time per notification from the stored
  // `recordingExpiresAt`, not from the static `daysUntilDeletion`
  // dedup key. The worst (smallest actual remaining) drives severity.
  const now = Date.now();
  const remainingBySession = list.map((n) => ({
    n,
    actualRemainingMs: Math.max(0, n.recordingExpiresAt - now),
  }));
  const worstRemainingMs = remainingBySession.reduce(
    (min, x) => Math.min(min, x.actualRemainingMs),
    Number.POSITIVE_INFINITY
  );
  const worstRemainingDays = Math.ceil(worstRemainingMs / DAY_MS);
  const { className, icon: Icon } = getSeverity(worstRemainingDays);
  const worstText = formatActualRemaining(
    now + worstRemainingMs,
    now
  );

  const headline =
    list.length === 1
      ? `A call recording will be permanently deleted in ${worstText}`
      : `${list.length} call recordings will be permanently deleted — soonest in ${worstText}`;

  return (
    <div className={`rounded-lg border p-4 ${className}`}>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <Icon className="h-5 w-5 mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">{headline}</p>
            <p className="text-sm opacity-80 mt-0.5">
              Download the recording from the Calls section before the
              retention period ends to keep a copy.
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={() => acknowledgeAll.mutate()}
          disabled={acknowledgeAll.isPending}
        >
          Dismiss
        </Button>
      </div>
    </div>
  );
}
