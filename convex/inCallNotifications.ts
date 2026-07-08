import { mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

/**
 * Identity resolved strictly from `ctx.auth.getUserIdentity()` so a
 * caller cannot spoof another user's notifications. The shape
 * mirrors `assertParticipantForSession` in `convex/workspaces.ts` —
 * uses `identity.subject` as the stable Clerk user ID so it
 * matches the bare Clerk ID stored in `inCallNotifications.userId`
 * (which equals `workspaces.ownerId`).
 *
 * The codebase stores bare Clerk user IDs (e.g.
 * `user_3FeL3ri6RljSpv3HDKxmWfnVPi7`) in `workspaces.ownerId`,
 * `instructors.userId`, and `inCallNotifications.userId`. For
 * Convex 1.x with Clerk, `identity.subject` carries that bare
 * Clerk user ID; `identity.tokenIdentifier` carries the
 * issuer-prefixed canonical form. The two are not byte-equal, so
 * the comparison only works against `identity.subject`. See the
 * matching comment block in `convex/sessions.ts:6-37` and
 * `convex/instructors.ts:43-58` for the cross-file rationale.
 *
 * Throws on no identity so callers can fail fast; every public
 * function below runs `requireIdentity` at the top.
 */
async function requireIdentity(ctx: QueryCtx): Promise<{ subject: string }> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Unauthorized");
  }
  return { subject: identity.subject };
}

/**
 * PR #4c-2: idempotent insert of an ad-hoc-call invite notification.
 *
 * Exposed as a public mutation so the Next.js API route
 * `/api/video/start-adhoc` can call it via `fetchMutation` after
 * the existing `startAdhocCall` mutation has succeeded.
 *
 * Authorization: this mutation takes only `(sessionId, workspaceId)`
 * and derives the recipient from `workspace.ownerId`. It then
 * verifies the caller is the workspace's instructor — same shape
 * as `startAdhocCall`. So a caller who is NOT the workspace's
 * instructor cannot create a notification for anyone. The route
 * already does this check via `startAdhocCall`, but the duplication
 * is defense-in-depth: if a future caller forgets the upstream
 * check, the mutation rejects them anyway.
 *
 * Dedup: uses `by_userId_sessionId` as the dedupe index. If a row
 * already exists for the same (recipient, session), no new row is
 * created — we patch `expiresAt` forward so a re-started call
 * surfaces again to the student even if their previous
 * notification was unread.
 *
 * Returns the notification id (newly inserted or pre-existing).
 */
export const createAdHocCallNotification = mutation({
  args: {
    sessionId: v.id("sessions"),
    workspaceId: v.id("workspaces"),
  },
  handler: async (ctx, args): Promise<Id<"inCallNotifications">> => {
    const identity = await requireIdentity(ctx);

    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace) {
      throw new Error("Workspace not found");
    }
    if (workspace.deletedAt !== undefined || workspace.endedAt !== undefined) {
      throw new Error("Workspace is ended or deleted");
    }
    if (workspace.instructorId === undefined) {
      throw new Error("Workspace has no instructor");
    }
    const instructor = await ctx.db.get(workspace.instructorId);
    if (!instructor || instructor.userId !== identity.subject) {
      throw new Error("Forbidden: only the workspace's instructor can notify");
    }

    const recipientUserId = workspace.ownerId;
    const now = Date.now();

    const existing = await ctx.db
      .query("inCallNotifications")
      .withIndex("by_userId_sessionId", (q) =>
        q.eq("userId", recipientUserId).eq("sessionId", args.sessionId)
      )
      .first();

    if (existing) {
      // Refresh expiry so a re-issued call surfaces again to the
      // student; clear `readAt` so the badge comes back if they had
      // marked it read between call restarts.
      await ctx.db.patch(existing._id, {
        expiresAt: now + TWENTY_FOUR_HOURS_MS,
        readAt: undefined,
      });
      return existing._id;
    }

    return await ctx.db.insert("inCallNotifications", {
      userId: recipientUserId,
      sessionId: args.sessionId,
      workspaceId: args.workspaceId,
      kind: "ad_hoc_call_invite",
      createdAt: now,
      expiresAt: now + TWENTY_FOUR_HOURS_MS,
    });
  },
});

/**
 * PR #4c-2: read all unread, non-expired ad-hoc-call invite
 * notifications for the current user. Drives the sidebar bell
 * count + dropdown list.
 *
 * Filters `expiresAt > now` AND `readAt === undefined` in JS after
 * the indexed read. The query uses `by_userId_readAt` with
 * `eq("readAt", undefined)` so the index only returns rows that
 * lack a read timestamp — `.filter()` is then used solely to drop
 * expired rows. Per the Convex guideline, this filter is at the
 * edge of acceptable: a real production deployment would push this
 * into a separate `by_userId_active` index, but with the 24-hour
 * TTL the unfiltered set is bounded by however many ad-hoc calls
 * one user received in that window (typically <10). We `.take(50)`
 * as a safety cap.
 */
