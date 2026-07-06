import { useEffect } from "react";

/**
 * Global keyboard shortcut handler for video call controls.
 *
 * Mounted at the VideoCallProvider level so shortcuts work regardless
 * of which child component has focus, but only fire when:
 *   1. The video panel is mounted AND the call is joined
 *   2. The focused element is NOT a text input / textarea
 *
 * Maps the keys defined in `lib/video/constants.ts`:
 *   - `m`     → toggle microphone
 *   - `v`     → toggle camera
 *   - `s`     → toggle screen share
 *   - `p`     → toggle picture-in-picture
 *   - `Escape` → leave the call
 *
 * Returns nothing — handlers are passed in as a stable object.
 */
export function useKeyboardShortcuts(
  enabled: boolean,
  handlers: {
    onToggleMute: () => void;
    onToggleCamera: () => void;
    onToggleScreenShare: () => void;
    onTogglePip: () => void;
    onLeaveCall: () => void;
  }
) {
  useEffect(() => {
    if (!enabled) return;

    const isEditableTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      if (target.isContentEditable) return true;
      return false;
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isEditableTarget(event.target)) return;

      switch (event.key.toLowerCase()) {
        case "m":
          event.preventDefault();
          handlers.onToggleMute();
          return;
        case "v":
          event.preventDefault();
          handlers.onToggleCamera();
          return;
        case "s":
          event.preventDefault();
          handlers.onToggleScreenShare();
          return;
        case "p":
          event.preventDefault();
          handlers.onTogglePip();
          return;
        case "escape":
          handlers.onLeaveCall();
          return;
        default:
          return;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, handlers]);
}
