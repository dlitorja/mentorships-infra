import { task, logger, metadata, wait } from "@trigger.dev/sdk";
import { api } from "../../convex/_generated/api";
import { sendEmail } from "../../packages/emails/src/send";
import { buildRecordingReadyEmail } from "../../packages/emails/src/recording-ready";

const CONVEX_DEPLOYMENT_URL =
  process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_DEPLOYMENT_URL;
const CONVEX_HTTP_KEY = process.env.CONVEX_HTTP_KEY;
const CALLBACK_SECRET = process.env.CONVEX_TRIGGER_CALLBACK_SECRET;

type Payload = {
  sessionId: string;
  recipientUserId: string;
  notificationId: string;
};

type CallbackBody = {
  notificationId: string;
  workspaceId?: string;
  deliveryError?: string;
  providerEmailId?: string;
};

/**
 * PR recording-ready-notifications (PR #1): visibility-gate Trigger
 * task.
 *
 * Goal: notify the workspace owner (student) ONLY when the recording
 * is actually visible in their workspace Videos tab. The
 * `getSessionVisibilityForStudentOwner` query at
 * `convex/sessions.ts:1519` returns one of:
 *
 *   - `ok` — the recording surfaces in the student's
 *     `getCallRecordingsForWorkspace` query. Flip the
 *     `recordingReadyNotifications` row to `ready_to_send`
 *     (PR #2 will pick up from there to send the email).
 *   - `no_workspace` — the session cannot be resolved to a
 *     workspace (pre-backfill, deleted, ad-hoc without
 *     workspace link). Treat as permanent failure; this
 *     should not happen for routine post-migration sessions.
 *   - `not_owner` — the resolved workspace is owned by a
 *     different user. Re-check once per minute for up to
 *     `maxAttempts` (covers the rare race where the row
 *     was inserted before the workspace owner settled).
 *   - `no_recording_artifact` — the session has no recording
 *     URL or transfer status. This should not happen because
 *     `attachRecordingFromB2Upload` only fires after the
 *     B2 upload succeeded, but treat as terminal failure
 *     if it does (defence in depth).
 *   - `recording_not_ready` — the row has a non-`ready`
 *     status (`uploading`, `failed`, `purged`). Treat as
 *     terminal: re-checking won't change the status.
 *
 * PR #1 does NOT send the email. After the gate passes, the
 * row lands in `ready_to_send` and the task exits; PR #2
 * adds the email send between gate-pass and exit.
 *
 * PR #2 wires the email send between gate-pass and exit:
 *   1. Fetch recipient info (`POST /recording-ready/get-recipient-info`)
 *      to read the user's email + first name + the per-student
 *      `recordingReadyEmail` toggle (defaults to `true`).
 *   2. If the toggle is off, mark the row `sent` with a sentinel
 *      `providerEmailId: "opted_out"` and exit. The bell-row
 *      surface (PR #3) still notifies the student.
 *   3. If the toggle is on, build the email via
 *      `buildRecordingReadyEmail`, send through Resend, and mark
 *      the row `sent` with the Resend message id. On a Resend
 *      failure, mark the row `failed` with `deliveryError: resend:...`
 *      so the admin sweep can recover it.
 *
 * Idempotency: the caller (Convex action) sets an idempotency
 * key of `notify-recording-ready:{sessionId}:{recipientUserId}`.
 * Re-deliveries from the Convex action reuse the same Trigger
 * run id and don't double-process.
 */
