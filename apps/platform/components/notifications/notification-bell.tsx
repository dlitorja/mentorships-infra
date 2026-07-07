"use client";

import { useQuery, useMutation } from "@tanstack/react-query";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useEffect, useState } from "react";
import { Bell, Check } from "lucide-react";
import Link from "next/link";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * PR #4c-2: sidebar bell with cross-workspace unread count +
 * dropdown list of active ad-hoc call invites. Drives the
 * "application-wide notification rollup" surface that complements
 * the per-workspace row badge in the picker.
 *
 * Behavior:
 *   - Subscribes to `getUnreadForUser` for the active list.
 *   - Renders a red count badge when there are unread invites.
 *   - Dropdown is a small list (max 10 rendered) with each entry
 *     linking to `/workspace/{id}?join={sessionId}`. Newest first.
 *   - "Mark all as read" button clears the badge without forcing
 *     a full reload.
 *
 * Does NOT mark read on item click — mark-read happens on the
 * destination workspace mount via `<IncomingCallMarker>`. Marking
 * read on click here would race the navigation: the query
 * refetches before the new page mounts and the per-workspace row
 * badge query sees `readAt !== undefined` for the workspace the
 * user is about to enter, hiding the red dot on landing.
 *
 * Does NOT auto-play sound or desktop notification here — that
 * logic lives in `<IncomingCallToast>` so the two surfaces can
 * debounce independently. The bell is just the read surface.
 */
export function NotificationBell() {
  const { data: notifications } = useQuery(
    convexQuery(api.inCallNotifications.getUnreadForUser, {})
  );

  const markRead = useMutation({
    mutationFn: useConvexMutation(api.inCallNotifications.markRead),
  });

  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Re-render every minute so the relative timestamp
  // ("2m ago") stays current without spamming the server.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const list = notifications ?? [];
  const unreadCount = list.length;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-label={unreadCount > 0 ? `Notifications (${unreadCount} unread)` : "Notifications"}
        className="relative flex h-9 w-9 items-center justify-center rounded-md hover:bg-muted"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <Badge
            variant="destructive"
            className="absolute -right-0.5 -top-0.5 h-4 min-w-4 rounded-full px-1 text-[10px] leading-none flex items-center justify-center"
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </Badge>
        )}
      </button>

      {open && (
        <div
          className={cn(
            "absolute right-0 top-full z-50 mt-2 w-80 max-h-[28rem] overflow-auto",
            "rounded-md border bg-card text-card-foreground shadow-lg"
          )}
        >
          <div className="flex items-center justify-between px-3 py-2 border-b">
            <div className="text-sm font-medium">Ad-hoc call invites</div>
            {unreadCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  for (const n of list) {
                    markRead.mutate({ notificationId: n._id });
                  }
                  setOpen(false);
                }}
              >
                <Check className="mr-1 h-3 w-3" />
                Mark all read
              </Button>
            )}
          </div>
          {unreadCount === 0 ? (
            <div className="px-3 py-6 text-sm text-muted-foreground text-center">
              No pending call invites
            </div>
          ) : (
            <ul className="divide-y">
              {list.slice(0, 10).map((n) => (
                <li key={n._id} className="px-3 py-2">
                  <Link
                    href={`/workspace/${n.workspaceId}?join=${n.sessionId}`}
                    onClick={() => {
                      setOpen(false);
                    }}
                    className="block text-sm hover:underline"
                  >
                    <div className="font-medium">Mentorship call started</div>
                    <div className="text-xs text-muted-foreground">
                      {formatRelativeTime(now - n.createdAt)}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function formatRelativeTime(elapsedMs: number): string {
  if (elapsedMs < 60_000) return "just now";
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
