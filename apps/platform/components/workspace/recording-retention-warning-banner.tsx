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
 * `daysUntilDeletion`) drives the severity, and the message
 * surfaces the count so multi-recording cases don't bury the
 * warning under a single countdown.
 *
 * Greptile P2 (fix): "Dismiss" now calls the bulk mutation
 * `acknowledgeAllRecordingRetentionNotifications` instead of
 * acking a single row at a time. The previous loop cycled
 * through one notification per click and the banner would
 * re-render to show the next pending row immediately,
 * making "Dismiss" feel broken.
 */

function getSeverity(days: number) {
  if (days <= 7) return { className: "border-red-500 bg-red-50 text-red-800", icon: AlertCircle };
  if (days <= 30) return { className: "border-yellow-500 bg-yellow-50 text-yellow-800", icon: AlertTriangle };
  return { className: "border-blue-500 bg-blue-50 text-blue-800", icon: Clock };
}

export function RecordingRetentionWarningBanner() {
  const { data: notifications } =
    useUnacknowledgedRecordingRetentionNotifications();
  const acknowledgeAll =
    useAcknowledgeAllRecordingRetentionNotifications();

  const list = notifications ?? [];
  if (list.length === 0) return null;

  // Pick the smallest daysUntilDeletion for severity. If the
  // worst one is already ≤7d we colour red; otherwise yellow
  // up to 30d; blue beyond that.
  const worstDays = list.reduce(
    (min, n) => Math.min(min, n.daysUntilDeletion),
    Number.POSITIVE_INFINITY
  );
  const { className, icon: Icon } = getSeverity(worstDays);

  const headline =
    list.length === 1
      ? `A call recording will be permanently deleted in ${worstDays} day${
          worstDays === 1 ? "" : "s"
        }`
      : `${list.length} call recordings will be permanently deleted — soonest in ${worstDays} day${
          worstDays === 1 ? "" : "s"
        }`;

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