export const notifyRecordingReady = task({
  id: "notify-recording-ready",
  retry: {
    maxAttempts: 10,
    factor: 1.5,
    minTimeoutInMs: 30_000,
    maxTimeoutInMs: 5 * 60_000,
    randomize: false,
  },
  run: async (
    payload: Payload,
    { ctx }
  ): Promise<{
    sessionId: string;
    recipientUserId: string;
    outcome: "sent" | "opted_out" | "no_email" | "ready_to_send" | "failed";
    reason: string;
    providerEmailId?: string;
  }> => {
    logger.info("Recording-ready visibility gate started", {
      sessionId: payload.sessionId,
      recipientUserId: payload.recipientUserId,
      notificationId: payload.notificationId,
      attempt: ctx.attempt.number,
    });
    metadata.set("sessionId", payload.sessionId);
    metadata.set("recipientUserId", payload.recipientUserId);
    metadata.set("notificationId", payload.notificationId);
    metadata.set("attempt", ctx.attempt.number);

    const visibility = await convexQueryVisibility(payload);
    logger.info("Visibility gate result", {
      sessionId: payload.sessionId,
      reason: visibility.reason,
      visible: visibility.visible,
    });
    metadata.set("visibilityReason", visibility.reason);
    metadata.set("visible", visibility.visible);

    if (visibility.visible && visibility.workspaceId) {
      await convexCallback("mark-ready-to-send", {
        notificationId: payload.notificationId,
        workspaceId: visibility.workspaceId,
      });
      logger.info("Recording-ready notification ready to send", {
        sessionId: payload.sessionId,
        workspaceId: visibility.workspaceId,
      });
      metadata.set("outcome", "ready_to_send");

      // PR #2: between gate-pass and exit, run the email decision
      // tree. Mirrors `processRecordingRetentionWarningPage` at
      // `src/trigger/recording-retention-warnings.ts:90`.
      const recipient = await convexGetRecipientInfo(payload);
      const sendResult = await dispatchRecordingReadyEmail({
        recipient,
        notificationId: payload.notificationId,
        sessionId: payload.sessionId,
        workspaceId: visibility.workspaceId,
      });
      metadata.set("emailOutcome", sendResult.outcome);
      if (sendResult.outcome === "failed") {
        return {
          sessionId: payload.sessionId,
          recipientUserId: payload.recipientUserId,
          outcome: "failed",
          reason: `email-send:${sendResult.reason}`,
        };
      }
      return {
        sessionId: payload.sessionId,
        recipientUserId: payload.recipientUserId,
        outcome: sendResult.outcome,
        reason: visibility.reason,
        providerEmailId: sendResult.providerEmailId,
      };
    }

    if (isTerminalReason(visibility.reason)) {
      await convexCallback("mark-failed", {
        notificationId: payload.notificationId,
        deliveryError: `visibility-gate:${visibility.reason}`,
      });
      logger.warn("Recording-ready notification terminal failure", {
        sessionId: payload.sessionId,
        reason: visibility.reason,
      });
      metadata.set("outcome", "failed");
      metadata.set("failureReason", visibility.reason);
      return {
        sessionId: payload.sessionId,
        recipientUserId: payload.recipientUserId,
        outcome: "failed",
        reason: visibility.reason,
      };
    }

    if (ctx.attempt.number >= (ctx.run.maxAttempts ?? 1)) {
      await convexCallback("mark-failed", {
        notificationId: payload.notificationId,
        deliveryError: `visibility-gate-timeout:${visibility.reason}`,
      });
      logger.warn("Recording-ready notification timed out", {
        sessionId: payload.sessionId,
        reason: visibility.reason,
        attempts: ctx.attempt.number,
      });
      metadata.set("outcome", "failed");
      metadata.set("failureReason", `timeout:${visibility.reason}`);
      return {
        sessionId: payload.sessionId,
        recipientUserId: payload.recipientUserId,
        outcome: "failed",
        reason: `timeout:${visibility.reason}`,
      };
    }

    logger.info("Recording-ready visibility gate retrying", {
      sessionId: payload.sessionId,
      reason: visibility.reason,
      attempt: ctx.attempt.number,
    });
    await wait.for({ minutes: 1 });
    throw new Error(
      `Visibility not yet ready (reason=${visibility.reason}); retrying`
    );
  },
  catchError: async ({ error, ctx, payload }) => {
    logger.error("Recording-ready task failed", {
      sessionId: payload.sessionId,
      recipientUserId: payload.recipientUserId,
      attempt: ctx.attempt.number,
      maxAttempts: ctx.run.maxAttempts ?? 1,
      error: error instanceof Error ? error.message : String(error),
    });
    // Final-failure path: only mark `failed` when retries are
    // exhausted AND the task didn't already mark itself (the
    // happy-path code handles terminal reasons + timeout inline).
    if (ctx.attempt.number >= (ctx.run.maxAttempts ?? 1)) {
      try {
        await convexCallback("mark-failed", {
          notificationId: payload.notificationId,
          deliveryError: `task-error:${
            error instanceof Error ? error.message : String(error)
          }`,
        });
      } catch (callbackError) {
        logger.error(
          "Recording-ready mark-failed callback also failed",
          {
            sessionId: payload.sessionId,
            error:
              callbackError instanceof Error
                ? callbackError.message
                : String(callbackError),
          }
        );
      }
    }
  },
});

/**
 * Reasons for which re-checking the visibility gate will never
 * produce a different answer. Marking these terminal saves the
 * task from spending all 10 retries.
 *
 * Greptile R1 P1 (PR recording-ready-notifications): `no_workspace`
 * is intentionally NOT terminal. The `resolveSessionWorkspace`
 * resolver uses three paths (direct `workspaceId`, `sessionPackId`
 * seat lookup, pair-workspace lookup), and any of them can return
 * `null` transiently — e.g. during the brief window before
 * `backfillSessionWorkspaceLinks` runs, or if a pack's seat row
 * hasn't been written yet. We treat `no_workspace` as recoverable
 * for up to `maxAttempts` so a recording that becomes visible
 * later (after the migration settles) still produces its
 * notification. The row stays in `pending_visibility` during the
 * retry window; only the timeout / maxAttempts path flips it to
 * `failed`.
 *
 * `no_recording_artifact` and `recording_not_ready` remain
 * terminal: `attachRecordingFromB2Upload` patches the session in
 * the same transaction that schedules this task, so by the time
 * the visibility query runs the recording should be present and
 * `ready`. If those reasons fire, the B2 upload genuinely failed
 * (or the recording was purged by retention cleanup) and retrying
 * won't help.
 */
