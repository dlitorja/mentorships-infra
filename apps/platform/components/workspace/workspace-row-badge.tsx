"use client";

import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

/**
 * PR #4c-2: small red-dot indicator on a workspace picker row
 * when the current user has an active (unread, non-expired)
 * notification for that workspace.
 *
 * The badge component is intentionally minimal — just an
 * 8x8 destructive-coloured dot. Tooltip and "Join now" affordance
 * live on the parent row button so the user can click anywhere on
 * the row to navigate to `/workspace/[id]?join={sessionId}`.
 *
 * Renders `null` when no notification is active, so the parent
 * does not need to special-case the empty state.
 *
 * `workspaceId` is typed as `Id<"workspaces">` so the convex
 * query argument validates at the type level instead of needing a
 * cast. The parent's `Id` import keeps the call site correctly
 * typed without `as never`.
 */
export function WorkspaceRowBadge({
  workspaceId,
}: {
  workspaceId: Id<"workspaces">;
}) {
  const { data: notification } = useQuery({
    ...convexQuery(api.inCallNotifications.getUnreadForWorkspace, {
      workspaceId,
    }),
    enabled: Boolean(workspaceId),
  });

  if (!notification) return null;

  return (
    <span
      className="ml-2 inline-block h-2 w-2 shrink-0 rounded-full bg-destructive"
      aria-label="Active call invite"
      title="Active call invite — click row to join"
    />
  );
}
