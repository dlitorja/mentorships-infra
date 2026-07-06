"use client";

import { useEffect, useState } from "react";

import { useVideoCallContext } from "@/lib/video/video-context";
import { VideoCall } from "@/components/video/video-call";
import { PictureInPicture } from "@/components/video/picture-in-picture";
import { cn } from "@/lib/utils";

/**
 * Top-level container for an active video call on the workspace.
 *
 * Behavior:
 *   - Always renders inside a `<div>` that fills the right column.
 *   - When PiP mode is on, swaps the full VideoCall for a floating
 *     mini-window so the user can keep using the chat.
 *   - When the call ends (status === "ended"), unmounts entirely
 *     and leaves the workspace tabs free.
 *
 * PR #3 is desktop-only (≥ 900px). Mobile is Phase 7.
 */
export function VideoPanel({ className }: { className?: string }) {
  const { status, session, isPictureInPicture } = useVideoCallContext();
  const [hasMounted, setHasMounted] = useState(false);

  // Defer mounting by one tick so SSR doesn't paint a Daily iframe.
  useEffect(() => {
    setHasMounted(true);
  }, []);

  if (!session || !hasMounted) return null;
  if (status !== "joined" && status !== "joining" && status !== "leaving") {
    return null;
  }

  if (isPictureInPicture) {
    return <PictureInPicture className={className} />;
  }

  return (
    <div
      className={cn(
        "relative flex h-full min-h-[400px] w-full flex-col overflow-hidden rounded-lg border bg-background shadow-sm",
        className
      )}
    >
      <VideoCall />
    </div>
  );
}
