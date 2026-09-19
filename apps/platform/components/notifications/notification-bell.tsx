"use client";

import { useQuery, useMutation } from "@tanstack/react-query";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FunctionReturnType } from "convex/server";
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
 * PR #3: also surfaces `recording_ready` notifications from
 * `recordingReadyNotifications.listUnreadForUser`. The two query
 * surfaces are merged into a single `kind`-discriminated list,
 * sorted newest first by their respective timestamps. Recording
 * entries link to `/workspace/{id}?videos={sessionId}` so the
 * workspace page can auto-switch to the videos tab on mount
 * (`WorkspaceClientPage.initialVideoSessionId`).
 *
 * Behavior:
 *   - Subscribes to BOTH queries concurrently via React Query.
 *   - Renders a red count badge when there are unread items.
 *   - Dropdown is a small list (max 10 rendered), newest first.
 *   - "Mark all read" batches `markReadMany` for ad_hoc_call_invite
 *     IDs and a `Promise.all` of `markAcknowledged` calls for
 *     recording_ready IDs in parallel, then closes the dropdown.
 *   - Dropdown closes on outside click and Escape key.
 *
 * Does NOT mark read on item click — for `ad_hoc_call_invite`,
 * mark-read happens on the destination workspace mount via
 * `<IncomingCallMarker>`. For `recording_ready`, mark-acknowledged
 * happens on the workspace page mount when the user opens the
 * recording. Marking read on click here would race the navigation:
 * the query refetches before the new page mounts and the
 * per-workspace row badge query sees `readAt !== undefined` for
 * the workspace the user is about to enter, hiding the red dot on
 * landing.
 *
 * Does NOT auto-play sound or desktop notification here — that
 * logic lives in `<IncomingCallToast>` so the two surfaces can
 * debounce independently. The bell is just the read surface.
 */
type InCallNotification = FunctionReturnType<
  typeof api.inCallNotifications.getUnreadForUser
>[number];
type RecordingReadyNotification = FunctionReturnType<
  typeof api.recordingReadyNotifications.listUnreadForUser
>[number];

type BellItem =
  | {
      kind: "ad_hoc_call_invite";
      _id: InCallNotification["_id"];
      timestamp: number;
      render: {
        title: string;
        href: string;
      };
    }
  | {
      kind: "recording_ready";
      _id: RecordingReadyNotification["_id"];
      timestamp: number;
      render: {
        title: string;
        href: string;
      };
    };

