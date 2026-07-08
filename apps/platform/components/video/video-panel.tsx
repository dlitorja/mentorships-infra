"use client";

import { useEffect, useRef, useState } from "react";

import { useVideoCallContext } from "@/lib/video/video-context";
import { VideoCall } from "@/components/video/video-call";
import { PictureInPicture } from "@/components/video/picture-in-picture";
import { useIsBelow } from "@/lib/hooks/use-media-query";
import { cn } from "@/lib/utils";

type LayoutMode = "fullscreen" | "pip" | "inline";

/**
 * Top-level container for an active video call on the workspace.
 *
 * Layout branches (PR #4c-4):
 *   - < 600px (phone): full-screen video, no split, no PiP.
 *   - < 900px (tablet / small laptop): floating PiP is the only option.
 *     Split-panel never renders — the workspace content is the primary
 *     surface. The user's manual PiP toggle is ignored in this range
 *     because there's no "inline" to restore to.
 *   - ≥ 900px (desktop): the pre-PR-3 split-panel path; PiP is a user
 *     choice via the VideoControls bar or `P` shortcut.
 *
 * The mount gate (`hasMounted` + status check) and the unmount-when-
 * idle behavior are unchanged from PR #3.
 */
export function VideoPanel({ className }: { className?: string }) {
  const { status, session, isPictureInPicture } = useVideoCallContext();
  const [hasMounted, setHasMounted] = useState(false);

  const isPhone = useIsBelow(600);
  const isNarrow = useIsBelow(900);
  // `useIsBelow` returns `null` on the first render (SSR-safety).
  // Treat null as "unknown" → default to the desktop branch so we
  // never paint the wrong layout on hydration. The first `change`
  // event swaps us into the right branch.
  const isPhoneResolved = isPhone ?? false;
  const isNarrowResolved = isNarrow ?? false;

  // Defer mounting by one tick so SSR doesn't paint a Daily iframe.
  useEffect(() => {
    setHasMounted(true);
  }, []);

  // Track the most recent auto-applied layout so a polite aria-live
  // region can announce the transition to screen-reader users. The
  // announcement only fires when the layout actually transitions
  // from a previously-known value — not on initial mount, when
  // `useIsBelow` first resolves from `null` to its actual boolean.
  // Greptile R0 fix: previously fired on every mount.
  const [announcedLayout, setAnnouncedLayout] = useState<LayoutMode | null>(
    null
  );
  const prevLayoutRef = useRef<LayoutMode | null>(null);
  useEffect(() => {
    if (!hasMounted) return;
    const next: LayoutMode = isPhoneResolved
      ? "fullscreen"
      : isNarrowResolved
        ? "pip"
        : "inline";
    if (prevLayoutRef.current !== null && prevLayoutRef.current !== next) {
      setAnnouncedLayout(next);
    }
    prevLayoutRef.current = next;
  }, [hasMounted, isPhoneResolved, isNarrowResolved]);

  if (!session || !hasMounted) return null;
  if (status !== "joined" && status !== "joining" && status !== "leaving") {
    return null;
  }

  return (
    <>
      {/*
       * Phone (< 600px): video takes the full viewport. The workspace
       * chat lives behind a bottom-sheet drawer mounted by
       * `ChatTabWithVideo` so users can still take notes / send
       * messages mid-call.
       */}
      {isPhoneResolved ? (
        <div
          data-testid="video-panel-fullscreen"
          className={cn(
            "fixed inset-0 z-40 flex flex-col bg-black",
            // 100dvh handles iOS Safari's URL bar collapsing; fall
            // back to 100vh if dynamic viewport units are unsupported.
            "h-[100dvh] min-h-[100vh]",
            className
          )}
        >
          <VideoCall />
        </div>
      ) : isNarrowResolved ? (
        // Tablet / small laptop (≥ 600px and < 900px): floating PiP is
        // the only layout. The user's `isPictureInPicture` toggle is
        // intentionally ignored — `PictureInPicture` is the only
        // option here, so the internal Maximize2 button becomes a
        // no-op (re-renders the same component).
        <PictureInPicture className={cn("fixed bottom-4 right-4 z-40", className)} />
      ) : isPictureInPicture ? (
        <PictureInPicture className={className} />
      ) : (
        <div
          className={cn(
            "relative flex h-full min-h-[400px] w-full flex-col overflow-hidden rounded-lg border bg-background shadow-sm",
            className
          )}
        >
          <VideoCall />
        </div>
      )}

      {/*
       * Polite aria-live announcer. Re-reads whenever the layout
       * changes — screen-reader users hear an explicit "Layout
       * switched to …" announcement on resize. Visual users see
       * nothing (sr-only). CodeRabbit R0 fix: announce the inline
       * (desktop) branch too so resizing to desktop is signaled.
       */}
      <div role="status" aria-live="polite" className="sr-only">
        {announcedLayout === "fullscreen"
          ? "Layout switched to full-screen video. Open the workspace drawer to keep taking notes."
          : announcedLayout === "pip"
            ? "Layout switched to picture-in-picture."
            : announcedLayout === "inline"
              ? "Layout switched to split panel view."
              : null}
      </div>
    </>
  );
}
