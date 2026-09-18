"use client";

import { useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

/**
 * PR #3: marks the deep-link recording notification as acknowledged
 * on workspace mount. Mirrors `<IncomingCallMarker />` for the
 * ad-hoc-call bell surface. Mounted inside the `/workspace/[id]`
 * route's tree so the mutation fires once the destination page is
 * ready — NOT on bell click, where the navigation race would clear
 * the bell badge before the listUnreadForUser query has a chance to
 * refetch.
 *
 * Looks up the notification row via `listUnreadForUser` and finds
 * the one matching `sessionId === initialVideoSessionId`. We do
 * NOT pass `notificationId` from the URL — that would let any
 * caller mark any notification as acknowledged. The query is
 * scoped to the current user (`getIdentity` inside
 * `listUnreadForUser`), and the `markAcknowledged` mutation
 * enforces `notification.recipientUserId === identity.subject`.
 * So even if the URL is forged, the only notification we can
 * mark is one that already belongs to the current user.
 *
 * Mounts as a no-render component (`return null`) — its only
 * purpose is to schedule a one-time mark-acknowledged effect
 * on mount.
 */
export function RecordingAcknowledgedMarker({
  initialVideoSessionId,
}: {
  initialVideoSessionId: Id<"sessions">;
}) {
  const { data: notifications } = useQuery(
    convexQuery(api.recordingReadyNotifications.listUnreadForUser, {})
  );
  const markAcknowledged = useMutation({
    mutationFn: useConvexMutation(
      api.recordingReadyNotifications.markAcknowledged
    ),
  });

  useEffect(() => {
    if (!notifications) return;
    const target = notifications.find(
      (n) => String(n.sessionId) === String(initialVideoSessionId)
    );
    if (!target) return;
    markAcknowledged.mutate({ notificationId: target._id });
  }, [notifications, initialVideoSessionId, markAcknowledged]);

  return null;
}
