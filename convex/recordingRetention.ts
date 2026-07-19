import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * R12: 90-day automatic retention for call recordings uploaded to
 * Backblaze B2 by the Daily → B2 transfer pipeline
 * (`src/trigger/recording-transfer.ts`). Records the upload time
 * in `recordingExpiresAt` (`attachRecordingFromB2Upload` patches
 * this exactly once per row), then:
 *
 *   - The Trigger schedule
 *     `cleanup-expired-call-recordings` (cron `0 5 * * *`) deletes
 *     B2 objects and flips `recordingTransferStatus = "purged"`
 *     for sessions whose `recordingExpiresAt` has passed.
 *   - The Trigger schedule
 *     `send-recording-retention-warnings` (cron `0 10 * * *`)
 *     sends Resend emails at the 30/7/1-day windows and writes
 *     `recordingRetentionNotifications` rows for in-app banner
 *     surfacing.
 *
 * Defaults to 90 days so the most-recent quarter of recordings is
 * always available; backfills to `_creationTime + 90d` for legacy
 * rows. Configurable via the `RECORDING_RETENTION_DAYS` env var
 * (read in `attachRecordingFromB2Upload`, which is the only
 * place the value is captured at write time).
 */
export const DEFAULT_RECORDING_RETENTION_DAYS = 90;
export const DEFAULT_RECORDING_RETENTION_MS =
  DEFAULT_RECORDING_RETENTION_DAYS * DAY_MS;

/**
 * Warning thresholds (days before deletion). Tighter than the
 * workspace retention (90/30/7) because the recording lifecycle
 * is shorter and the email is more actionable ("download before
 * May 14") — a workspace deletion warning at 90 days is too
 * noisy for a single recording.
 */
const WARNING_THRESHOLDS_DAYS = [30, 7, 1] as const;

export type RecordingRetentionWindow = {
  sessionId: Id<"sessions">;
  workspaceId: Id<"workspaces">;
  recordingExpiresAt: number;
  daysUntilDeletion: number;
  recipients: Array<{
    userId: string;
    role: "instructor" | "student";
  }>;
};

/**
 * Returns recordings whose `recordingExpiresAt` is in the past
 * AND whose B2 object has not been deleted yet. Used by the
 * cleanup HTTP route (`convex/http.ts:httpCleanupRecordings`)
 * invoked from `src/trigger/recording-retention.ts`.
 *
 * Index: `by_recordingExpiresAt` so the query is bounded to
 * rows that actually have a `recordingExpiresAt` value set
 * (most rows have `undefined` and never enter the candidate
 * set). We still `.filter` for `recordingUrl !== undefined &&
 * recordingTransferStatus === "ready"` because the indexed
 * read returns rows where the predicate is true but the
 * unindexed fields could be in any state.
 *
 * `.take(200)` — Convex guidelines cap unbounded reads; the
 * cleanup loop re-invokes this query until it returns empty.
 */
export const getRecordingsNeedingCleanup = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, args): Promise<Array<Doc<"sessions">>> => {
    const candidates = await ctx.db
      .query("sessions")
      .withIndex("by_recordingExpiresAt", (q) =>
        q.lt("recordingExpiresAt", args.now)
      )
      .take(200);
    return candidates.filter(
      (s) =>
        s.deletedAt === undefined &&
        s.recordingUrl !== undefined &&
        s.recordingTransferStatus === "ready"
    );
  },
});

/**
 * Returns recordings approaching their `recordingExpiresAt`
 * within one of the configured warning thresholds (30/7/1 days).
 * Each row carries the resolved recipients so the Trigger
 * warnings job can dispatch one email per recipient without a
 * second round-trip. The deduplication key is
 * (sessionId, recipientUserId, daysUntilDeletion) — the
 * `createRecordingRetentionNotification` mutation rejects
 * inserts that match this key.
 */
export const getRecordingsForRetentionNotification = internalQuery({
  args: { now: v.number() },
  handler: async (
    ctx,
    args
  ): Promise<RecordingRetentionWindow[]> => {
    const candidates = await ctx.db
      .query("sessions")
      .withIndex("by_recordingExpiresAt", (q) =>
        q.lt("recordingExpiresAt", args.now)
      )
      .take(500);

    const out: RecordingRetentionWindow[] = [];
    for (const s of candidates) {
      if (s.deletedAt !== undefined) continue;
      if (s.recordingUrl === undefined) continue;
      if (s.recordingExpiresAt === undefined) continue;
      if (s.recordingTransferStatus !== "ready") continue;

      const daysUntilDeletion = Math.floor(
        (s.recordingExpiresAt - args.now) / DAY_MS
      );
      if (
        !WARNING_THRESHOLDS_DAYS.some(
          (t) => daysUntilDeletion >= t - 1 && daysUntilDeletion <= t + 1
        )
      ) {
        continue;
      }

      const workspaceId = await resolveWorkspaceId(ctx, s);
      if (workspaceId === null) continue;

      const recipients = await resolveRecipients(ctx, s);
      if (recipients.length === 0) continue;

      out.push({
        sessionId: s._id,
        workspaceId,
        recordingExpiresAt: s.recordingExpiresAt,
        daysUntilDeletion,
        recipients,
      });
    }
    return out;
  },
});

/**
 * Resolves the Clerk user IDs of the participants who should
 * receive a retention warning. Mirrors the visibility model of
 * `getCallRecordingsForWorkspace` (instructor on the session
 * OR workspace owner / student) — both parties have access to
 * the recording, so both need to know it's about to be deleted.
 *
 * The "instructor" recipient is the Clerk user ID stored on
 * the `instructors` table for this session; the "student"
 * recipient is `session.studentId` (which is already a Clerk
 * user ID per `getCallRecordingsForWorkspace`).
 */
