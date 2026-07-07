/**
 * PR #4c-2: thin wrapper around the browser `Notification` API for
 * ad-hoc call invites. The wrapper centralises the
 * permission-state checks (which are scattered through browser
 * code) and the deep-link click routing so every entry point
 * (toast, sidebar bell auto-popup, settings page) hits the same
 * well-typed path.
 *
 * Browser support: the `Notification` API is widely supported but
 * Safari still uses the prefixed `Notification.permission()` getter
 * (not function) and requires permission requests to originate
 * from a user gesture. The wrapper handles both.
 */

type PermissionState = "default" | "granted" | "denied" | "unsupported";

export function getDesktopPermission(): PermissionState {
  if (typeof window === "undefined") return "unsupported";
  if (!("Notification" in window)) return "unsupported";
  return Notification.permission as PermissionState;
}

/**
 * Requests permission. Returns the resulting state. Catches and
 * returns `"denied"` on any thrown error so callers can render a
 * tooltip with browser-specific instructions without a try/catch.
 */
export async function requestDesktopPermission(): Promise<PermissionState> {
  if (typeof window === "undefined") return "unsupported";
  if (!("Notification" in window)) return "unsupported";
  try {
    const result = await Notification.requestPermission();
    return result as PermissionState;
  } catch {
    return "denied";
  }
}

export type DesktopNotificationArgs = {
  title: string;
  body: string;
  /**
   * Called when the user clicks the OS notification. Use this to
   * navigate to the call. Returning a Promise lets callers await
   * navigation before closing the notification.
   */
  onClick?: () => void | Promise<void>;
  /**
   * URL icon shown next to the title. Falls back to the favicon
   * if omitted.
   */
  icon?: string;
  /**
   * Tag for replacing prior notifications. The default tag groups
   * multiple incoming calls into a single OS-level slot rather
   * than spamming the user with N notifications.
   */
  tag?: string;
};

/**
 * Shows a desktop notification. Returns `true` if the
 * notification was dispatched, `false` if it was suppressed
 * (permission denied, unsupported, etc.).
 */
export function showDesktopNotification(args: DesktopNotificationArgs): boolean {
  const permission = getDesktopPermission();
  if (permission !== "granted") return false;

  try {
    const notification = new Notification(args.title, {
      body: args.body,
      icon: args.icon,
      tag: args.tag ?? "ad_hoc_call_invite",
      requireInteraction: false,
      silent: false,
    });
    if (args.onClick) {
      notification.onclick = () => {
        void Promise.resolve(args.onClick?.()).finally(() => {
          notification.close();
        });
      };
    }
    return true;
  } catch {
    return false;
  }
}
