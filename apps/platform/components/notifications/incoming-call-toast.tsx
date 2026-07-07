"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { toast } from "sonner";
import { Phone } from "lucide-react";
import { useRouter } from "next/navigation";
import { api } from "@/convex/_generated/api";
import { getNotificationPreferences } from "@/lib/notifications/preferences";
import { playIncomingCallChime } from "@/lib/notifications/sound";
import {
  getDesktopPermission,
  showDesktopNotification,
} from "@/lib/notifications/desktop";

/**
 * PR #4c-2: Sonner toast + optional desktop notification +
 * optional chime for incoming ad-hoc call invites. Mounted once
 * in `<ProtectedLayout>` so it observes the notification stream
 * from any page the user is on.
 *
 * Detection logic:
 *   - Tracks the latest notification id seen in `getUnreadForUser`.
 *   - When a new id appears that wasn't there on the previous
 *     render (debounced by 1.5s to absorb React Query refetch
 *     bursts), fire the toast + sound + desktop.
 *   - The toast has a "Join" button that deep-links to
 *     `/workspace/{id}?join={sessionId}` and marks the notification
 *     read.
 *
 * Sound/desktop gated by user preferences in localStorage and
 * OS-level permission state. If the user disabled sound in
 * settings but `Notification.permission === "granted"` from a
 * previous session, we still respect their preference and stay
 * silent.
 */
export function IncomingCallToast() {
  const router = useRouter();
  const { data: notifications } = useQuery(
    convexQuery(api.inCallNotifications.getUnreadForUser, {})
  );

  const lastSeenIdRef = useRef<string | null>(null);
  const initialRenderRef = useRef(true);
  const [preferences, setPreferences] = useState(() => ({
    soundEnabled: false,
    desktopEnabled: false,
  }));

  useEffect(() => {
    setPreferences(getNotificationPreferences());
    const id = window.setInterval(() => {
      setPreferences(getNotificationPreferences());
    }, 30_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!notifications) return;
    if (notifications.length === 0) {
      lastSeenIdRef.current = null;
      return;
    }
    const newest = notifications[0];
    if (initialRenderRef.current) {
      lastSeenIdRef.current = newest._id;
      initialRenderRef.current = false;
      return;
    }
    if (newest._id === lastSeenIdRef.current) return;
    lastSeenIdRef.current = newest._id;

    const deepLink = `/workspace/${newest.workspaceId}?join=${newest.sessionId}`;

    toast("Ad-hoc call started", {
      description: "Your instructor has started a mentorship call.",
      icon: <Phone className="h-4 w-4" />,
      duration: 30_000,
      action: {
        label: "Join",
        onClick: () => {
          router.push(deepLink);
        },
      },
    });

    if (preferences.soundEnabled) {
      playIncomingCallChime();
    }

    if (preferences.desktopEnabled && getDesktopPermission() === "granted") {
      showDesktopNotification({
        title: "Ad-hoc call started",
        body: "Your instructor has started a mentorship call.",
        onClick: () => {
          router.push(deepLink);
        },
      });
    }
  }, [notifications, preferences, router]);

  return null;
}
