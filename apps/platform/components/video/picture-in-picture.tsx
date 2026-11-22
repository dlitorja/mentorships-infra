"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Maximize2, PhoneOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { VideoCall } from "@/components/video/video-call";
import { useVideoCallContext } from "@/lib/video/video-context";
import { cn } from "@/lib/utils";

type Position = { x: number; y: number };

/**
 * Elements inside the floating panel that must keep their own click
 * handling. `handlePointerDown` skips drag capture when the gesture
 * starts on one of these — see the comment on that handler.
 */
const INTERACTIVE_SELECTOR =
  "button, a, input, select, textarea, [role='button'], [role='slider'], [data-pip-no-drag]";

/**
 * Floating mini-window for an in-progress video call.
 *
 * Spawns bottom-right when the user clicks the Picture-in-Picture
 * button (or hits `P`). Drag to reposition; click ⤢ to restore inline;
 * click ⏻ to leave the call.
 *
 * Position is in-memory only — refreshed on page reload. We
 * intentionally don't persist it: PiP is a transient UI mode, not
 * a user preference, and persisting would surprise users who
 * reconnect on a different monitor.
 */
export function PictureInPicture({
  className,
}: {
  className?: string;
}): React.ReactElement {
  const {
    togglePictureInPicture,
    leave,
    remoteParticipantName,
    status,
  } = useVideoCallContext();
  const ref = useRef<HTMLDivElement | null>(null);
  const dragStartRef = useRef<
    { pointerX: number; pointerY: number; pos: Position } | null
  >(null);
  const pendingPosRef = useRef<Position | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const [pos, setPos] = useState<Position>({ x: 0, y: 0 });
  const [size] = useState({ width: 360, height: 240 });
  const isLeaving = status === "leaving";

  useEffect(() => {
    if (typeof window === "undefined") return;
    setPos({
      x: Math.max(8, window.innerWidth - size.width - 16),
      y: Math.max(8, window.innerHeight - size.height - 80),
    });
  }, [size.height, size.width]);

  // Cancel any pending RAF on unmount.
  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, []);

  /**
   * Pointer capture is what lets the panel keep receiving moves when the
   * cursor leaves its 360×240 bounds mid-drag. But capturing on *every*
   * pointerdown retargets the whole gesture to this container, including
   * the compatibility `click`, so buttons rendered inside the panel
   * (mute / camera / screen share / leave / restore) never fire their
   * onClick. On a tablet the 600–900px layout uses PiP exclusively, which
   * made every call control a dead tap — reported as "the screen-share
   * button does nothing" on an iPad.
   *
   * Only start a drag (and capture) when the gesture begins outside an
   * interactive control.
   */
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const target = e.target;
      if (
        target instanceof Element &&
        target.closest(INTERACTIVE_SELECTOR) !== null
      ) {
        return;
      }
      dragStartRef.current = {
        pointerX: e.clientX,
        pointerY: e.clientY,
        pos,
      };
      ref.current?.setPointerCapture(e.pointerId);
    },
    [pos]
  );

  /**
   * pointermove fires on every native event — that's potentially
   * 120+ Hz on a high-refresh-rate mouse. Commit `setPos` via
   * requestAnimationFrame so React only re-renders once per frame
   * instead of once per pointer event.
   */
  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const start = dragStartRef.current;
      if (!start) return;
      const dx = e.clientX - start.pointerX;
      const dy = e.clientY - start.pointerY;
      const next: Position = {
        x: Math.max(
          8,
          Math.min(window.innerWidth - size.width - 8, start.pos.x + dx)
        ),
        y: Math.max(
          8,
          Math.min(window.innerHeight - size.height - 8, start.pos.y + dy)
        ),
      };
      pendingPosRef.current = next;
      if (rafIdRef.current !== null) return;
      rafIdRef.current = requestAnimationFrame(() => {
        rafIdRef.current = null;
        const pending = pendingPosRef.current;
        if (pending) {
          pendingPosRef.current = null;
          setPos(pending);
        }
      });
    },
    [size.height, size.width]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      dragStartRef.current = null;
      // Only release a capture this element actually owns. Taps that
      // started on a control never captured (see handlePointerDown), and
      // releasePointerCapture() on a non-captured pointer throws
      // NotFoundError in some browsers.
      if (ref.current?.hasPointerCapture(e.pointerId)) {
        ref.current.releasePointerCapture(e.pointerId);
      }
      // Flush any pending RAF position immediately so the final
      // pointerup position lands (otherwise the user can release
      // mid-RAF and see the panel snap to a stale position).
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      const pending = pendingPosRef.current;
      if (pending) {
        pendingPosRef.current = null;
        setPos(pending);
      }
    },
    []
  );

  return (
    <div
      ref={ref}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      role="dialog"
      aria-label={`Video call with ${remoteParticipantName ?? "participant"}`}
      className={cn(
        "fixed z-50 cursor-move overflow-hidden rounded-lg border bg-background shadow-2xl",
        className
      )}
      style={{ left: pos.x, top: pos.y, width: size.width, height: size.height }}
    >
      <div className="relative h-full w-full">
        <VideoCall />
        <div className="pointer-events-none absolute inset-0 rounded-lg ring-1 ring-black/5" />
        <div className="absolute right-1 top-1 flex gap-1">
          <Button
            type="button"
            variant="secondary"
            size="icon"
            className="h-7 w-7 bg-black/60 text-white hover:bg-black/80"
            onClick={(e) => {
              e.stopPropagation();
              togglePictureInPicture();
            }}
            disabled={isLeaving}
            title="Restore inline"
            aria-label="Restore video call to inline panel"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="icon"
            className="h-7 w-7 bg-destructive/90 text-white hover:bg-destructive"
            onClick={(e) => {
              e.stopPropagation();
              void leave();
            }}
            disabled={isLeaving}
            title="Leave call"
            aria-label="Leave call"
          >
            <PhoneOff className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