function isTerminalReason(
  reason: string
): reason is "no_recording_artifact" | "recording_not_ready" {
  return (
    reason === "no_recording_artifact" ||
    reason === "recording_not_ready"
  );
}

/**
 * Queries the visibility gate directly via the Convex HTTP layer
 * so we don't need a ConvexHttpClient + internal call here. Uses
 * the same auth model as the recording-transfer callbacks
 * (`convexCallback`).
 */
async function convexQueryVisibility(payload: Payload): Promise<{
  visible: boolean;
  workspaceId?: string;
  reason: string;
}> {
  if (!CONVEX_DEPLOYMENT_URL) {
    throw new Error("CONVEX_DEPLOYMENT_URL / NEXT_PUBLIC_CONVEX_URL not set");
  }
  if (!CONVEX_HTTP_KEY) {
    throw new Error("CONVEX_HTTP_KEY not set");
  }
  const response = await fetch(
    `${CONVEX_DEPLOYMENT_URL}/recording-ready/visibility`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${CONVEX_HTTP_KEY}`,
        "X-Trigger-Callback-Secret": CALLBACK_SECRET ?? "",
      },
      body: JSON.stringify({
        sessionId: payload.sessionId,
        recipientUserId: payload.recipientUserId,
      }),
    }
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Visibility query failed: ${response.status} ${text.slice(0, 200)}`
    );
  }
  return (await response.json()) as {
    visible: boolean;
    workspaceId?: string;
    reason: string;
  };
}

/**
 * Fire-and-forget HTTP POST to the Convex HTTP endpoint backing
 * the recording-ready task. Mirrors `convexCallback` in
 * `src/trigger/recording-transfer.ts:182`. Two-key auth:
 * `CONVEX_HTTP_KEY` + `X-Trigger-Callback-Secret`.
 */
