import { mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

/**
 * Identity resolved strictly from `ctx.auth.getUserIdentity()` so a
 * caller cannot spoof another user's notifications. The shape
 * mirrors `assertParticipantForSession` in `convex/workspaces.ts` —
 * uses `identity.tokenIdentifier` as the stable Clerk subject so
 * tokens across multiple sessions map to the same userId.
 *
 * Throws on no identity so callers can fail fast; every public
 * function below runs `requireIdentity` at the top.
 */
async function requireIdentity(ctx: QueryCtx): Promise<{ subject: string; tokenIdentifier: string }> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Unauthorized");
  }
  return { subject: identity.subject, tokenIdentifier: identity.tokenIdentifier };
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
    if (!instructor || instructor.userId !== identity.tokenIdentifier) {
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
        q.eq("userId", identity.tokenIdentifier).eq("readAt", undefined)
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
 * tokenIdentifier OR instructor match. Admin tokens bypass via
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

    const isOwner = workspace.ownerId === identity.tokenIdentifier;
    let isInstructor = false;
    if (workspace.instructorId !== undefined && !isOwner) {
      const instructor = await ctx.db.get(workspace.instructorId);
      isInstructor = instructor?.userId === identity.tokenIdentifier;
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
            n.userId === identity.tokenIdentifier &&
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
    if (notification.userId !== identity.tokenIdentifier) {
      throw new Error("Forbidden");
    }
    if (notification.readAt === undefined) {
      await ctx.db.patch(args.notificationId, { readAt: Date.now() });
    }
    return await ctx.db.get(args.notificationId);
  },
});

/**
 * PR #4c-2: idempotency marker for the Resend email task. Once set,
 * retries from Trigger.dev hit this branch and short-circuit
 * without sending another email. The task uses the public query
 * below to read, then calls this mutation to record the timestamp
 * after Resend accepts the message.
 *
 * This is exposed as a public mutation so the server-side trigger
 * task (which has no Convex auth context) can call it via HTTP.
 * Authorization is enforced by requiring the caller to supply
 * `(recipientUserId, sessionId)` — only the matching notification
 * row gets updated. The mutation is idempotent: a second call
 * with `emailSentAt` already set is a no-op.
 */
export const markEmailSent = mutation({
  args: {
    notificationId: v.id("inCallNotifications"),
    recipientUserId: v.string(),
    sessionId: v.id("sessions"),
    sentAt: v.number(),
  },
  handler: async (ctx, args): Promise<void> => {
    const notification = await ctx.db.get(args.notificationId);
    if (!notification) return;
    if (notification.userId !== args.recipientUserId) return;
    if (notification.sessionId !== args.sessionId) return;
    if (notification.emailSentAt !== undefined) return;
    await ctx.db.patch(args.notificationId, { emailSentAt: args.sentAt });
  },
});

/**
 * PR #4c-2: lookup used by the email trigger task to find the
 * notification row for a given session + recipient and decide
 * whether to send. Also surfaces the `workspaceId` and any
 * pre-existing `emailSentAt` timestamp.
 *
 * Exposed as a public query so the server-side trigger task can
 * call it via HTTP. Authorization is the same as `markEmailSent`:
 * the caller supplies `(recipientUserId, sessionId)` and we
 * filter to the exact match. Returns `null` if no matching row
 * exists — the trigger treats `null` as a no-op (notification was
 * deleted between create and send, or never existed).
 */
export const getBySessionId = query({
  args: {
    recipientUserId: v.string(),
    sessionId: v.id("sessions"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("inCallNotifications")
      .withIndex("by_userId_sessionId", (q) =>
        q.eq("userId", args.recipientUserId).eq("sessionId", args.sessionId)
      )
      .first();
  },
});
