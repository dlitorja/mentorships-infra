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
  "This browser can't capture your screen. If you're on a phone or tablet, join from a laptop or desktop to share your screen.";

/**
 * Explanation shown when the touch-device picker never produced a
 * stream. Covers browsers that expose `getDisplayMedia` but never show a
 * system picker.
 */
export const SCREEN_SHARE_PICKER_DID_NOT_OPEN_MESSAGE =
  "If no screen picker appeared, this device or browser may not allow screen sharing — join from a laptop or desktop to share your screen.";

/**
 * Explanation shown when we captured the screen ourselves but Daily
 * still never reported the share as started — the call machine refusing
 * the handover. Worded so it does not claim the picker was missing.
 */
export const SCREEN_SHARE_DID_NOT_START_MESSAGE =
  "Your screen was captured but couldn't be shared. On a phone or tablet, join from a laptop or desktop to share your screen.";

/**
 * Kill switch for the touch-device "bring your own stream" fallback.
 *
 * Daily's call machine treats mobile browsers as receive-only, even on
 * iPadOS 27+ where Safari exposes `getDisplayMedia`. For those devices we
 * capture the screen ourselves and hand the stream to
 * `startScreenShare({ mediaStream })`, which is the documented
 * `DailyStartScreenShareFromStream` path for custom call-object apps.
 *
 * Keep this on while the fallback is being validated on a real iPadOS 27
 * device; flip to `false` in a one-line change if it regresses desktop or
 * produces a worse failure than the explanatory toast.
 */
export const ENABLE_TOUCH_SCREEN_SHARE_FALLBACK = true;

/**
 * True when a failed `getDisplayMedia()` call means the user dismissed
 * the picker (or denied permission) rather than a real failure. Safari
 * rejects with `NotAllowedError` both on dismissal and on denial, and
 * `AbortError` in some paths — none of which deserves an error toast.
 */
export function isScreenSharePickerDismissal(error: unknown): boolean {
  const name =
    typeof error === "object" && error !== null && "name" in error
      ? String((error as { name: unknown }).name)
      : "";
  return name === "AbortError" || name === "NotAllowedError";
}
