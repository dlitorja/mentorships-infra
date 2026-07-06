"use client";

import { useEffect } from "react";

/**
 * Listens for Cmd/Ctrl+K and toggles Quick Capture (the floating
 * `Cmd/Ctrl+K` overlay) while a video call is active in the
 * workspace.
 *
 * Why a separate hook: `use-keyboard-shortcuts.ts:42` drops any
 * event with `metaKey|ctrlKey|altKey` so the in-call mute / camera /
 * screenshare / PiP shortcuts stay clean. Cmd/Ctrl+K would be
 * swallowed there, so Quick Capture needs its own listener.
 *
 * Why gated on `enabled`: the Quick Capture overlay is only useful
 * while a call is active. Outside a call, the shortcut is a no-op
 * (matches the plan: "Cmd/Ctrl+K available while a call is
 * active"). The hook still attaches the listener so toggling
 * `enabled` does not require re-mounting the consumer.
 *
 * Why we skip events on editable surfaces: if the focused element
 * is an `<input>`, `<textarea>`, or `contenteditable`, Cmd/Ctrl+K
 * is left alone so the browser / editor's own handling wins. This
 * prevents the overlay from popping over an open Note composer.
 *
 * `onToggle` receives the next desired open-state so the consumer
 * owns the actual `useState`. We compute it from a ref-less closure
 * since toggle semantics are idempotent.
 */
export function useQuickCaptureShortcut(
  enabled: boolean,
  onToggle: () => void
): void {
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
      const isK = event.key === "k" || event.key === "K";
      if (!isK) return;
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.altKey) return;

      if (isEditableTarget(event.target)) return;

      event.preventDefault();
      event.stopPropagation();
      onToggle();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, onToggle]);
}
