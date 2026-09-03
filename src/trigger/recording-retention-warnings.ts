import { logger, schedules, task, tasks } from "@trigger.dev/sdk";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);
const EMAIL_FROM =
  process.env.EMAIL_FROM || "noreply@mentorships.example.com";
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
 * R12: send Resend emails at the 30/7/1-day windows before
 * a call recording is permanently deleted. Mirrors the
 * workspace retention warnings job
 * (`src/trigger/workspace-retention.ts:101`) — same cron
 * time, same dedupe pattern via the Convex
 * `createRecordingRetentionNotification` mutation.
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
async function sendRecordingDeletionWarningEmail(
  to: string,
  daysUntilDeletion: number,
  workspaceName: string,
  sessionId: string,
  idempotencyKey: string
): Promise<string> {
  const downloadUrl =
    `${process.env.NEXT_PUBLIC_URL || "https://mentorships.example.com"}/workspace`;
  const { data, error } = await resend.emails.send(
    {
      from: EMAIL_FROM,
      to,
      subject: `Call recording will be deleted in ${daysUntilDeletion} day${
        daysUntilDeletion === 1 ? "" : "s"
      }`,
      html: `
      <h1>Call Recording Deletion Warning</h1>
      <p>Hello,</p>
      <p>Your call recording in workspace "<strong>${workspaceName}</strong>" will be permanently deleted in <strong>${daysUntilDeletion} day${
        daysUntilDeletion === 1 ? "" : "s"
      }</strong>.</p>
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
  run: async (payload: WarningPagePayload) => {
    const query = new URLSearchParams({ now: String(payload.scanStartedAt) });
    if (payload.cursor) query.set("cursor", payload.cursor);
    const page = (await callConvex(
      `/recording-retention/for-notification?${query.toString()}`
    )) as NotificationPage;
    const items = page.notifications ?? [];
    const results = {
      pageNumber: payload.pageNumber,
      windows: items.length,
      emailsSent: 0,
      emailsFailed: 0,
      // Greptile R5 P2: track failures that cannot be recovered by the
      // next daily scan. A `daysUntilDeletion === 1` failure is fatal
      // because the cleanup task may purge the recording before the
      // following morning's cron can re-issue the warning — we re-throw
      // at the end of the page so Trigger.dev retries the whole page and
      // `createRecordingRetentionNotification` dedupes already-sent rows.
      urgentFailures: 0,
      skippedNoEmail: 0,
      nextPageQueued: false,
    };

    logger.info("Processing recording warning page", {
      pageNumber: payload.pageNumber,
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
              }),
            }
          )) as { skipped: boolean; id: string };

          if (dedupeResult.skipped) continue;
          notificationId = dedupeResult.id;
          const providerEmailId = await sendRecordingDeletionWarningEmail(
            userResponse.email,
            window.daysUntilDeletion,
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
          if (window.daysUntilDeletion === 1) {
            results.urgentFailures += 1;
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
            error: message,
          });
        }
      }
    }

    // Greptile R5 P2: re-throw when a 1-day warning failed so the
    // Trigger.dev retry budget kicks in. Already-sent recipients are
    // deduped by `createRecordingRetentionNotification` (the existing
    // `sent` row returns `skipped: true`), so a retry only re-attempts
    // the failed ones. 30/7-day failures are logged but not rethrown —
    // the next daily cron has 6+ days of headroom to retry.
    if (results.urgentFailures > 0) {
      logger.error("One-day recording warning failed; retrying page", {
        pageNumber: payload.pageNumber,
        urgentFailures: results.urgentFailures,
      });
      throw new Error(
        `${results.urgentFailures} one-day recording warning(s) failed on page ${payload.pageNumber}`
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
