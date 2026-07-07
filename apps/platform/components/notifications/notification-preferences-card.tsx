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
 * Toggles are gated by capability checks (desktop requires
 * `Notification.permission === "granted"`) and explain inline why
 * an option is unavailable. Sound has a "Test" button so the user
 * can preview the chime without waiting for an incoming call.
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
      const result = await requestDesktopPermission();
      setPermission(result);
      if (result === "granted") {
        update({ desktopEnabled: true });
      }
    } else {
      update({ desktopEnabled: false });
    }
  };

  const desktopDisabled = permission !== "granted";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notifications</CardTitle>
        <CardDescription>
          How you want to be notified when an ad-hoc mentorship call starts.
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
              {desktopDisabled
                ? "Desktop notifications require browser permission. Click to enable."
                : "Sends an OS-level notification on incoming call invites."}
            </div>
          </div>
          <Switch
            checked={prefs?.desktopEnabled ?? false}
            onCheckedChange={(checked) => void onToggleDesktop(checked)}
            disabled={desktopDisabled}
            aria-label="Show desktop notification on incoming call"
          />
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => playIncomingCallChime()}
            disabled={!prefs?.soundEnabled}
          >
            Test sound
          </Button>
          <span className="text-xs text-muted-foreground">
            Verifies audio works without waiting for an incoming call.
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
