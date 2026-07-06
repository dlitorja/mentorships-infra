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

/** Default split ratio for chat vs video panel (60/40). */
export const DEFAULT_SPLIT_RATIO = 60;

/** localStorage key for persisted split ratio. */
export const SPLIT_RATIO_STORAGE_KEY = "video-call-split-ratio";

/** Keyboard shortcuts for video call controls (docs/plans/video-calling.md
 *  Phase 3). All require the call panel to be focused or hovered. */
export const VIDEO_SHORTCUTS = {
  toggleMute: "m",
  toggleCamera: "v",
  toggleScreenShare: "s",
  togglePictureInPicture: "p",
  leaveCall: "Escape",
} as const;
