"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw, AlertCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Id } from "@/convex/_generated/dataModel";

/**
 * PR #4c-1: modal video player for a single past call recording.
 * Mounted by `CallsSection` when the user clicks "Play" on a row.
 *
 * Signed-URL TTL: 1 hour. We re-fetch the URL 60 s before it
 * expires so playback is uninterrupted for users watching a
 * long recording. Mid-playback refresh would force the browser to
 * reload the media element (position + decoder state lost), so we
 * queue the refresh and fire it on the next `pause`/`ended`.
 *
 * Greptile R4 P0: a recording longer than the 1-hour URL TTL
 * would silently keep playing past expiry. We close that gap by
 * adding `FORCE_REFRESH_THRESHOLD_MS`: when remaining time falls
 * below this AND the video is playing, we force the refresh even
 * though it costs the playback position. The alternative
 * (playback stalling when B2 rejects the expired URL) is worse.
 *
 * Auth: the route layer (`/api/video/recording/[sessionId]`)
 * resolves the caller's identity server-side via
 * `api.workspaces.getSessionParticipantForRecording`. We never
 * inspect the URL or trust client-side state for who can see
 * what.
 *
 * No `ObjectURL` to revoke — we hand the `<video>` a signed B2
 * URL directly, not a blob.
 */
type LoadState =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "error"; message: string };

const REFRESH_THRESHOLD_MS = 5 * 60_000;
const FORCE_REFRESH_THRESHOLD_MS = 60_000;
const CHECK_INTERVAL_MS = 60_000;
const SIGNED_URL_TTL_SECONDS = 3600;

interface RecordingPlayerModalProps {
  sessionId: Id<"sessions">;
  open: boolean;
  onOpenChange: (next: boolean) => void;
  callStartedAt: number | null;
  participantName: string | null;
}