export function NotificationBell() {
  const { data: callInvites } = useQuery(
    convexQuery(api.inCallNotifications.getUnreadForUser, {})
  );

  const { data: recordings } = useQuery(
    convexQuery(api.recordingReadyNotifications.listUnreadForUser, {})
  );

  const markReadMany = useMutation({
    mutationFn: useConvexMutation(api.inCallNotifications.markReadMany),
  });
  const markRecordingAcknowledged = useMutation({
    mutationFn: useConvexMutation(
      api.recordingReadyNotifications.markAcknowledged
    ),
  });

  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  // Re-render every minute so the relative timestamp
  // ("2m ago") stays current without spamming the server.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  // Close on outside click or Escape so users don't have to click a
  // link to dismiss the dropdown. Bound to `open` so the listener
  // only attaches while the panel is visible.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node | null;
      if (!target) return;
      if (dropdownRef.current?.contains(target)) return;
      if (buttonRef.current?.contains(target)) return;
      setOpen(false);
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false);
    };

    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // Merge both sources into a single `kind`-discriminated list,
  // sorted newest first. Call invites sort by `createdAt`; recording
  // ready rows sort by `recordingStartedAt` (the moment the
  // recording was completed by Daily).
  const merged = useMemo<BellItem[]>(() => {
    const callItems: BellItem[] = (callInvites ?? []).map((n) => ({
      kind: "ad_hoc_call_invite" as const,
      _id: n._id,
      timestamp: n.createdAt,
      render: {
        title:
          n.callerRole === "student"
            ? "Your student started a call"
            : "Your instructor started a call",
        href: `/workspace/${n.workspaceId}?join=${n.sessionId}`,
      },
    }));
    const recordingItems: BellItem[] = (recordings ?? [])
      // Skip recording_ready rows with no workspaceId — the deep-link
      // needs `?videos={sessionId}` scoped to a workspace. Such rows
      // are anomalies (the chain writes workspaceId via
      // enqueuePendingVisibility) but we guard rather than render a
      // broken link.
      .filter(
        (n): n is typeof n & { workspaceId: NonNullable<typeof n.workspaceId> } =>
          n.workspaceId !== null
      )
      .map((n) => ({
        kind: "recording_ready" as const,
        _id: n._id,
        timestamp: n.recordingStartedAt,
        render: {
          title: "Recording ready",
          href: `/workspace/${n.workspaceId}?videos=${n.sessionId}`,
        },
      }));
    return [...callItems, ...recordingItems].sort(
      (a, b) => b.timestamp - a.timestamp
    );
  }, [callInvites, recordings]);

  const unreadCount = merged.length;
  const callInviteIds = useMemo(
    () =>
      merged
        .filter((m): m is Extract<BellItem, { kind: "ad_hoc_call_invite" }> =>
          m.kind === "ad_hoc_call_invite"
        )
        .map((m) => m._id),
    [merged]
  );
  const recordingIds = useMemo(
    () =>
      merged
        .filter((m): m is Extract<BellItem, { kind: "recording_ready" }> =>
          m.kind === "recording_ready"
        )
        .map((m) => m._id),
    [merged]
  );

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-label={unreadCount > 0 ? `Notifications (${unreadCount} unread)` : "Notifications"}
        aria-expanded={open}
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
          ref={dropdownRef}
          role="dialog"
          aria-label="Notifications"
          className={cn(
            "absolute left-0 bottom-full z-50 mb-2 w-80 max-w-[calc(100vw-220px)] max-h-[min(28rem,calc(100vh-80px))] overflow-auto",
            "rounded-md border bg-card text-card-foreground shadow-lg"
          )}
        >
          <div className="flex items-center justify-between px-3 py-2 border-b">
            <div className="text-sm font-medium">Notifications</div>
            {unreadCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  const ops: Promise<unknown>[] = [];
                  if (callInviteIds.length > 0) {
                    ops.push(
                      new Promise((resolve, reject) => {
                        markReadMany.mutate(
                          { notificationIds: callInviteIds },
                          {
                            onSuccess: () => resolve(undefined),
                            onError: (err) => reject(err),
                          }
                        );
                      })
                    );
                  }
                  for (const id of recordingIds) {
                    ops.push(
                      new Promise((resolve, reject) => {
                        markRecordingAcknowledged.mutate(
                          { notificationId: id },
                          {
                            onSuccess: () => resolve(undefined),
                            onError: (err) => reject(err),
                          }
                        );
                      })
                    );
                  }
                  Promise.all(ops).then(
                    () => setOpen(false),
                    () => {
                      // Even on partial failure the user expects the
                      // dropdown to close — the failed mutations will
                      // be visible in their next bell render.
                      setOpen(false);
                    }
                  );
                }}
              >
                <Check className="mr-1 h-3 w-3" />
                Mark all read
              </Button>
            )}
          </div>
          {unreadCount === 0 ? (
            <div className="px-3 py-6 text-sm text-muted-foreground text-center">
              No new notifications
            </div>
          ) : (
            <ul className="divide-y">
              {merged.slice(0, 10).map((item) => (
                <li key={`${item.kind}:${item._id}`} className="px-3 py-2">
                  <Link
                    href={item.render.href}
                    onClick={() => {
                      setOpen(false);
                    }}
                    className="block text-sm hover:underline"
                  >
                    <div className="font-medium flex items-center gap-2">
                      {item.kind === "recording_ready" ? (
                        <span
                          className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500"
                          aria-label="Recording ready"
                        />
                      ) : null}
                      <span>{item.render.title}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatRelativeTime(now - item.timestamp)}
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
