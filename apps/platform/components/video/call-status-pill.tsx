"use client";

import { useEffect, useState } from "react";
import {
  Phone,
  PhoneOff,
  Video,
  VideoOff,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useVideoCallContext } from "@/lib/video/video-context";
import { cn } from "@/lib/utils";

/**
 * Format `seconds` as `HH:MM:SS` for calls that cross the 1-hour
 * mark (PR #3 sessions can run up to 4 hours per the join window),
 * and `MM:SS` for shorter calls. Zero-pads each segment so the
 * duration chip's monospace width stays stable.
 */
function formatDuration(seconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  if (hours > 0) {
    return `${pad(hours)}:${pad(minutes)}:${pad(secs)}`;
  }
  return `${pad(minutes)}:${pad(secs)}`;
}

/**
 * Format the countdown label for a scheduled session. Mirrors
 * `formatDuration` granularity — seconds when under a minute, minutes
 * when under an hour, hours when under a day, days beyond.
 */
function formatCountdown(msUntil: number): string {
  const clamped = Math.max(0, msUntil);
  const minutes = Math.floor(clamped / 60_000);
  const seconds = Math.floor((clamped % 60_000) / 1000);
  if (minutes >= 60 * 24) {
    const days = Math.floor(minutes / (60 * 24));
    return `Opens in ${days}d`;
  }
  if (minutes >= 60) {
    return `Opens in ${Math.ceil(minutes / 60)}h`;
  }
  if (minutes >= 1) {
    return `Opens in ${minutes}m ${seconds.toString().padStart(2, "0")}s`;
  }
  return `Opens in ${seconds}s`;
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
 * `status === "joined"`.
 */
export function CallStatusPill({
  className,
}: {
  className?: string;
}): React.ReactElement | null {
  const {
    session,
    status,
    durationSeconds,
    errorMessage,
    join,
    leave,
  } = useVideoCallContext();

  // Tick once per second so the countdown chip ("Opens in 4m 30s")
  // updates without requiring a parent re-render. The interval is
  // only mounted when the pill is in the "scheduled" state.
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!session || session.status !== "scheduled") return;
    const interval = window.setInterval(() => {
      setNow(Date.now());
    }, 1_000);
    return () => {
      window.clearInterval(interval);
    };
  }, [session]);

  const handleJoin = (): void => {
    join().catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      toast.error("Could not join call", { description: message });
    });
  };

  if (!session) {
    return null;
  }

  const isInCall =
    status === "joined" || status === "joining" || status === "leaving";
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
        <Button type="button" variant="outline" size="sm" onClick={handleJoin}>
          Retry
        </Button>
      </div>
    );
  }

  if (session.status === "active") {
    return (
      <Button type="button" variant="default" size="sm" onClick={handleJoin}>
        <Video className="h-4 w-4" />
        Open call
      </Button>
    );
  }

  if (session.status === "joinable") {
    return (
      <Button type="button" variant="default" size="sm" onClick={handleJoin}>
        <Phone className="h-4 w-4" />
        Join Call
      </Button>
    );
  }

  // scheduled (future, not yet in window) — use the tick `now` so the
  // countdown stays fresh without a parent re-render.
  const msUntil = session.windowOpensAt - now;
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-sm text-muted-foreground">
        <VideoOff className="h-4 w-4" />
        <span className="font-mono tabular-nums">
          {formatCountdown(msUntil)}
        </span>
      </div>
      <Button type="button" variant="outline" size="sm" disabled>
        <Loader2 className="h-4 w-4" />
        Scheduled
      </Button>
    </div>
  );
}