async function resolveRecipients(
  ctx: QueryCtx,
  session: Doc<"sessions">
): Promise<Array<{ userId: string; role: "instructor" | "student" }>> {
  const out: Array<{ userId: string; role: "instructor" | "student" }> = [];
  if (session.studentId) {
    out.push({ userId: session.studentId, role: "student" });
  }
  if (session.instructorId) {
    const instructor = await ctx.db.get(session.instructorId);
    if (instructor && instructor.userId) {
      out.push({ userId: instructor.userId, role: "instructor" });
    }
  }
  return out;
}

/**
 * Resolves the workspace that owns this session, used as the
 * foreign key on `recordingRetentionNotifications`. Sessions
 * are 1:1 with (instructorId, studentId) workspaces via the
 * `by_instructorId_ownerId` index on `workspaces` (added in
 * PR #4c-1 for `assertParticipantForSession`). Returns
 * `null` if the workspace is soft-deleted, since we don't
 * want to send warnings against a workspace that's already
 * being torn down by the workspace retention pipeline.
 */
async function resolveWorkspaceId(
  ctx: QueryCtx,
  session: Doc<"sessions">
): Promise<Id<"workspaces"> | null> {
  if (!session.instructorId || !session.studentId) return null;
  const workspace = await ctx.db
    .query("workspaces")
    .withIndex("by_instructorId_ownerId", (q) =>
      q
        .eq("instructorId", session.instructorId!)
        .eq("ownerId", session.studentId)
    )
    .first();
  if (!workspace) return null;
  if (workspace.deletedAt !== undefined) return null;
  return workspace._id;
}

/**
 * Records a retention notification for a single recipient.
 * Idempotent on (sessionId, recipientUserId, daysUntilDeletion)
 * via the `by_sessionId_recipientUserId_daysUntilDeletion`
 * index: if a row already exists with the same key and no
 * `acknowledgedAt`, we skip the insert. This is what keeps the
 * Trigger warnings job from spamming the same recipient at the
 * same threshold on every daily cron tick.
 */
export const createRecordingRetentionNotification = internalMutation({
  args: {
    sessionId: v.id("sessions"),
    workspaceId: v.id("workspaces"),
    recipientUserId: v.string(),
    recipientRole: v.union(v.literal("instructor"), v.literal("student")),
    notificationType: v.union(v.literal("expiry_warning"), v.literal("deleted")),
    recordingExpiresAt: v.number(),
    daysUntilDeletion: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("recordingRetentionNotifications")
      .withIndex(
        "by_sessionId_recipientUserId_daysUntilDeletion",
        (q) =>
          q
            .eq("sessionId", args.sessionId)
            .eq("recipientUserId", args.recipientUserId)
            .eq("daysUntilDeletion", args.daysUntilDeletion)
      )
      .first();
    if (existing) return { skipped: true, id: existing._id };

    const id = await ctx.db.insert("recordingRetentionNotifications", {
      ...args,
      sentAt: Date.now(),
    });
    return { skipped: false, id };
  },
});

/**
 * Public mutation: ack a retention warning banner. Sets
 * `acknowledgedAt` so the banner stops surfacing it.
 *
 * Auth: the caller MUST be the notification's recipient.
 * Without this check (Greptile P1 — security review) an
 * authenticated user could dismiss any other recipient's
 * notification by guessing the document id, which would
 * hide legitimate warnings from the intended recipient.
 */
export const acknowledgeRecordingRetentionNotification = mutation({
  args: { id: v.id("recordingRetentionNotifications") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const existing = await ctx.db.get(args.id);
    if (!existing) throw new Error("Notification not found");
    if (existing.recipientUserId !== identity.subject) {
      throw new Error(
        "Forbidden: cannot acknowledge another user's notification"
      );
    }
    await ctx.db.patch(args.id, { acknowledgedAt: Date.now() });
    return await ctx.db.get(args.id);
  },
});

/**
 * Returns unacknowledged retention notifications for the
 * authenticated user across all workspaces. Powers the
 * in-app banner in
 * `apps/platform/components/workspace/recording-retention-warning-banner.tsx`.
 */
export const getUnacknowledgedRecordingRetentionNotifications = query({
  args: {},
  handler: async (ctx) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) return [];
    return await ctx.db
      .query("recordingRetentionNotifications")
      .withIndex("by_recipientUserId", (q) =>
        q.eq("recipientUserId", user.subject)
      )
      .filter((q) => q.eq(q.field("acknowledgedAt"), undefined))
      .collect();
  },
});

/**
 * Internal mutation: flip the session to the `purged` terminal
 * state. Called from the cleanup HTTP route after `deleteFromB2`
 * succeeds. Idempotent: a second invocation is a no-op because
 * we early-return when `recordingTransferStatus === "purged"`.
 */
export const markRecordingDeleted = internalMutation({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) throw new Error("Session not found");
    if (session.recordingTransferStatus === "purged") {
      return { sessionId: session._id, alreadyPurged: true };
    }
    await ctx.db.patch(session._id, {
      recordingUrl: undefined,
      recordingDeletedAt: Date.now(),
      recordingTransferStatus: "purged",
      recordingTransferUpdatedAt: Date.now(),
    });
    return { sessionId: session._id, alreadyPurged: false };
  },
});