export const getUnreadForUser = query({
  args: {},
  handler: async (ctx) => {
    const identity = await requireIdentity(ctx);
    const now = Date.now();

    const candidates = await ctx.db
      .query("inCallNotifications")
      .withIndex("by_userId_readAt", (q) =>
        q.eq("userId", identity.subject).eq("readAt", undefined)
      )
      .take(50);

    return candidates
      .filter((n) => n.expiresAt > now)
      .sort((a, b) => b.createdAt - a.createdAt);
  },
});

/**
 * PR #4c-2: read the single active (unread, non-expired)
 * notification for a given workspace — drives the red dot on the
 * workspace picker row. Returns `null` if no active call invite
 * exists, so the badge component can render nothing without
 * special-casing.
 *
 * Authorizes the caller as a participant on the workspace before
 * returning. Authorization mirrors `getWorkspaceById` shape —
 * fetches the workspace, then checks `ownerId` against the Clerk
 * subject OR instructor match. Admin tokens bypass via
 * the `instructors.by_userId` lookup the same way `getUserWorkspaces`
 * does, but in practice this query is most often called by the
 * workspace owner (the student) from the picker UI.
 */
export const getUnreadForWorkspace = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx);
    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace) return null;
    if (workspace.deletedAt !== undefined || workspace.endedAt !== undefined) {
      return null;
    }

    const isOwner = workspace.ownerId === identity.subject;
    let isInstructor = false;
    if (workspace.instructorId !== undefined && !isOwner) {
      const instructor = await ctx.db.get(workspace.instructorId);
      isInstructor = instructor?.userId === identity.subject;
    }
    if (!isOwner && !isInstructor) {
      return null;
    }

    const now = Date.now();
    const candidates = await ctx.db
      .query("inCallNotifications")
      .withIndex("by_workspaceId_sessionId", (q) =>
        q.eq("workspaceId", args.workspaceId)
      )
      .take(50);

    return (
      candidates
        .filter(
          (n) =>
            n.userId === identity.subject &&
            n.expiresAt > now &&
            n.readAt === undefined
        )
        .sort((a, b) => b.createdAt - a.createdAt)[0] ?? null
    );
  },
});

/**
 * PR #4c-2: mark a notification as read. Idempotent — if
 * `readAt` is already set, the existing value is preserved so the
 * `markUnread` use case (re-opening the dropdown) works.
 *
 * Authorization: only the notification's own `userId` may mark it
 * read. The route never receives a `userId` arg — identity comes
 * from `ctx.auth`.
 */
export const markRead = mutation({
  args: { notificationId: v.id("inCallNotifications") },
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx);
    const notification = await ctx.db.get(args.notificationId);
    if (!notification) {
      throw new Error("Notification not found");
    }
    if (notification.userId !== identity.subject) {
      throw new Error("Forbidden");
    }
    if (notification.readAt === undefined) {
      await ctx.db.patch(args.notificationId, { readAt: Date.now() });
    }
    return await ctx.db.get(args.notificationId);
  },
});

/**
 * PR #4c-2: batch-mark many notifications read in one transaction.
 * Used by the sidebar bell's "Mark all read" button so the UI
 * fires a single mutation round-trip instead of N — both for
 * Clerk/convex latency and for partial-failure safety (a loop of
 * N independent mutations leaves the badge inconsistent on a
 * single failure).
 *
 * Authorization mirrors `markRead`: each row's `userId` must
 * match the caller's `identity.subject`. Rows that don't
 * match are skipped (not an error) so a stale client with a
 * partially-deleted cache can't 403 the whole batch.
 *
 * Idempotent per row: rows with `readAt !== undefined` are
 * skipped. The mutation returns the count of rows actually
 * updated so the client can confirm.
 */
export const markReadMany = mutation({
  args: {
    notificationIds: v.array(v.id("inCallNotifications")),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ updatedCount: number }> => {
    const identity = await requireIdentity(ctx);
    const now = Date.now();
    let updatedCount = 0;

    for (const id of args.notificationIds) {
      const row = await ctx.db.get(id);
      if (!row) continue;
      if (row.userId !== identity.subject) continue;
      if (row.readAt !== undefined) continue;
      await ctx.db.patch(id, { readAt: now });
      updatedCount += 1;
    }

    return { updatedCount };
  },
});
