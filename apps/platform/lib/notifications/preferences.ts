/**
 * PR #4c-2: user-level preferences for ad-hoc call notifications.
 * Stored in `localStorage` under a single key so the storage shape
 * can evolve without versioning churn (the value is a JSON
 * object). Default: both notifications disabled (opt-in model —
 * users must explicitly enable them).
 *
 * Why localStorage and not Convex: these are device-level UX
 * choices (does THIS browser play sound), not account-level. A
 * user who enables sound on their laptop does not necessarily
 * want sound on their phone. Same rationale for desktop
 * notifications — the OS-level permission is per-device.
 */

const STORAGE_KEY = "huckleberry.notificationPreferences.v1";

export type NotificationPreferences = {
  soundEnabled: boolean;
  desktopEnabled: boolean;
};

const DEFAULTS: NotificationPreferences = {
  soundEnabled: false,
  desktopEnabled: false,
};

export function getNotificationPreferences(): NotificationPreferences {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw);
    return {
      soundEnabled:
        typeof parsed?.soundEnabled === "boolean"
          ? parsed.soundEnabled
          : DEFAULTS.soundEnabled,
      desktopEnabled:
        typeof parsed?.desktopEnabled === "boolean"
          ? parsed.desktopEnabled
          : DEFAULTS.desktopEnabled,
    };
  } catch {
    return DEFAULTS;
  }
}

export function setNotificationPreferences(
  next: NotificationPreferences
): NotificationPreferences {
  if (typeof window === "undefined") return next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Quota errors / private-mode browsers — silently ignore.
  }
  return next;
}