export default function RecordingPlayerModal({
  sessionId,
  open,
  onOpenChange,
  callStartedAt,
  participantName,
}: RecordingPlayerModalProps) {
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number>(0);
  const [loadState, setLoadState] = useState<LoadState>({
    kind: "loading",
  });
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const pendingRefreshRef = useRef<boolean>(false);
  const inFlightRefreshRef = useRef<boolean>(false);
  // Saved playback position for force-refresh during playback.
  // When the URL gets force-refreshed mid-play the `<video>` element
  // resets to position 0, so we save currentTime before the fetch
  // and restore it after the new src loads. Greptile R4 P0.
  const savedPlaybackPositionRef = useRef<number | null>(null);
  // Whether the video was actively playing when we kicked off the
  // refresh — used by `handleLoadedMetadata` to decide whether to
  // call `play()` after restoring the position. CodeRabbit R5:
  // without this, refreshing mid-play leaves the media element
  // paused at the restored position, silently stopping playback.
  const wasPlayingBeforeRefreshRef = useRef<boolean>(false);

  const fetchSignedStreamUrl = useCallback(async (): Promise<void> => {
    // If the video is currently playing, snapshot its position so
    // we can restore it on the new src. We only do this for the
    // mid-play refresh path; on initial load the element is
    // already at position 0.
    const video = videoRef.current;
    if (video && !video.paused && !video.ended) {
      savedPlaybackPositionRef.current = video.currentTime;
      wasPlayingBeforeRefreshRef.current = true;
    } else {
      wasPlayingBeforeRefreshRef.current = false;
    }
    try {
      const res = await fetch(
        `/api/video/recording/${sessionId}?kind=stream`,
        { credentials: "include", cache: "no-store" }
      );
      // CodeRabbit R5 "outside diff": if the dialog was closed
      // while the fetch was in flight, drop the late result. We
      // check `open` after the await because it's the only signal
      // that's authoritative — by the time the response lands,
      // the user may have closed the dialog.
      if (!open) return;
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        setLoadState({
          kind: "error",
          message: body?.error ?? `Request failed (HTTP ${res.status})`,
        });
        return;
      }
      const data = (await res.json()) as { url: string; expiresAt: number };
      setStreamUrl(data.url);
      setExpiresAt(data.expiresAt);
      setLoadState({ kind: "ready" });
    } catch (err) {
      if (!open) return;
      setLoadState({
        kind: "error",
        message:
          err instanceof Error ? err.message : "Network error while loading",
      });
    }
  }, [sessionId, open]);

  // Open: fetch URL. Close: clear URL + reset state and any
  // pending refresh bookkeeping so an in-flight fetch doesn't
  // repopulate state after the dialog is gone (CodeRabbit R5).
  useEffect(() => {
    if (!open) {
      setStreamUrl(null);
      setExpiresAt(0);
      setLoadState({ kind: "loading" });
      pendingRefreshRef.current = false;
      inFlightRefreshRef.current = false;
      savedPlaybackPositionRef.current = null;
      wasPlayingBeforeRefreshRef.current = false;
      return;
    }
    void fetchSignedStreamUrl();
  }, [open, fetchSignedStreamUrl]);

  // 60 s timer: refresh the URL when within 5 min of expiry.
  // If the video is playing, queue the refresh for the next
  // pause/ended so we don't drop the playback position — UNLESS
  // we're within FORCE_REFRESH_THRESHOLD_MS of expiry, in which
  // case we force the refresh so the URL doesn't expire under
  // the user mid-playback (Greptile R4 P0 — applies to recordings
  // longer than the 1-hour URL TTL).
  useEffect(() => {
    if (!open || expiresAt === 0) return;
    const id = window.setInterval(() => {
      const remaining = expiresAt - Date.now();
      if (remaining > REFRESH_THRESHOLD_MS) return;
      if (inFlightRefreshRef.current) return;
      const video = videoRef.current;
      const forceRefresh =
        remaining <= FORCE_REFRESH_THRESHOLD_MS ||
        !video ||
        video.paused ||
        video.ended;
      if (!forceRefresh) {
        pendingRefreshRef.current = true;
        return;
      }
      inFlightRefreshRef.current = true;
      void fetchSignedStreamUrl().finally(() => {
        inFlightRefreshRef.current = false;
      });
    }, CHECK_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [open, expiresAt, fetchSignedStreamUrl]);

  const handlePauseOrEnd = useCallback(() => {
    if (!pendingRefreshRef.current) return;
    pendingRefreshRef.current = false;
    if (inFlightRefreshRef.current) return;
    inFlightRefreshRef.current = true;
    void fetchSignedStreamUrl().finally(() => {
      inFlightRefreshRef.current = false;
    });
  }, [fetchSignedStreamUrl]);

  const handleRetry = useCallback(() => {
    void fetchSignedStreamUrl();
  }, [fetchSignedStreamUrl]);

  // After the `<video>` finishes loading the new src, restore the
  // position snapshot if there is one. We clear the snapshot once
  // consumed so subsequent (non-force) refreshes don't try to
  // restore a stale position. Greptile R4 P0.
  //
  // CodeRabbit R5: also call `play()` after the seek if the video
  // was playing before the refresh — without it the media element
  // sits paused at the restored position, silently stopping
  // playback. We tolerate the play() rejection (autoplay policy,
  // element not yet ready) by logging and ignoring it.
  const handleLoadedMetadata = useCallback(() => {
    const saved = savedPlaybackPositionRef.current;
    const wasPlaying = wasPlayingBeforeRefreshRef.current;
    if (saved === null) return;
    savedPlaybackPositionRef.current = null;
    wasPlayingBeforeRefreshRef.current = false;
    const video = videoRef.current;
    if (!video) return;
    const clamp = Math.max(0, Math.min(saved, video.duration || saved));
    try {
      video.currentTime = clamp;
    } catch {
      // Some browsers throw if duration is Infinity (live streams)
      // or the media is not seekable yet — fail silently; the user
      // can re-seek manually.
      return;
    }
    if (wasPlaying) {
      void video.play().catch(() => {
        // Autoplay policy or transient element-not-ready. The user
        // can resume with the play control; we don't surface this.
      });
    }
  }, []);

  const callDateLabel = formatCallDate(callStartedAt);
  const titleLine = participantName
    ? `Recording with ${participantName}`
    : "Recording";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl gap-3 p-4 sm:p-6">
        <div className="flex flex-col gap-1">
          <DialogTitle>{titleLine}</DialogTitle>
          <DialogDescription>
            {callDateLabel}
            {expiresAt > 0 ? (
              <>
                {" · signed URL expires "}
                {formatRelativeExpiry(expiresAt)}
              </>
            ) : null}
          </DialogDescription>
        </div>

        <div className="relative w-full aspect-video bg-black rounded-md overflow-hidden">
          {loadState.kind === "loading" && (
            <div className="absolute inset-0 flex items-center justify-center text-white">
              <Loader2 className="h-8 w-8 animate-spin" aria-hidden="true" />
              <span className="sr-only">Loading recording…</span>
            </div>
          )}

          {loadState.kind === "error" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white p-6 text-center">
              <AlertCircle className="h-8 w-8" aria-hidden="true" />
              <p className="text-sm">Couldn&apos;t load recording</p>
              <p className="text-xs text-white/70 max-w-md">
                {loadState.message}
              </p>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleRetry}
              >
                <RefreshCw className="h-4 w-4 mr-2" aria-hidden="true" />
                Retry
              </Button>
            </div>
          )}

          {loadState.kind === "ready" && streamUrl !== null && (
            <video
              ref={videoRef}
              src={streamUrl}
              controls
              preload="metadata"
              onPause={handlePauseOrEnd}
              onEnded={handlePauseOrEnd}
              onLoadedMetadata={handleLoadedMetadata}
              className="absolute inset-0 h-full w-full bg-black"
            >
              <track kind="captions" />
              Your browser does not support the video tag.
            </video>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Recordings are stored in Backblaze B2 and accessed via a
          1-hour signed URL that auto-refreshes while this dialog is
          open.
        </p>
      </DialogContent>
    </Dialog>
  );
}

function formatCallDate(callStartedAt: number | null): string {
  if (callStartedAt === null) return "Recording";
  const d = new Date(callStartedAt);
  return `Recording from ${d.toLocaleString()}`;
}

function formatRelativeExpiry(expiresAt: number): string {
  const remainingMs = expiresAt - Date.now();
  if (remainingMs <= 0) return "now";
  const minutes = Math.max(1, Math.round(remainingMs / 60_000));
  return `in ${minutes} min`;
}

export { SIGNED_URL_TTL_SECONDS };
