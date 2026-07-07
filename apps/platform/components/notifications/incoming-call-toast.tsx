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
 *   - Captures a `mountedAt` timestamp on first render (after the
 *     initial query settles).
 *   - Any notification whose `createdAt >= mountedAt` is treated
 *     as "new since this listener attached" and fires the toast +
 *     sound + desktop. The first paint (notifications already
 *     present at mount time) does NOT fire — those are surfaced
 *     silently via the bell + row badge so users opening the
 *     dashboard don't get an alert storm for unread backlog.
 *   - The toast has a "Join" button that deep-links to
 *     `/workspace/{id}?join={sessionId}`. Mark-read happens on the
 *     destination workspace mount (see `<IncomingCallMarker>`),
 *     not in the toast click handler — that avoids the navigation
 *     race where the bell's badge clears before the row badge
 *     mounts on the destination page.
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

  const mountedAtRef = useRef<number | null>(null);
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
      mountedAtRef.current = Date.now();
      return;
    }

    if (mountedAtRef.current === null) {
      const newest = notifications[0];
      mountedAtRef.current = newest.createdAt;
      return;
    }

    const mountedAt = mountedAtRef.current;
    const fresh = notifications.find((n) => n.createdAt >= mountedAt);
    if (!fresh) return;

    const deepLink = `/workspace/${fresh.workspaceId}?join=${fresh.sessionId}`;

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
