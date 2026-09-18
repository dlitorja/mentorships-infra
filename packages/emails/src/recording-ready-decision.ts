import type { SendEmailResult } from "./send";

/**
 * Recipient info returned by the
 * `internal.recordingReadyNotifications.getRecipientInfoForNotification`
 * Convex query — the live record behind a
 * `recordingReadyNotifications` row.
 */
export type RecipientInfo = {
  email: string | null;
  firstName: string | null;
  instructorName: string;
  recordingReadyEmail: boolean;
  sessionId: string;
  workspaceId: string | null;
};

/**
 * The Convex side-effect the Trigger task must apply after the
 * decision is made. `dispatchRecordingReadyEmail` translates
 * this into a `POST /recording-ready/mark-sent` or
 * `POST /recording-ready/mark-failed` callback.
 */
export type RecordingReadySideEffect =
  | { kind: "mark-sent"; providerEmailId: string }
  | { kind: "mark-failed"; deliveryError: string };

/**
 * Outcome of the email decision tree. Mirrors the 5 branches
 * the Trigger task can land on after the PR #1 visibility gate
 * flips the row to `ready_to_send`.
 */
export type RecordingReadyEmailDecision = {
  outcome: "opted_out" | "no_email" | "dev_skipped" | "sent" | "failed";
  reason: string;
  providerEmailId: string;
  sideEffect: RecordingReadySideEffect;
};

/**
 * Pure function: decides what the Trigger task should do next
 * with a recording-ready email. Has no I/O — given the
 * recipient + an optional Resend result, returns the outcome
 * label + the side-effect the caller must apply.
 *
 * Decision tree (mirrors `dispatchRecordingReadyEmail` in
 * `src/trigger/notify-recording-ready.ts`):
 *
 *   1. `recordingReadyEmail === false` → `opted_out`. Bell
 *      surface (PR #3) still notifies. Row → `sent` with
 *      sentinel `providerEmailId: "opted_out"`.
 *   2. `email === null` → `no_email`. Rare; the user has no
 *      `users` row. Bell surface still notifies. Row → `sent`
 *      with sentinel `providerEmailId: "no_email"`.
 *   3. `workspaceId === null` → `failed` with
 *      `deliveryError: "resend:missing-workspace-id"`. Should
 *      be unreachable because the visibility-gate-pass
 *      requires a workspaceId, but guards against an unsafe
 *      deep-link.
 *   4. `sendResult.ok === true` → `sent` with the Resend
 *      message id (or `"resend_no_id"` if missing — should be
 *      unreachable in practice).
 *   5. `sendResult.skipped === true` → `dev_skipped`. Provider
 *      not configured in dev. Row → `sent` with sentinel.
 *   6. `sendResult.error` → `failed` with
 *      `deliveryError: "resend:{error}"` (capped at 500 chars).
 */
export function decideRecordingReadyEmailOutcome(args: {
  recipient: RecipientInfo;
  sendResult?: SendEmailResult;
}): RecordingReadyEmailDecision {
  if (!args.recipient.recordingReadyEmail) {
    return {
      outcome: "opted_out",
      reason: "preference-disabled",
      providerEmailId: "opted_out",
      sideEffect: { kind: "mark-sent", providerEmailId: "opted_out" },
    };
  }

  if (!args.recipient.email) {
    return {
      outcome: "no_email",
      reason: "missing-user-email",
      providerEmailId: "no_email",
      sideEffect: { kind: "mark-sent", providerEmailId: "no_email" },
    };
  }

  if (!args.recipient.workspaceId) {
    return {
      outcome: "failed",
      reason: "missing-workspace-id",
      providerEmailId: "",
      sideEffect: {
        kind: "mark-failed",
        deliveryError: "resend:missing-workspace-id",
      },
    };
  }

  const sendResult = args.sendResult;
  if (!sendResult) {
    // Caller forgot to invoke sendEmail after the preference +
    // email + workspaceId guards passed. Treat as a hard error
    // so the admin sweep (HUC-22) catches the misconfigured
    // dispatcher rather than silently marking the row `sent`.
    return {
      outcome: "failed",
      reason: "missing-send-result",
      providerEmailId: "",
      sideEffect: {
        kind: "mark-failed",
        deliveryError: "resend:missing-send-result",
      },
    };
  }

  if (sendResult.ok) {
    const providerEmailId = sendResult.id ?? "resend_no_id";
    return {
      outcome: "sent",
      reason: "resend-ok",
      providerEmailId,
      sideEffect: { kind: "mark-sent", providerEmailId },
    };
  }

  if ("skipped" in sendResult && sendResult.skipped) {
    return {
      outcome: "dev_skipped",
      reason: sendResult.reason,
      providerEmailId: "dev_skipped",
      sideEffect: { kind: "mark-sent", providerEmailId: "dev_skipped" },
    };
  }

  const errorMessage =
    "error" in sendResult ? sendResult.error : "unknown Resend error";
  const deliveryError = `resend:${errorMessage}`.slice(0, 500);
  return {
    outcome: "failed",
    reason: errorMessage,
    providerEmailId: "",
    sideEffect: { kind: "mark-failed", deliveryError },
  };
}

/**
 * Maximum length of the `deliveryError` string written to the
 * `recordingReadyNotifications` row. Mirrors the cap in
 * `dispatchRecordingReadyEmail` before this refactor; kept here
 * so the side-effect payload is ready to serialize without
 * trimming at the call site.
 */
export const RECORDING_READY_DELIVERY_ERROR_MAX_LEN = 500;
