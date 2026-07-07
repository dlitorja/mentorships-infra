"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { playIncomingCallChime } from "@/lib/notifications/sound";
import {
  getDesktopPermission,
  requestDesktopPermission,
} from "@/lib/notifications/desktop";
import {
  getNotificationPreferences,
  setNotificationPreferences,
  type NotificationPreferences,
} from "@/lib/notifications/preferences";

/**
 * PR #4c-2: settings UI for ad-hoc call notification preferences.
 * Replaces the "coming soon" placeholder card in
 * `app/settings/page.tsx`.
 *
 * Toggles are always interactive — the desktop switch is NOT
 * `disabled` when the browser permission is `"default"`, because
 * that would prevent the user from ever triggering the permission
 * prompt. Instead, clicking the switch on `"default"` calls
 * `requestDesktopPermission()`; the switch only updates to `true`
 * once permission becomes `"granted"`. When permission is
 * `"denied"` or `"unsupported"`, the toggle visually reflects
 * the disabled state but stays focusable for screen-reader users.
 *
 * "Test sound" is always available so users can preview the
 * chime BEFORE opting in. Without that, the user has to enable
 * sound, hear it once, decide to disable, and never know what
 * they declined.
 *
 * Persisted to localStorage via `setNotificationPreferences` so
 * the choice is device-specific (per the AGENTS.md-style
 * guidance that notification preferences are a per-device UX
 * choice, not account-level).
 */
export function NotificationPreferencesCard() {
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [permission, setPermission] = useState<"default" | "granted" | "denied" | "unsupported">(
    "default"
  );

  useEffect(() => {
    setPrefs(getNotificationPreferences());
    setPermission(getDesktopPermission());
  }, []);

  const update = (patch: Partial<NotificationPreferences>) => {
    if (!prefs) return;
    const next = { ...prefs, ...patch };
    setPrefs(next);
    setNotificationPreferences(next);
  };

  const onToggleDesktop = async (next: boolean) => {
    if (next) {
      // First-time opt-in flow: trigger the browser permission
      // prompt. Some browsers reject the promise outright (e.g.
      // insecure contexts, iframe with restrictive permissions
      // policy); `requestDesktopPermission` handles those by
      // resolving to `"denied"`/`"unsupported"` rather than
      // throwing, but we wrap defensively so a stray rejection
      // never reaches the UI console.
      try {
        const result = await requestDesktopPermission();
        setPermission(result);
        if (result === "granted") {
          update({ desktopEnabled: true });
        }
      } catch {
        setPermission("denied");
      }
      return;
    }
    if (permission === "granted") {
      update({ desktopEnabled: false });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notifications</CardTitle>
        <CardDescription>
          How you want to be notified when an ad-hoc video session starts.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <div className="text-sm font-medium">Play a sound</div>
            <div className="text-xs text-muted-foreground">
              Plays a short two-note chime on incoming call invites.
            </div>
          </div>
          <Switch
            checked={prefs?.soundEnabled ?? false}
            onCheckedChange={(checked) => update({ soundEnabled: checked })}
            aria-label="Play a sound on incoming call"
          />
        </div>

        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <div className="text-sm font-medium">Show desktop notification</div>
            <div className="text-xs text-muted-foreground">
              {permission === "default"
                ? "Click the switch to grant browser permission for OS-level notifications."
                : permission === "granted"
                  ? "Sends an OS-level notification on incoming call invites."
                  : permission === "denied"
                    ? "Browser permission was denied. Update it in your browser's site settings to enable."
                    : "Desktop notifications are not supported in this browser."}
            </div>
          </div>
          <Switch
            checked={prefs?.desktopEnabled ?? false}
            onCheckedChange={(checked) => void onToggleDesktop(checked)}
            disabled={permission === "denied" || permission === "unsupported"}
            aria-label="Show desktop notification on incoming call"
          />
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => playIncomingCallChime()}
          >
            Test sound
          </Button>
          <span className="text-xs text-muted-foreground">
            Preview the chime without waiting for an incoming call.
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
