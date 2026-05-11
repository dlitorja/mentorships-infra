"use client";

import { AlertCircle, AlertTriangle, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUnacknowledgedRetentionNotifications, useAcknowledgeRetentionNotification } from "@/lib/queries/convex/use-workspaces";

const EIGHTEEN_MONTHS_MS = 18 * 30 * 24 * 60 * 60 * 1000;

function getDaysUntilDeletion(endedAt: number): number {
  return Math.max(0, Math.ceil((endedAt + EIGHTEEN_MONTHS_MS - Date.now()) / (24 * 60 * 60 * 1000)));
}

function getSeverity(days: number) {
  if (days <= 7) return { className: "border-red-500 bg-red-50 text-red-800", icon: AlertCircle };
  if (days <= 30) return { className: "border-yellow-500 bg-yellow-50 text-yellow-800", icon: AlertTriangle };
  return { className: "border-blue-500 bg-blue-50 text-blue-800", icon: Clock };
}

export function RetentionWarningBanner({ workspaceId, endedAt }: { workspaceId: string; endedAt: number }) {
  const { data: notifications } = useUnacknowledgedRetentionNotifications();
  const acknowledge = useAcknowledgeRetentionNotification();

  const notification = notifications?.find(
    (n) => String(n.workspaceId) === workspaceId && n.notificationType === "expiry_warning"
  );

  if (!notification) return null;

  const daysUntilDeletion = getDaysUntilDeletion(endedAt);
  const { className, icon: Icon } = getSeverity(daysUntilDeletion);

  return (
    <div className={`rounded-lg border p-4 ${className}`}>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <Icon className="h-5 w-5 mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">
              This workspace will be permanently deleted in {daysUntilDeletion} day{daysUntilDeletion !== 1 ? "s" : ""}
            </p>
            <p className="text-sm opacity-80 mt-0.5">
              Download your data before the retention period ends to avoid permanent loss.
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={() => acknowledge.mutate({ id: notification._id })}
          disabled={acknowledge.isPending}
        >
          Dismiss
        </Button>
      </div>
    </div>
  );
}