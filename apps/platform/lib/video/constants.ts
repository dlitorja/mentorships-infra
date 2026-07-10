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

/** Default split ratio for the desktop vertical-stack layout
 *  (Phase 11): video on top, tabs on bottom. 60 = 60% video / 40% tabs.
 *  The `:v2` suffix on the storage key bumps the key so users who
 *  manually tuned the pre-Phase-11 horizontal split (60 = 60% chat /
 *  40% video) start at the new default rather than silently flipping
 *  the semantic. */
export const DEFAULT_VERTICAL_SPLIT_RATIO = 60;

/** localStorage key for the desktop vertical-stack split ratio. */
export const VERTICAL_SPLIT_RATIO_STORAGE_KEY = "video-call-split-ratio:v2";

/** Keyboard shortcuts for video call controls (docs/plans/video-calling.md
 *  Phase 3). All require the call panel to be focused or hovered. */
export const VIDEO_SHORTCUTS = {
  toggleMute: "m",
  toggleCamera: "v",
  toggleScreenShare: "s",
  togglePictureInPicture: "p",
  leaveCall: "Escape",
} as const;
