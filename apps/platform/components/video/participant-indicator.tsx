"use client";

import { Users } from "lucide-react";

import { useVideoCallContext } from "@/lib/video/video-context";
import { cn } from "@/lib/utils";

/**
 * Small chip that surfaces the current participant count + the
 * remote participant's name during a video call. Mounted inside
 * `<CallOverlay>`'s header row so both parties see who is in the
 * room and how many participants are connected. Updates live as
 * Daily fires `participant-joined` / `participant-left` — see
 * `useVideoCall`'s participantCount state, which mirrors the
 * Daily event stream.
 *
 * PR platform-call-bugs: this is the user-visible "call
 * participants + total count" indicator requested in the
 * 4-issue arc. Daily.co does not ship a built-in participant
 * list chip in `@daily-co/daily-react@0.25.3`, so we render our
 * own. We deliberately do NOT enumerate every participant name
 * (Daily's tile view already shows each remote tile), since the
 * chip's purpose is a glanceable "who + how many" summary.
 *
 * Local participant is implied ("You" is always present), so the
 * count is `participantCount` (which includes the local
 * participant). When `remoteParticipantName` is set, we surface
 * it as "{name} + {count - 1} more" so the user can see who
 * they're calling without parsing a list.
 */
export function ParticipantIndicator({
  className,
}: {
  className?: string;
}): React.ReactElement | null {
  const { participantCount, remoteParticipantName } = useVideoCallContext();

  if (participantCount === 0) {
    return null;
  }

  const remoteCount = participantCount - 1;
  // Greptile round 3: off-by-one fix. When `participantCount === 2`
  // (you + one remote), `remoteCount` is 1 — the chip used to display
  // "Alex + 1 more", but there are no OTHER remotes beyond Alex.
  // The correct rendering for a two-person call is just the remote's
  // name. The "+ N more" suffix only applies when N >= 2 other
  // remotes beyond the displayed one.
  const summary = remoteParticipantName
    ? participantCount === 2
      ? remoteParticipantName
      : remoteCount > 1
        ? `${remoteParticipantName} + ${remoteCount - 1} more`
        : remoteParticipantName
    : participantCount === 1
      ? "Just you"
      : `${participantCount} in call`;

  return (
    <div
      data-testid="participant-indicator"
      data-participant-count={participantCount}
      className={cn(
        "inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-sm",
        className
      )}
      aria-label={
        remoteParticipantName
          ? `In call with ${remoteParticipantName}${
              remoteCount > 0 ? ` and ${remoteCount} other${remoteCount === 1 ? "" : "s"}` : ""
            }`
          : `${participantCount} participants in call`
      }
    >
      <Users className="h-3.5 w-3.5 text-muted-foreground" />
      <span className="font-medium">{summary}</span>
      <span className="rounded-full bg-muted px-2 text-xs tabular-nums text-muted-foreground">
        {participantCount}
      </span>
    </div>
  );
}
