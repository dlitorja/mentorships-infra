"use client";

import {
  DailyAudio,
  DailyVideo,
  useParticipant,
  useParticipantIds,
  useScreenShare,
} from "@daily-co/daily-react";
import { PhoneOff, RefreshCw } from "lucide-react";

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
 *
 * PR #4c-4: when a screen-share is active, the screen-share video
 * fills the primary area (most of the call surface) and the camera
 * tiles collapse into a thin strip at the bottom. Mentorships'
 * primary use case is sharing illustration software during a call —
 * the screen-share is the content, webcams are secondary.
 */
export function VideoCall() {
  const {
    status,
    remoteParticipantName,
    isPictureInPicture,
    join,
    leave,
    errorMessage,
  } = useVideoCallContext();
  const participantIds = useParticipantIds();
  // Daily exposes a separate "screen" filter that returns participants
  // where screen-audio or screen-video is currently tracked. Local
  // screen-share appears as a NEW participant with `session_id` ending
  // in "-screen" — it is NOT the same participant record as the local
  // camera, so iterating `participantIds` and checking
  // `tracks.screenVideo.persistentTrack` on the camera participant
  // misses it. Filtering with `filter: "screen"` returns the screen-
  // share sub-participant directly.
  const { screens } = useScreenShare();
  const screenShareIds = useParticipantIds({ filter: "screen" });
  const activeScreenShareId =
    screens.length > 0 && screenShareIds.length > 0
      ? screenShareIds[screenShareIds.length - 1]
      : null;
  const isScreenShareActive = activeScreenShareId !== null;
  // Camera strip must exclude ONLY the active screen-share sub-
  // participant so it isn't rendered twice (once as the primary
  // tile, once in the strip). We filter on the exact active
  // sub-participant ID, not on the "-screen" suffix — that way
  // concurrent screen-shares from other participants remain visible
  // in the strip (Greptile 4/5 follow-up: filtering by suffix would
  // drop every concurrent screen, leaving them rendered nowhere).
  // The strip therefore contains: every camera participant + every
  // non-active screen-share sub-participant.
  const cameraStripIds = isScreenShareActive
    ? participantIds.filter((id) => id !== activeScreenShareId)
    : participantIds;

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
    //
    // The Leave button is the exit hatch — Greptile P1: without it
    // the user is locked into the modal until they refresh, because
    // `<VideoControls />` (the only place Leave lives in the joined
    // branch) isn't rendered here. `useVideoCall.leave()` short-
    // circuits cleanly on `meetingState !== "joined-meeting"` and
    // flips status to "idle", which unmounts the overlay via
    // `useIsCallOverlayVisible()`.
    //
    // `role="alert"` + `aria-live="polite"` makes the failure message
    // and recovery state announce to screen readers (CodeRabbit).
    // The catch on `join().catch(...)` swallows its rethrown rejection
    // so a second failed retry doesn't surface as an unhandled
    // promise rejection in the console (CodeRabbit). `RefreshCw` is
    // `aria-hidden` because the button's accessible name comes from
    // its visible text "Retry" (CodeRabbit).
    return (
      <div
        role="alert"
        aria-live="polite"
        className="flex h-full flex-col items-center justify-center gap-3 bg-muted p-6 text-center text-sm text-muted-foreground"
      >
        <p className="max-w-sm">
          {errorMessage
            ? `Could not connect: ${errorMessage}`
            : "Could not connect to the call."}
        </p>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              join().catch(() => {
                // join() already reports the error via reportError and
                // surfaces it as `errorMessage`. Swallow the rethrow
                // so a second consecutive failure doesn't produce an
                // unhandled rejection in the browser console.
              });
            }}
            className="gap-2"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Retry
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void leave()}
            className="gap-2"
          >
            <PhoneOff className="h-4 w-4" aria-hidden="true" />
            Leave
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-col bg-black">
      {/* PR #4c-4: split layout when screen-share is active. The
       * screen-share fills the primary area; camera tiles collapse
       * into a thin strip at the bottom so the shared illustration
       * software (mentorships' primary use case) is the dominant
       * surface. The webcam strip keeps webcams visible but small
       * — the user explicitly noted webcam use is low priority. */}
      {isScreenShareActive && activeScreenShareId ? (
        <div className="flex h-full flex-col">
          <div className="flex-1 overflow-hidden p-2">
            <ParticipantTile
              sessionId={activeScreenShareId}
              fallbackName={remoteParticipantName}
              forceScreenShare
            />
          </div>
          {cameraStripIds.length > 0 && (
            <div className="shrink-0 border-t border-zinc-800 p-2">
              <div className="mx-auto flex h-24 max-w-3xl justify-center gap-2">
                {cameraStripIds.map((id) => (
                  <div
                    key={id}
                    className="aspect-video h-full"
                  >
                    <ParticipantTile
                      sessionId={id}
                      fallbackName={remoteParticipantName}
                      forceScreenShare={id.endsWith("-screen")}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
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
      )}

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
 *
 * PR #4c-4: `forceScreenShare` renders `type="screenVideo"` even
 * when `participant?.tracks?.screenVideo?.persistentTrack` is not
 * set on the camera participant record. Used by the screen-share
 * sub-participant, which has a separate `session_id` (ending in
 * "-screen") — checking the camera participant's tracks would miss
 * it. The parent layout filters down to the screen participant via
 * `useParticipantIds({ filter: "screen" })`.
 */
function ParticipantTile({
  sessionId,
  fallbackName,
  forceScreenShare = false,
}: {
  sessionId: string;
  fallbackName: string | null;
  forceScreenShare?: boolean;
}) {
  const participant = useParticipant(sessionId);
  const isLocal = participant?.local ?? false;
  const isScreenShare =
    forceScreenShare || !!participant?.tracks?.screenVideo?.persistentTrack;
  const displayName = isLocal
    ? "You"
    : (participant?.user_name ?? fallbackName ?? "Participant");

  return (
    <div
      className={cn(
        "relative flex h-full w-full items-center justify-center overflow-hidden rounded-md bg-zinc-900",
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
