"use client";

import { Phone, PhoneOff, Video, VideoOff, Loader2, AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useVideoCallContext } from "@/lib/video/video-context";
import { cn } from "@/lib/utils";

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

/**
 * Inline status indicator + Join/End button for the workspace UI.
 *
 * Three visual states:
 *   - `active`     → green dot + duration timer + End Call button (red)
 *   - `joinable`   → blue dot + "Join Call" button (primary)
 *   - `scheduled`  → gray dot + countdown chip + disabled "Scheduled" button
 *   - error/idle   → muted "—" + tooltip-style error
 *
 * Used in the action row between the workspace header Card and the
 * TabsList. The full VideoPanel mounts below the tabs only when
 * `status === "active"`.
 */
export function CallStatusPill({ className }: { className?: string }) {
  const {
    session,
    status,
    durationSeconds,
    errorMessage,
    join,
    leave,
  } = useVideoCallContext();

  if (!session) {
    return null;
  }

  const isInCall = status === "joined" || status === "joining" || status === "leaving";
  const isError = status === "error";

  if (isInCall) {
    return (
      <div className={cn("flex items-center gap-3", className)}>
        <div className="flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-sm">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          <span className="font-medium">In call</span>
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {formatDuration(durationSeconds)}
          </span>
        </div>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          onClick={() => void leave()}
          disabled={status === "leaving"}
        >
          <PhoneOff className="h-4 w-4" />
          End Call
        </Button>
      </div>
    );
  }

  if (isError) {
    return (
      <div className={cn("flex items-center gap-2", className)}>
        <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-1.5 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" />
          <span className="truncate max-w-[200px]" title={errorMessage ?? "Call error"}>
            {errorMessage ?? "Call error"}
          </span>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void join()}
        >
          Retry
        </Button>
      </div>
    );
  }

  if (session.status === "active") {
    return (
      <Button type="button" variant="default" size="sm" onClick={() => void join()}>
        <Video className="h-4 w-4" />
        Open call
      </Button>
    );
  }

  if (session.status === "joinable") {
    return (
      <Button type="button" variant="default" size="sm" onClick={() => void join()}>
        <Phone className="h-4 w-4" />
        Join Call
      </Button>
    );
  }

  // scheduled (future, not yet in window)
  const minutesUntil = Math.max(
    0,
    Math.ceil((session.windowOpensAt - Date.now()) / 60_000)
  );
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-sm text-muted-foreground">
        <VideoOff className="h-4 w-4" />
        <span>
          {minutesUntil > 60
            ? `Opens in ${Math.ceil(minutesUntil / 60)}h`
            : `Opens in ${minutesUntil}m`}
        </span>
      </div>
      <Button type="button" variant="outline" size="sm" disabled>
        <Loader2 className="h-4 w-4" />
        Scheduled
      </Button>
    </div>
  );
}
