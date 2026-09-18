import { ConvexError, v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";

/**
 * PR recording-ready-notifications: state-machine CRUD + the action
 * that chains from `attachRecordingFromB2Upload` into the
 * `notify-recording-ready` Trigger.dev task.
 *
 * State machine (PR #1):
 *   pending_visibility → ready_to_send
 *                                  ↘ failed (visibility-gate timeout
 *                                             OR send-error in PR #2)
 *   ready_to_send → sent (PR #2)
 *                 ↘ failed (PR #2)
 *
 * PR #1 owns `pending_visibility → ready_to_send → failed` (the
 * visibility gate). PR #2 will own `ready_to_send → sent` (the
 * email-send step). PR #3 will own the bell-side surface
 * (acknowledgement + deep link).
 *
 * The HTTP routes that the Trigger task uses to flip states live in
 * `convex/http.ts` under `/recording-ready/*`. They require the
 * same two-key auth the `/recording-transfer/*` routes use
 * (`verifyAuth` + `verifyCallbackSecret` from `convex/http.ts:2187`).
 */

const TRIGGER_API_URL =
  "https://api.trigger.dev/api/v1/tasks/notify-recording-ready/trigger";
const NOTIFY_TRIGGER_MAX_ATTEMPTS = 10;
const NOTIFY_TRIGGER_BASE_DELAY_MS = 5_000;

/**
 * Inserts a `recordingReadyNotifications` row in `pending_visibility`,
 * idempotent on `(sessionId, recipientUserId)`. Called by the chain
 * action; also reachable via the HTTP route
 * `POST /recording-ready/enqueue` (kept for parity with the rest of
 * the recording pipeline — Trigger retries the HTTP call on a
 * transient 5xx, and the route is the canonical ingress).
 *
 * Returns the existing row's `_id` if a row already exists, so the
 * caller can detect the idempotent path (useful for telemetry).
 */
export const enqueuePendingVisibility = internalMutation({
  args: {
    sessionId: v.id("sessions"),
    recipientUserId: v.string(),
    workspaceId: v.optional(v.id("workspaces")),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    notificationId: Id<"recordingReadyNotifications">;
    created: boolean;
  }> => {
    const existing = await ctx.db
      .query("recordingReadyNotifications")
      .withIndex("by_sessionId_recipientUserId", (q) =>
        q
          .eq("sessionId", args.sessionId)
          .eq("recipientUserId", args.recipientUserId)
      )
      .first();
    if (existing) {
      return { notificationId: existing._id, created: false };
    }

    const session = await ctx.db.get(args.sessionId);
    if (!session) {
      throw new ConvexError({
        code: "SESSION_NOT_FOUND",
        message: `Session ${args.sessionId} not found while enqueueing recording-ready notification`,
      });
    }

    const notificationId = await ctx.db.insert("recordingReadyNotifications", {
      sessionId: args.sessionId,
      workspaceId: args.workspaceId ?? session.workspaceId,
      recipientUserId: args.recipientUserId,
      recordingStartedAt: session.callStartedAt ?? session._creationTime,
      recordingCallEndedAt: session.callEndedAt,
      deliveryStatus: "pending_visibility",
    });
    return { notificationId, created: true };
  },
});

/**
 * Flips `pending_visibility → ready_to_send` and stamps the resolved
 * workspace id. Called by the Trigger task once the visibility gate
 * returns `ok`. Idempotent: re-calls leave the row in
 * `ready_to_send` (the second call is a no-op).
 */
export const markReadyToSend = internalMutation({
  args: {
    notificationId: v.id("recordingReadyNotifications"),
    workspaceId: v.id("workspaces"),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ notificationId: Id<"recordingReadyNotifications"> }> => {
    const row = await ctx.db.get(args.notificationId);
    if (!row) {
      throw new ConvexError({
        code: "NOTIFICATION_NOT_FOUND",
        message: `recordingReadyNotifications row ${args.notificationId} not found`,
      });
    }
    if (row.deliveryStatus === "ready_to_send") {
      return { notificationId: row._id };
    }
    if (row.deliveryStatus !== "pending_visibility") {
      throw new ConvexError({
        code: "INVALID_STATE_TRANSITION",
        message: `Cannot mark notification ${args.notificationId} ready_to_send from ${row.deliveryStatus}`,
      });
    }
    await ctx.db.patch(row._id, {
      deliveryStatus: "ready_to_send",
      workspaceId: args.workspaceId,
    });
    return { notificationId: row._id };
  },
});

/**
 * Flips `ready_to_send → sent` (PR #2 calls this once the email
 * lands). Optional `providerEmailId` (Resend message id) for
 * operator-side tracing. Idempotent: re-calls are no-ops.
 *
 * PR #1 does not call this — it's wired up here so PR #2 can
 * reuse the same module without a second import path.
 */
export const markSent = internalMutation({
  args: {
    notificationId: v.id("recordingReadyNotifications"),
    providerEmailId: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ notificationId: Id<"recordingReadyNotifications"> }> => {
    const row = await ctx.db.get(args.notificationId);
    if (!row) {
      throw new ConvexError({
        code: "NOTIFICATION_NOT_FOUND",
        message: `recordingReadyNotifications row ${args.notificationId} not found`,
      });
    }
    if (row.deliveryStatus === "sent") {
      return { notificationId: row._id };
    }
    if (row.deliveryStatus !== "ready_to_send") {
      throw new ConvexError({
        code: "INVALID_STATE_TRANSITION",
        message: `Cannot mark notification ${args.notificationId} sent from ${row.deliveryStatus}`,
      });
    }
    await ctx.db.patch(row._id, {
      deliveryStatus: "sent",
      sentAt: Date.now(),
      providerEmailId: args.providerEmailId,
    });
    return { notificationId: row._id };
  },
});

/**
 * Flips to `failed` from any non-terminal state. Called by the
 * Trigger task when the visibility gate exhausts
 * `maxAttempts`, OR by PR #2 when the email send fails.
 *
 * Stores `deliveryError` for operator triage and is the
 * surface the admin sweep (HUC-22 in the plan doc) would
 * query against the `by_deliveryStatus` index.
 */
export const markFailed = internalMutation({
  args: {
    notificationId: v.id("recordingReadyNotifications"),
    deliveryError: v.string(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ notificationId: Id<"recordingReadyNotifications"> }> => {
    const row = await ctx.db.get(args.notificationId);
    if (!row) {
      throw new ConvexError({
        code: "NOTIFICATION_NOT_FOUND",
        message: `recordingReadyNotifications row ${args.notificationId} not found`,
      });
    }
    if (row.deliveryStatus === "failed" || row.deliveryStatus === "sent") {
      return { notificationId: row._id };
    }
    await ctx.db.patch(row._id, {
      deliveryStatus: "failed",
      deliveryError: args.deliveryError,
    });
    return { notificationId: row._id };
  },
});

/**
 * Resolves a row by `(sessionId, recipientUserId)`. The Trigger
 * task uses this to look up the `notificationId` it needs to
 * pass to the mark-* mutations. Exposed for the same reason the
 * mutations are exposed: PR #2 will look up the row to find the
 * recipient's email and the resolved workspace for the deep link.
 *
 * Internal query — only callable from another Convex function.
 */
export const getNotificationForRecipient = internalMutation({
  args: {
    sessionId: v.id("sessions"),
    recipientUserId: v.string(),
  },
  handler: async (
    ctx,
    args
  ): Promise<Doc<"recordingReadyNotifications"> | null> => {
    return await ctx.db
      .query("recordingReadyNotifications")
      .withIndex("by_sessionId_recipientUserId", (q) =>
        q
          .eq("sessionId", args.sessionId)
          .eq("recipientUserId", args.recipientUserId)
      )
      .first();
  },
});

/**
 * PR recording-ready-notifications (PR #2): looks up the recipient
 * user behind a `recordingReadyNotifications` row and returns the
 * fields the email-send flow needs:
 *   - `email` — for the Resend `to` field. `null` if the user
 *     can't be resolved (very rare; the row still goes to `sent`
 *     with no providerEmailId so it isn't stranded).
 *   - `firstName` — for the greeting line. `null` if not set.
 *   - `recordingReadyEmail` — the per-student email toggle. Reads
 *     `users.notificationPreferences.recordingReadyEmail` and
 *     defaults to `true` when the JSON blob is missing or
 *     malformed. The `true` default is opt-out by design: PR #4
 *     adds the Videos tab UI for the user to flip it off, but
 *     existing students must keep getting notified on first land.
 *   - `instructorName` — for the email body line. Falls back to
 *     "your instructor" when the instructor row is missing.
 *
 * Called from the `notify-recording-ready` Trigger task via the
 * HTTP route `POST /recording-ready/get-recipient-info` after the
 * visibility gate flips the row to `ready_to_send`.
 *
 * Internal query — only callable from another Convex function or
 * via the HTTP route (which checks `verifyCallbackSecret`).
 */
export const getRecipientInfoForNotification = internalQuery({
  args: {
    notificationId: v.id("recordingReadyNotifications"),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    email: string | null;
    firstName: string | null;
    instructorName: string;
    recordingReadyEmail: boolean;
    sessionId: Id<"sessions">;
    workspaceId: Id<"workspaces"> | null;
  }> => {
    const row = await ctx.db.get(args.notificationId);
    if (!row) {
      throw new ConvexError({
        code: "NOTIFICATION_NOT_FOUND",
        message: `recordingReadyNotifications row ${args.notificationId} not found`,
      });
    }

    const user = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", row.recipientUserId))
      .first();

    const recordingReadyEmail = readRecordingReadyEmailPreference(
      user?.notificationPreferences
    );

    const session = await ctx.db.get(row.sessionId);
    let instructorName = "your instructor";
    if (session) {
      const instructor = await ctx.db.get(session.instructorId);
      if (instructor?.name) instructorName = instructor.name;
    }

    return {
      email: user?.email ?? null,
      firstName: user?.firstName ?? null,
      instructorName,
      recordingReadyEmail,
      sessionId: row.sessionId,
      workspaceId: row.workspaceId ?? null,
    };
  },
});

/**
 * Reads `users.notificationPreferences.recordingReadyEmail` from a
 * loosely-typed JSON blob and defaults to `true` (opt-out) when
 * missing or malformed. The blob is `v.optional(v.any())` because
 * we want it to round-trip arbitrary future toggles without
 * schema migrations; the trade-off is that we have to validate on
 * read. `boolean` is the only accepted shape — anything else
 * falls back to the default.
 */
function readRecordingReadyEmailPreference(
  preferences: unknown
): boolean {
  if (
    preferences &&
    typeof preferences === "object" &&
    "recordingReadyEmail" in preferences
  ) {
    const value = (preferences as { recordingReadyEmail: unknown })
      .recordingReadyEmail;
    if (typeof value === "boolean") return value;
  }
  return true;
}

/**
 * Convex action that bridges `attachRecordingFromB2Upload` (a
 * mutation, no Node runtime) into the `notify-recording-ready`
 * Trigger.dev task (which has the Node runtime + the env vars
 * the task needs).
 *
 * Mirrors `triggerTransferTask` at `convex/dailyRecordingActions.ts:116`:
 * the action layer calls Trigger.dev's REST API with
 * `TRIGGER_SECRET_KEY` (falls back to `TRIGGER_API_KEY`) because
 * the Convex action layer cannot import `@trigger.dev/sdk`
 * directly. Idempotency key is derived from `(sessionId, recipientUserId)`
 * — Trigger will reuse the run id on retried triggers.
 *
 * Steps:
 *   1. Insert the `recordingReadyNotifications` row in
 *      `pending_visibility`. Idempotent on (sessionId, recipientUserId)
 *      via `enqueuePendingVisibility`.
 *   2. Trigger the `notify-recording-ready` task with the row id +
 *      session + recipient. The task takes over from there.
 *
 * Greptile R1 P2: the Trigger fetch is wrapped in
 * `triggerNotifyRecordingReady`, which retries on 5xx / network
 * errors up to `MAX_TRIGGER_FETCH_ATTEMPTS` times with exponential
 * backoff. If the retry budget is exhausted, the row is flipped
 * to `failed` with a `deliveryError` annotation so the planned
 * admin sweep (`Schema Changes` project, HUC-22) can re-process
 * it, and the action re-throws so operators see the failure in
 * the Convex dashboard. Without the mark-failed fallback, a hard
 * Trigger outage would silently strand every notification row.
 */
export const chainNotifyRecordingReady = internalAction({
  args: {
    sessionId: v.id("sessions"),
    recipientUserId: v.string(),
    notificationId: v.optional(v.id("recordingReadyNotifications")),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    sessionId: Id<"sessions">;
    recipientUserId: string;
    notificationId: Id<"recordingReadyNotifications">;
    triggerRunId: string;
  }> => {
    const enqueue = args.notificationId
      ? { notificationId: args.notificationId, created: false }
      : await ctx.runMutation(
          internal.recordingReadyNotifications.enqueuePendingVisibility,
          {
            sessionId: args.sessionId,
            recipientUserId: args.recipientUserId,
          }
        );

    const triggerSecretKey =
      process.env.TRIGGER_SECRET_KEY ?? process.env.TRIGGER_API_KEY;
    if (!triggerSecretKey) {
      throw new Error(
        "TRIGGER_SECRET_KEY (or TRIGGER_API_KEY) is not configured for the Convex action layer"
      );
    }
    const idempotencyKey = `notify-recording-ready:${args.sessionId}:${args.recipientUserId}`;
    let triggerBody: { id?: string } = { id: "" };
    try {
      const result = await triggerNotifyRecordingReady({
        triggerSecretKey,
        payload: {
          sessionId: String(args.sessionId),
          recipientUserId: args.recipientUserId,
          notificationId: String(enqueue.notificationId),
        },
        idempotencyKey,
      });
      triggerBody = result ?? { id: "" };
    } catch (triggerError) {
      // Greptile R1 P2: a hard Trigger.dev outage must NOT strand
      // the row in `pending_visibility`. Flip it to `failed` with
      // a `deliveryError` annotation so the planned admin sweep
      // (`Schema Changes` project, HUC-22) can re-process it.
      // The action then re-throws so the call site (B2 callback
      // chain) sees the failure and operators can see it in the
      // Convex dashboard.
      await ctx.runMutation(
        internal.recordingReadyNotifications.markFailed,
        {
          notificationId: enqueue.notificationId,
          deliveryError: `trigger-fetch-exhausted:${
            triggerError instanceof Error
              ? triggerError.message
              : String(triggerError)
          }`,
        }
      );
      throw triggerError;
    }
    return {
      sessionId: args.sessionId,
      recipientUserId: args.recipientUserId,
      notificationId: enqueue.notificationId,
      triggerRunId: triggerBody.id ?? "",
    };
  },
});

/**
 * Greptile R1 P2 (PR recording-ready-notifications): the Trigger
 * fetch used to throw immediately on a transient HTTP failure,
 * stranding the `recordingReadyNotifications` row in
 * `pending_visibility` forever (Convex actions are not
 * auto-retried, and the B2-callback chain short-circuits on
 * `status === "ready"` so a re-fire won't re-schedule).
 *
 * This wraps the fetch in a small exponential-backoff retry
 * loop. After `MAX_TRIGGER_FETCH_ATTEMPTS` attempts, the row is
 * flipped to `failed` with a `deliveryError` annotation so the
 * planned admin sweep (`Schema Changes` project, HUC-22) can
 * surface it for re-processing. Without the mark-failed fallback,
 * a hard Trigger outage would silently strand every row.
 *
 * Retry budget: 3 attempts × ~7s of total backoff (1s + 2s + 4s
 * before attempt 2/3/4) — cheap enough that a single transient
 * blip recovers automatically, bounded enough that a hard outage
 * gives up before blocking the action queue for minutes.
 */
const MAX_TRIGGER_FETCH_ATTEMPTS = 4;
const TRIGGER_FETCH_BACKOFF_BASE_MS = 1_000;

async function triggerNotifyRecordingReady(args: {
  triggerSecretKey: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
}): Promise<{ id?: string } | null> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= MAX_TRIGGER_FETCH_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(TRIGGER_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${args.triggerSecretKey}`,
        },
        body: JSON.stringify({
          payload: args.payload,
          idempotencyKey: args.idempotencyKey,
        }),
      });
      if (response.ok) {
        return (await response.json()) as { id?: string };
      }
      // 5xx → transient (retry). 4xx → persistent (don't retry;
      // the body tells the operator what's wrong).
      if (response.status >= 400 && response.status < 500) {
        const body = await response.text();
        throw new Error(
          `Trigger.dev trigger rejected with ${response.status}: ${body.slice(0, 200)}`
        );
      }
      lastError = new Error(
        `Trigger.dev trigger failed: ${response.status}`
      );
    } catch (err) {
      // Rethrow permanent errors (4xx) immediately.
      if (
        err instanceof Error &&
        err.message.startsWith("Trigger.dev trigger rejected with ")
      ) {
        throw err;
      }
      lastError = err;
    }
    if (attempt < MAX_TRIGGER_FETCH_ATTEMPTS) {
      await sleep(
        TRIGGER_FETCH_BACKOFF_BASE_MS * Math.pow(2, attempt - 1)
      );
    }
  }
  throw new Error(
    `Trigger.dev trigger failed after ${MAX_TRIGGER_FETCH_ATTEMPTS} attempts: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Re-export for tests + clarity.
export const _internal = {
  NOTIFY_TRIGGER_MAX_ATTEMPTS,
  NOTIFY_TRIGGER_BASE_DELAY_MS,
};
