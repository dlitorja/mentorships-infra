"use client";

import { useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

/**
 * PR #4c-2: marks the deep-link notification as read on workspace
 * mount. Mounted inside the `/workspace/[id]` route's tree so the
 * mutation fires once the destination page is ready — NOT on bell
 * click, where the navigation race would clear the per-workspace
 * badge before the row badge query has a chance to mount.
 *
 * Looks up the notification row directly via `getUnreadForUser` and
 * finds the one matching `sessionId === initialJoinSessionId`. We
 * intentionally do NOT pass `notificationId` from the URL — that
 * would let any caller mark any notification as read. The query
 * is scoped to the current user (`getIdentity` inside
 * `getUnreadForUser`), and the mark-read mutation enforces
 * `notification.userId === identity.subject`. So even if
 * the URL is forged, the only notification we can mark is one
 * that already belongs to the current user.
 *
 * Mounts as a no-render component (`return null`) — its only
 * purpose is to schedule a one-time mark-read effect on mount.
 */
export function IncomingCallMarker({
  initialJoinSessionId,
}: {
  initialJoinSessionId: Id<"sessions">;
}) {
  const { data: notifications } = useQuery(
    convexQuery(api.inCallNotifications.getUnreadForUser, {})
  );
  const markRead = useMutation({
    mutationFn: useConvexMutation(api.inCallNotifications.markRead),
  });

  useEffect(() => {
    if (!notifications) return;
    const target = notifications.find(
      (n) => String(n.sessionId) === String(initialJoinSessionId)
    );
    if (!target) return;
    if (target.readAt !== undefined) return;
    markRead.mutate({ notificationId: target._id });
  }, [notifications, initialJoinSessionId, markRead]);

  return null;
}