async function convexCallback(
  pathSuffix:
    | "mark-ready-to-send"
    | "mark-sent"
    | "mark-failed"
    | "enqueue"
    | "visibility"
    | "get-recipient-info",
  body:
    | CallbackBody
    | { sessionId: string; recipientUserId: string }
    | { notificationId: string }
): Promise<unknown> {
  if (!CONVEX_DEPLOYMENT_URL) {
    throw new Error("CONVEX_DEPLOYMENT_URL / NEXT_PUBLIC_CONVEX_URL not set");
  }
  if (!CONVEX_HTTP_KEY) {
    throw new Error("CONVEX_HTTP_KEY not set");
  }
  if (!CALLBACK_SECRET) {
    throw new Error(
      "CONVEX_TRIGGER_CALLBACK_SECRET not set — refusing to callback without shared secret"
    );
  }
  const response = await fetch(
    `${CONVEX_DEPLOYMENT_URL}/recording-ready/${pathSuffix}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${CONVEX_HTTP_KEY}`,
        "X-Trigger-Callback-Secret": CALLBACK_SECRET,
      },
      body: JSON.stringify(body),
    }
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Convex callback /recording-ready/${pathSuffix} failed: ${response.status} ${text.slice(
        0,
        200
      )}`
    );
  }
  return response.json();
}

/**
 * PR #2: fetches the recipient's email + first name + the
 * per-student `recordingReadyEmail` toggle from Convex via the
 * `get-recipient-info` HTTP route. Returns `null` for missing
 * fields rather than throwing — the dispatch layer decides what
 * to do with each branch.
 */
async function convexGetRecipientInfo(payload: Payload): Promise<{
  email: string | null;
  firstName: string | null;
  instructorName: string;
  recordingReadyEmail: boolean;
  sessionId: string;
  workspaceId: string | null;
}> {
  const result = (await convexCallback("get-recipient-info", {
    notificationId: payload.notificationId,
  })) as {
    email: string | null;
    firstName: string | null;
    instructorName: string;
    recordingReadyEmail: boolean;
    sessionId: string;
    workspaceId: string | null;
  };
  return result;
}

/**
 * PR #2: runs the email decision tree after the visibility gate
 * has flipped the row to `ready_to_send`. Returns the outcome so
 * the caller can log it + decide whether to re-throw.
 *
 * Decision tree:
 *   1. `recordingReadyEmail === false` → mark `sent` with the
 *      sentinel `providerEmailId: "opted_out"`. The bell surface
 *      (PR #3) still notifies the student.
 *   2. `email` is null (user record missing) → mark `sent` with
 *      `providerEmailId: "no_email"`. Rare; the user has no
 *      `users` row yet. The bell surface still notifies.
 *   3. Send through Resend → mark `sent` with the Resend message
 *      id. Idempotency key prevents re-send on Trigger retry.
 *   4. Resend returns a hard error → mark `failed` with
 *      `deliveryError: resend:{error}`. The admin sweep
 *      (HUC-22) re-processes these.
 *   5. Resend returns `skipped: true` (provider not configured in
 *      dev) → mark `sent` with `providerEmailId: "dev_skipped"`
 *      and exit cleanly. No retry needed.
 */
async function dispatchRecordingReadyEmail(args: {
  recipient: {
    email: string | null;
    firstName: string | null;
    instructorName: string;
    recordingReadyEmail: boolean;
    sessionId: string;
    workspaceId: string | null;
  };
  notificationId: string;
  sessionId: string;
  workspaceId: string;
}): Promise<
  | { outcome: "sent"; reason: string; providerEmailId: string }
  | { outcome: "opted_out"; reason: string; providerEmailId: string }
  | { outcome: "no_email"; reason: string; providerEmailId: string }
  | { outcome: "dev_skipped"; reason: string; providerEmailId: string }
  | { outcome: "failed"; reason: string }
> {
  if (!args.recipient.recordingReadyEmail) {
    logger.info("Recording-ready email opted out via preference", {
      sessionId: args.sessionId,
      notificationId: args.notificationId,
    });
    await convexCallback("mark-sent", {
      notificationId: args.notificationId,
      providerEmailId: "opted_out",
    });
    return {
      outcome: "opted_out",
      reason: "preference-disabled",
      providerEmailId: "opted_out",
    };
  }

  if (!args.recipient.email) {
    logger.warn("Recording-ready recipient has no email; marking sent with sentinel", {
      sessionId: args.sessionId,
      notificationId: args.notificationId,
    });
    await convexCallback("mark-sent", {
      notificationId: args.notificationId,
      providerEmailId: "no_email",
    });
    return {
      outcome: "no_email",
      reason: "missing-user-email",
      providerEmailId: "no_email",
    };
  }

  if (!args.recipient.workspaceId) {
    // Should be unreachable: visibility-gate-pass requires a
    // workspaceId, and we propagate it through to here. Guard
    // anyway to avoid an unsafe deep-link.
    logger.warn("Recording-ready recipient info missing workspaceId", {
      sessionId: args.sessionId,
      notificationId: args.notificationId,
    });
    await convexCallback("mark-failed", {
      notificationId: args.notificationId,
      deliveryError: "resend:missing-workspace-id",
    });
    return { outcome: "failed", reason: "missing-workspace-id" };
  }

  const email = buildRecordingReadyEmail({
    studentEmail: args.recipient.email,
    studentName: args.recipient.firstName,
    instructorName: args.recipient.instructorName,
    workspaceId: args.workspaceId,
    sessionId: args.sessionId,
  });

  const sendResult = await sendEmail({
    to: args.recipient.email,
    subject: email.subject,
    text: email.text,
    html: email.html,
    headers: email.headers,
    kind: "transactional",
    idempotencyKey: `recording-ready:${args.sessionId}:${args.notificationId}`,
  });

  if (sendResult.ok) {
    const providerEmailId = sendResult.id ?? "resend_no_id";
    logger.info("Recording-ready email sent", {
      sessionId: args.sessionId,
      notificationId: args.notificationId,
      providerEmailId,
    });
    await convexCallback("mark-sent", {
      notificationId: args.notificationId,
      providerEmailId,
    });
    return { outcome: "sent", reason: "resend-ok", providerEmailId };
  }

  if ("skipped" in sendResult && sendResult.skipped) {
    logger.warn(
      "Recording-ready email skipped (provider not configured in dev)",
      {
        sessionId: args.sessionId,
        notificationId: args.notificationId,
        reason: sendResult.reason,
      }
    );
    await convexCallback("mark-sent", {
      notificationId: args.notificationId,
      providerEmailId: "dev_skipped",
    });
    return {
      outcome: "dev_skipped",
      reason: sendResult.reason,
      providerEmailId: "dev_skipped",
    };
  }

  const errorMessage =
    "error" in sendResult ? sendResult.error : "unknown Resend error";
  logger.error("Recording-ready email send failed", {
    sessionId: args.sessionId,
    notificationId: args.notificationId,
    error: errorMessage,
  });
  await convexCallback("mark-failed", {
    notificationId: args.notificationId,
    deliveryError: `resend:${errorMessage}`.slice(0, 500),
  });
  return { outcome: "failed", reason: errorMessage };
}
