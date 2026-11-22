/**
 * Screen-share capability detection for the Daily-powered call.
 *
 * Daily starts a screen share by calling
 * `navigator.mediaDevices.getDisplayMedia()`. When that API is missing,
 * `startScreenShare()` is a documented no-op — the call machine ignores
 * the request and emits no start, stop, cancel, or error event at all.
 * That is why an unsupported device sees a button that appears to do
 * nothing rather than an error.
 *
 * As of today the API is absent on:
 *   - every iOS/iPadOS Safari before 27 (iPadOS 27 shipped the first
 *     implementation, September 2026),
 *   - every Android browser,
 *   - desktop browsers served from an insecure (http) origin, where
 *     `navigator.mediaDevices` is undefined entirely.
 *
 * Detection must run in the browser: `navigator` does not exist during
 * SSR, so callers should treat `false` before mount as "unknown" and let
 * the tap-time check make the decision.
 */
export function isScreenShareSupported(): boolean {
  if (typeof navigator === "undefined") return false;
  return typeof navigator.mediaDevices?.getDisplayMedia === "function";
}

/**
 * Whether the current device is touch-first (phone or tablet).
 *
 * Used only to decide where the screen-share watchdog is worth arming.
 * It is deliberately heuristic and must never gate functionality:
 * iPadOS reports a desktop "Macintosh" user agent, so touch points are
 * the reliable signal there, while Android and iPhone/iPad UAs cover the
 * rest.
 */
export function isTouchPrimaryDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  if (/Android|iPhone|iPad|iPod/i.test(ua)) return true;
  // iPadOS 13+ reports a desktop "Macintosh" user agent. Touch points
  // distinguish an iPad from a real Mac, while a Windows touchscreen
  // laptop keeps its Windows UA and is correctly excluded.
  return /Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1;
}

/**
 * User-facing explanation shown when screen sharing cannot start.
 * Deliberately names the workaround: an instructor on an iPad needs to
 * know that joining from a laptop is the path to sharing, not that
 * something is broken.
 */
export const SCREEN_SHARE_UNSUPPORTED_MESSAGE =
  "This browser can't capture your screen. On a phone or tablet, join from a laptop or desktop to share your screen.";

/**
 * Explanation shown when the browser advertised `getDisplayMedia` but no
 * start/cancel event arrived after the watchdog window. Worded so it is
 * still true when a slow user simply spent longer than the window
 * choosing a window in the picker.
 */
export const SCREEN_SHARE_DID_NOT_START_MESSAGE =
  "If no screen picker appeared, this device or browser may not allow screen sharing — join from a laptop or desktop to share your screen.";
