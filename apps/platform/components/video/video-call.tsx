"use client";

import {
  DailyAudio,
  DailyVideo,
  useParticipant,
  useParticipantIds,
} from "@daily-co/daily-react";
import { RefreshCw } from "lucide-react";

import { useVideoCallContext } from "@/lib/video/video-context";
import { VideoControls } from "@/components/video/video-controls";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Daily iframe-backed video tiles + audio playback.
 *
 * Renders each participant's camera tile, local microphone on/off
 * mirror handling, and the bottom control bar. Audio playback is
 * delegated to `<DailyAudio autoSubscribeActiveSpeaker>` which
 * subscribes to the active speaker — pre-PR #3 we disable Daily's
 * in-call chat, so this is the only real-time channel.
 *
 * Tiles show `user_name` (set on the meeting token server-side) under
 * each video. Camera-off tiles show the participant's name on a
 * placeholder background.
 */
export function VideoCall() {
  const {
    status,
    remoteParticipantName,
    isPictureInPicture,
    join,
    errorMessage,
  } = useVideoCallContext();
  const participantIds = useParticipantIds();

  // While Daily is loading/joining, render an explicit loading state
  // rather than a blank iframe — this prevents the user from seeing a
  // 1-3s blank screen during token exchange.
  const isLoading =
    status === "idle" || status === "joining" || status === "leaving";

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-muted text-muted-foreground">
        <div className="flex flex-col items-center gap-2">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm">
            {status === "joining"
              ? "Connecting…"
              : status === "leaving"
                ? "Leaving…"
                : "Preparing call…"}
          </p>
        </div>
      </div>
    );
  }

  if (status === "error") {
    // Recovery path: Retry re-runs `useVideoCall.join()`, which
    // re-fetches the meeting token and re-joins the Daily room. The
    // previous error message is cleared inside join() before the
    // retry, so a successful retry immediately flips status back to
    // "joining" → "joined" without needing a manual reset.
    // `useVideoCall.join()` has its own re-entrancy guard via
    // `statusRef`, so a rapid double-click is safe.
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-muted p-6 text-center text-sm text-muted-foreground">
        <p className="max-w-sm">
          {errorMessage
            ? `Could not connect: ${errorMessage}`
            : "Could not connect to the call."}
        </p>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => void join()}
          className="gap-2"
        >
          <RefreshCw className="h-4 w-4" />
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-col bg-black">
      {/* Remote + local tiles */}
      <div className="flex-1 overflow-hidden">
        <div
          className={cn(
            "grid h-full gap-2 p-2",
            participantIds.length <= 1 ? "grid-cols-1" : "grid-cols-2"
          )}
        >
          {participantIds.map((id) => (
            <ParticipantTile
              key={id}
              sessionId={id}
              fallbackName={remoteParticipantName}
            />
          ))}
          {participantIds.length === 0 && (
            <div className="flex items-center justify-center text-sm text-zinc-300">
              Waiting for the other participant to join…
            </div>
          )}
        </div>
      </div>

      {/* Audio playback (no UI) */}
      <DailyAudio autoSubscribeActiveSpeaker />

      {/* Controls bar */}
      {!isPictureInPicture && (
        <div className="absolute inset-x-0 bottom-4 flex justify-center">
          <VideoControls />
        </div>
      )}
    </div>
  );
}

/**
 * Single video tile. Uses `useParticipant(id)` so each tile subscribes
 * to its own participant record — re-renders stay local when only one
 * participant's state changes (camera on/off, screen share, etc.).
 */
function ParticipantTile({
  sessionId,
  fallbackName,
}: {
  sessionId: string;
  fallbackName: string | null;
}) {
  const participant = useParticipant(sessionId);
  const isLocal = participant?.local ?? false;
  const isScreenShare = !!participant?.tracks?.screenVideo?.persistentTrack;
  const displayName = isLocal
    ? "You"
    : (participant?.user_name ?? fallbackName ?? "Participant");

  return (
    <div
      className={cn(
        "relative flex items-center justify-center overflow-hidden rounded-md bg-zinc-900",
        isScreenShare && "col-span-2"
      )}
    >
      <DailyVideo
        sessionId={sessionId}
        type={isScreenShare ? "screenVideo" : "video"}
        // Mirror only the local camera feed. Screen-share tiles are
        // never mirrored (otherwise they would appear flipped to the
        // presenter and confuse the audience). `automirror` is
        // ignored by Daily when `type="screenVideo"` but we set it
        // explicitly to false so intent is clear.
        automirror={isLocal && !isScreenShare}
        fit="contain"
        className="h-full w-full object-contain"
      />
      <div className="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-1 text-xs text-white">
        {displayName}
      </div>
    </div>
  );
}
