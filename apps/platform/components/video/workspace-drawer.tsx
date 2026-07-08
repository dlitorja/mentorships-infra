"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * Bottom-anchored sheet for the workspace chat on phones (< 600px)
 * during an active call.
 *
 * Built on the Radix Dialog shim (`@/components/ui/dialog`) so we
 * inherit focus trap, Escape dismiss, and `aria-modal` for free. The
 * default Dialog positioning is overridden via className to anchor the
 * sheet to the bottom of the viewport and animate from below.
 *
 * Drag-to-dismiss: pointerdown on the handle stores the starting Y;
 * pointermove translates the sheet down (RAF-throttled, same pattern
 * as `picture-in-picture.tsx:64-130`); pointerup reads the pointer's
 * final clientY to compute the drag distance and either snaps back or
 * dismisses via `onOpenChange`.
 *
 * Greptile R0 fix: the threshold previously read a stale `pending`
 * ref that was cleared once the RAF fired, so smooth drags always
 * snapped back. The pointerup handler now computes the final
 * translateY directly from the pointer event.
 *
 * CodeRabbit R0 fix: `translateY` is reset to 0 in a `useEffect`
 * keyed on `open` so the next open starts from a clean state even
 * after a drag-to-dismiss.
 *
 * Why a custom drag instead of vaul / shadcn `Sheet`: the project has
 * no vaul dependency and the AGENTS.md "no new deps without clear
 * win" rule means reusing the existing Radix Dialog shim is the
 * correct call here.
 */
export function WorkspaceDrawer({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange?: (next: boolean) => void;
  children: React.ReactNode;
}): React.ReactElement {
  const [translateY, setTranslateY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ pointerY: number; start: number } | null>(
    null
  );
  const pendingTranslateRef = useRef<number | null>(null);
  const rafIdRef = useRef<number | null>(null);

  // Cancel any pending RAF on unmount — otherwise a torn-down
  // component could call setState on an unmounted instance.
  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, []);

  // Reset the drag offset whenever the drawer closes so the next
  // open starts from a clean translateY(0) — drag-to-dismiss leaves
  // a stale value otherwise, and Radix's enter animation only
  // overrides the inline transform during the animation itself.
  useEffect(() => {
    if (!open) setTranslateY(0);
  }, [open]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      dragStartRef.current = { pointerY: e.clientY, start: translateY };
      e.currentTarget.setPointerCapture(e.pointerId);
      setIsDragging(true);
    },
    [translateY]
  );

  /**
   * pointermove fires on every native event — potentially 120+ Hz on
   * a high-refresh-rate device. Commit `setTranslateY` via
   * requestAnimationFrame so React only re-renders once per frame
   * instead of once per pointer event.
   */
  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const start = dragStartRef.current;
      if (!start) return;
      const dy = e.clientY - start.pointerY;
      const next = Math.max(0, start.start + dy);
      pendingTranslateRef.current = next;
      if (rafIdRef.current !== null) return;
      rafIdRef.current = requestAnimationFrame(() => {
        rafIdRef.current = null;
        const pending = pendingTranslateRef.current;
        if (pending !== null) {
          pendingTranslateRef.current = null;
          setTranslateY(pending);
        }
      });
    },
    []
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const start = dragStartRef.current;
      dragStartRef.current = null;
      setIsDragging(false);
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // Pointer capture may already be released if the OS yanked
        // focus (e.g. browser tab blur); ignore.
      }
      // Flush any pending RAF immediately so the final pointerup
      // position lands (otherwise the user can release mid-RAF and
      // see the sheet snap to a stale position).
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      pendingTranslateRef.current = null;

      // Compute the final translateY from the pointer event itself
      // — `pendingTranslateRef` is cleared by the RAF callback
      // before pointerup on smooth drags, so reading it would always
      // return null and fall back to the pre-drag `start.start` (0),
      // making the dismiss threshold unreachable for smooth gestures.
      const finalY =
        start === null ? 0 : Math.max(0, start.start + (e.clientY - start.pointerY));

      if (finalY > 120) {
        onOpenChange?.(false);
      } else {
        setTranslateY(0);
      }
    },
    [onOpenChange]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="workspace-drawer"
        // Override the Dialog shim's centered-modal positioning so
        // the sheet anchors to the bottom edge with slide-up/down
        // animations instead of zoom-in/zoom-out.
        className={cn(
          "left-0 top-auto bottom-0 translate-x-0 translate-y-0",
          "w-full max-w-full rounded-b-none rounded-t-2xl",
          "max-h-[80dvh] gap-0 p-0 overflow-hidden",
          // iOS Safari home-indicator safe-area padding; falls back to
          // `pb-4` automatically if env() resolves to undefined.
          "pb-[max(env(safe-area-inset-bottom),1rem)]",
          // Animate the snap-back to translateY(0) after a partial
          // drag — but not during active drag (would lag the
          // pointermove handler).
          !isDragging && "transition-transform duration-200 ease-out",
          // Slide animations: replace the shim's centered slide.
          "data-[state=open]:slide-in-from-bottom-full",
          "data-[state=closed]:slide-out-to-bottom-full"
        )}
        style={{ transform: `translateY(${translateY}px)` }}
      >
        <DialogTitle className="sr-only">Workspace</DialogTitle>
        <div
          data-testid="workspace-drawer-handle"
          aria-label="Drag down to dismiss workspace drawer"
          role="separator"
          aria-orientation="horizontal"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          className="mx-auto mt-2 h-1 w-8 cursor-grab rounded-full bg-muted-foreground/40 active:cursor-grabbing touch-none"
        />
        <div className="flex-1 min-h-0 overflow-y-auto">{children}</div>
      </DialogContent>
    </Dialog>
  );
}
