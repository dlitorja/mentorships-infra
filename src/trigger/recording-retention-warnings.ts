import { logger, schedules, task, tasks } from "@trigger.dev/sdk";
import { Resend } from "resend";
import { resolveFrom } from "../../packages/emails/src/envelope";

const resend = new Resend(process.env.RESEND_API_KEY);
const CONVEX_DEPLOYMENT_URL =
  process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_DEPLOYMENT_URL;
const CONVEX_HTTP_KEY = process.env.CONVEX_HTTP_KEY;

type NotificationRecipient = {
  userId: string;
  role: "instructor" | "student";
};

type NotificationWindow = {
  sessionId: string;
  workspaceId: string;
  recordingExpiresAt: number;
  daysUntilDeletion: number;
  recipients: NotificationRecipient[];
};

type NotificationPage = {
  notifications: NotificationWindow[];
  continueCursor: string;
  isDone: boolean;
};

type UserEmailResponse = { email: string | null };

type WarningPagePayload = {
  cursor: string | null;
  scanStartedAt: number;
  pageNumber: number;
};

async function callConvex(
  path: string,
  init: RequestInit = {}
): Promise<unknown> {
  if (!CONVEX_DEPLOYMENT_URL || !CONVEX_HTTP_KEY) {
    throw new Error("Convex deployment URL or HTTP key not configured");
  }
  const response = await fetch(`${CONVEX_DEPLOYMENT_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${CONVEX_HTTP_KEY}`,
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Convex ${path} failed: ${response.status} ${text.slice(0, 200)}`);
  }
  return response.json();
}

/**
 * R12: send a single Resend email at the 7-day window before
 * a call recording is permanently deleted. Mirrors the
 * workspace retention warnings job
 * (`src/trigger/workspace-retention.ts:101`) — same cron
 * time, same dedupe pattern via the Convex
 * `createRecordingRetentionNotification` mutation. The same
 * notification row also powers the in-app banner, so recipients
 * get the banner as a second surface without a second email.
 *
 * Schedule: `0 10 * * *` UTC.
 *
 * Pipeline:
 *   1. The schedule queues one durable task carrying the first-page cursor.
 *   2. GET `/recording-retention/for-notification` → array of
 *      sessions approaching their `recordingExpiresAt` within
 *      the warning windows, with their resolved recipients.
 *      The HTTP query is cursor-paginated so every due recording
 *      can be visited without an unbounded Convex read.
 *   3. For each (window, recipient): POST `/recording-retention/notify`
 *      FIRST to dedupe-write the `recordingRetentionNotifications`
 *      row. If the mutation returns `{ skipped: true }`, we
 *      skip the email (a row already exists for this
 *      (session, recipient, threshold) tuple from a prior run).
 *   4. Send through Resend with a provider idempotency key.
 *   5. Finalize the Convex row as sent or failed. Failed rows are
 *      eligible for a later retry instead of being silently suppressed.
 *   6. Queue the next cursor page with a deterministic task idempotency key.
 *
 * Dedupe: the Convex `createRecordingRetentionNotification`
 * mutation is idempotent on
 * (sessionId, recipientUserId, daysUntilDeletion).
 */

/**
 * Format a "deleted in N days/hours" string from the actual
 * `recordingExpiresAt` at send time, NOT from the static
 * `daysUntilDeletion` dedup key. Greptile R5 P1: a session
 * matched on the 7-day threshold but expiring in 12 hours must
 * not be emailed as "deleted in 7 days".
 */
function formatTimeUntilDeletion(recordingExpiresAt: number, now: number): string {
  const remainingMs = recordingExpiresAt - now;
  if (remainingMs <= 0) return "imminently";
  const hourMs = 60 * 60 * 1000;
  const dayMs = 24 * hourMs;
  if (remainingMs < dayMs) {
    const hours = Math.max(1, Math.ceil(remainingMs / hourMs));
    return `in ${hours} hour${hours === 1 ? "" : "s"}`;
  }
  const days = Math.ceil(remainingMs / dayMs);
  return `in ${days} day${days === 1 ? "" : "s"}`;
}

async function sendRecordingDeletionWarningEmail(
  to: string,
  recordingExpiresAt: number,
  workspaceName: string,
  sessionId: string,
  idempotencyKey: string
): Promise<string> {
  const downloadUrl =
    `${process.env.NEXT_PUBLIC_URL || "https://mentorships.example.com"}/workspace`;
  const from = resolveFrom("transactional") || "noreply@mentorships.example.com";
  const now = Date.now();
  const timeUntilDeletion = formatTimeUntilDeletion(recordingExpiresAt, now);
  const { data, error } = await resend.emails.send(
    {
      from,
      to,
      subject: `Call recording will be deleted ${timeUntilDeletion}`,
      headers: { "X-Email-Kind": "transactional" },
      html: `
      <h1>Call Recording Deletion Warning</h1>
      <p>Hello,</p>
      <p>Your call recording in workspace "<strong>${workspaceName}</strong>" will be permanently deleted <strong>${timeUntilDeletion}</strong> (on ${new Date(recordingExpiresAt).toUTCString()}).</p>
      <p>After this date, the recording will no longer be available. Please download it now if you want to keep a copy.</p>
      <p><a href="${downloadUrl}" style="background: #0070f3; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">Open workspace</a></p>
      <p>Reference: ${sessionId}</p>
      <p>If you have any questions, please contact your instructor.</p>
      <p>Best regards,<br/>The Mentorships Team</p>
    `,
    },
    { idempotencyKey }
  );
  if (error) {
    throw new Error(`Resend rejected recording warning: ${error.message}`);
  }
  if (!data?.id) {
    throw new Error("Resend returned no email id for recording warning");
  }
  return data.id;
}

export const processRecordingRetentionWarningPage = task({
  id: "send-recording-retention-warning-page",
  maxDuration: 600,
  retry: {
    maxAttempts: 5,
    factor: 2,
    minTimeoutInMs: 5_000,
    maxTimeoutInMs: 60_000,
    randomize: true,
  },
  run: async (payload: WarningPagePayload, { ctx }) => {
    const query = new URLSearchParams({ now: String(payload.scanStartedAt) });
    if (payload.cursor) query.set("cursor", payload.cursor);
    const page = (await callConvex(
      `/recording-retention/for-notification?${query.toString()}`
    )) as NotificationPage;
    const items = page.notifications ?? [];
    // Greptile R5 P3: when this is a Trigger.dev retry, force the
    // dedupe to re-claim rows that may still be in `pending` state.
    // The previous attempt may have left them `pending` because the
    // failed-status finalize call also failed (Convex outage / network
    // blip); without the override the staleness check would skip the
    // re-claim for up to an hour, by which time the daily cleanup may
    // have purged the recording.
    const forceRetry = ctx.attempt.number > 1;
    const results = {
      pageNumber: payload.pageNumber,
      attempt: ctx.attempt.number,
      windows: items.length,
      emailsSent: 0,
      emailsFailed: 0,
      skippedNoEmail: 0,
      nextPageQueued: false,
      // Greptile R5 P1: tracks failed sends whose recording expires
      // before the next daily scan can re-claim them. When this is
      // non-empty we rethrow to trigger Trigger.dev task retry —
      // otherwise the recipient gets one failed attempt and then
      // nothing until after the cleanup cron has already deleted
      // the recording.
      urgentFailures: [] as Array<{
        sessionId: string;
        recipientUserId: string;
        recordingExpiresAt: number;
      }>,
    };

    // Daily scan interval: `cron: "0 10 * * *"` UTC, so the next scan
    // runs ~24h after this one. A session that expires within this
    // window can't wait for the next scan; if its send failed we
    // MUST retry this task.
    const NEXT_SCAN_AT_MS = 24 * 60 * 60 * 1000;
    const nextScanAt = payload.scanStartedAt + NEXT_SCAN_AT_MS;

    logger.info("Processing recording warning page", {
      pageNumber: payload.pageNumber,
      attempt: ctx.attempt.number,
      windows: items.length,
    });

    // Queue the next cursor page FIRST so a permanent failure on this page
    // (e.g. retries exhausted by a misbehaving recipient) cannot strand later
    // recipients on the floor. The deterministic idempotency key guarantees
    // exactly one downstream task per (scan, pageNumber+1) pair, so a retry
    // of this page after success is a no-op for the queue. Per-recipient
    // dedupe via `createRecordingRetentionNotification` makes any overlap
    // safe.
    if (
      !page.isDone &&
      page.continueCursor &&
      page.continueCursor !== payload.cursor
    ) {
      await tasks.trigger(
        "send-recording-retention-warning-page",
        {
          cursor: page.continueCursor,
          scanStartedAt: payload.scanStartedAt,
          pageNumber: payload.pageNumber + 1,
        } satisfies WarningPagePayload,
        {
          idempotencyKey: `recording-warning-page:${payload.scanStartedAt}:${payload.pageNumber + 1}`,
        }
      );
      results.nextPageQueued = true;
    } else if (
      !page.isDone &&
      (!page.continueCursor || page.continueCursor === payload.cursor)
    ) {
      throw new Error("Recording warning pagination cursor did not advance");
    }

    for (const window of items) {
      for (const recipient of window.recipients) {
        let notificationId: string | null = null;
        try {
          const userResponse = (await callConvex("/users/email", {
            method: "POST",
            body: JSON.stringify({ clerkId: recipient.userId }),
          })) as UserEmailResponse;

          if (!userResponse.email) {
            results.skippedNoEmail++;
            logger.warn(`No email found for user ${recipient.userId}`, {
              sessionId: window.sessionId,
            });
            continue;
          }

          const dedupeResult = (await callConvex(
            "/recording-retention/notify",
            {
              method: "POST",
              body: JSON.stringify({
                sessionId: window.sessionId,
                workspaceId: window.workspaceId,
                recipientUserId: recipient.userId,
                recipientRole: recipient.role,
                notificationType: "expiry_warning",
                recordingExpiresAt: window.recordingExpiresAt,
                daysUntilDeletion: window.daysUntilDeletion,
                forceRetry,
              }),
            }
          )) as { skipped: boolean; id: string };

          if (dedupeResult.skipped) continue;
          notificationId = dedupeResult.id;
          const providerEmailId = await sendRecordingDeletionWarningEmail(
            userResponse.email,
            window.recordingExpiresAt,
            "Mentorship Workspace",
            window.sessionId,
            `recording-retention/${window.sessionId}/${recipient.userId}/${window.daysUntilDeletion}`
          );
          await callConvex("/recording-retention/notify/finalize", {
            method: "POST",
            body: JSON.stringify({
              id: notificationId,
              status: "sent",
              providerEmailId,
            }),
          });
          results.emailsSent++;
        } catch (error) {
          results.emailsFailed++;
          const message =
            error instanceof Error ? error.message : String(error);
          // Greptile R5 P1: if this session expires before the next
          // daily scan can re-claim it, the failed send cannot be
          // recovered by simply leaving the row as `failed` — we
          // must rethrow so Trigger.dev retries the whole task with
          // `forceRetry = true`. Without this, a single transient
          // Resend blip on a same-day expiring recording would leave
          // the recipient without a working warning.
          if (window.recordingExpiresAt < nextScanAt) {
            results.urgentFailures.push({
              sessionId: window.sessionId,
              recipientUserId: recipient.userId,
              recordingExpiresAt: window.recordingExpiresAt,
            });
          }
          if (notificationId) {
            try {
              await callConvex("/recording-retention/notify/finalize", {
                method: "POST",
                body: JSON.stringify({
                  id: notificationId,
                  status: "failed",
                  errorMessage: message.slice(0, 500),
                }),
              });
            } catch (finalizeError) {
              logger.error("Failed to persist recording warning failure", {
                notificationId,
                error:
                  finalizeError instanceof Error
                    ? finalizeError.message
                    : String(finalizeError),
              });
            }
          }
          logger.error("Failed to send recording retention warning", {
            sessionId: window.sessionId,
            recipientUserId: recipient.userId,
            daysUntilDeletion: window.daysUntilDeletion,
            attempt: ctx.attempt.number,
            error: message,
          });
        }
      }
    }

    // Sends outside the next-scan window can self-heal: the row
    // stays `failed` and the next daily scan re-claims it via
    // `createRecordingRetentionNotification`. Sends inside that
    // window can't, so we rethrow to trigger Trigger.dev task
    // retry — `ctx.attempt.number > 1` makes `forceRetry = true`
    // and the dedupe allows re-claim of `failed` rows.
    if (results.urgentFailures.length > 0) {
      throw new Error(
        `Recording warning has ${results.urgentFailures.length} urgent failure(s) — rethrowing to trigger task retry before next daily scan`
      );
    }
    logger.info("Recording warning page completed", results);
    return results;
  },
});

export const sendRecordingRetentionWarnings = schedules.task({
  id: "send-recording-retention-warnings",
  cron: "0 10 * * *",
  maxDuration: 60,
  run: async (payload) => {
    const scanStartedAt = payload.timestamp.getTime();
    const handle = await tasks.trigger(
      "send-recording-retention-warning-page",
      { cursor: null, scanStartedAt, pageNumber: 0 } satisfies WarningPagePayload,
      { idempotencyKey: `recording-warning-page:${scanStartedAt}:0` }
    );
    logger.info("Queued recording retention warning scan", {
      scanStartedAt,
      runId: handle.id,
    });
    return { runId: handle.id, scanStartedAt };
  },
});
