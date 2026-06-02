"use client";

import { useRouter } from "next/navigation";
import { Id } from "@/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { SessionActions } from "./session-actions";

type SessionCardData = {
  id: Id<"sessions">;
  scheduledAt: number;
  status: string;
  studentEmail: string | null;
  notes?: string | null;
  remainingSessions?: number | null;
};

function formatDateTime(date: number): string {
  return new Date(date).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

type UpcomingSessionCardProps = {
  session: SessionCardData;
};

export function UpcomingSessionCard({ session }: UpcomingSessionCardProps) {
  const router = useRouter();

  function handleRefresh() {
    router.refresh();
  }

  return (
    <div className="border rounded-lg p-4 space-y-2">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="font-semibold">
            {session.studentEmail ?? "Unknown student"}
          </p>
          <p className="text-sm text-muted-foreground">
            {formatDateTime(session.scheduledAt)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">Scheduled</Badge>
          <SessionActions session={session} onSessionUpdated={handleRefresh} />
        </div>
      </div>
    </div>
  );
}

type PastSessionCardProps = {
  session: SessionCardData & {
    completedAt: number | null;
    canceledAt: number | null;
  };
};

export function PastSessionCard({ session }: PastSessionCardProps) {
  const router = useRouter();

  function handleRefresh() {
    router.refresh();
  }

  return (
    <div className="border rounded-lg p-4 space-y-2">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="font-semibold">
            {session.studentEmail ?? "Unknown student"}
          </p>
          <p className="text-sm text-muted-foreground">
            {session.completedAt
              ? `Completed ${formatDateTime(session.completedAt)}`
              : session.status === "canceled"
              ? `Canceled ${formatDateTime(session.canceledAt || session.scheduledAt)}`
              : session.status === "no_show"
              ? `No show ${formatDateTime(session.scheduledAt)}`
              : `Ended ${formatDateTime(session.scheduledAt)}`}
          </p>
          {session.notes && (
            <p className="text-xs text-muted-foreground mt-1">
              Notes: {session.notes}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant={
              session.status === "completed"
                ? "default"
                : session.status === "canceled"
                ? "destructive"
                : "outline"
            }
          >
            {session.status}
          </Badge>
          <SessionActions session={session} onSessionUpdated={handleRefresh} allowedActions={["notes"]} />
        </div>
      </div>
    </div>
  );
}