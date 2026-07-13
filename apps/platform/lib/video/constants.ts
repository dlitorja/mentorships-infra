/**
 * Constants for the PR #3 video calling UI.
 *
 * Window bounds and timing match the server-side definitions in
 * `convex/sessions.ts` (`JOIN_WINDOW_BEFORE_MS` / `JOIN_WINDOW_AFTER_MS`)
 * and PR #2's recording duration. Single source of truth for the UI.
 */
export const JOIN_WINDOW_BEFORE_MS = 15 * 60 * 1000;
export const JOIN_WINDOW_AFTER_MS = 4 * 60 * 60 * 1000;

/** Minimum panel width for the resizable split (px). Below this the
 *  panel collapses into PiP. Matches docs/plans/video-calling.md. */
export const MIN_PANEL_WIDTH_PX = 360;

/** Default split ratio for the modal call overlay's horizontal layout:
 *  70% video on the left, 30% tabs/chat on the right (Zoom-style).
 *  The `:v3` storage key suffix bumps the key so users who tuned the
 *  pre-overlay vertical stack (60 = video %) start at the new default
 *  rather than silently inheriting a stale semantic. */
export const DEFAULT_HORIZONTAL_SPLIT_RATIO = 70;

/** localStorage key for the modal call overlay's horizontal split ratio. */
export const HORIZONTAL_SPLIT_RATIO_STORAGE_KEY = "video-call-split-ratio:v3";

/** Keyboard shortcuts for video call controls (docs/plans/video-calling.md
 *  Phase 3). All require the call panel to be focused or hovered. */
export const VIDEO_SHORTCUTS = {
  toggleMute: "m",
  toggleCamera: "v",
  toggleScreenShare: "s",
  togglePictureInPicture: "p",
  leaveCall: "Escape",
} as const;
