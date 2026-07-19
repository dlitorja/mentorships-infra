import { logger, schedules } from "@trigger.dev/sdk";
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

type UserEmailResponse = { email: string | null };

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
 *   1. GET `/recording-retention/for-notification` → array of
 *      sessions approaching their `recordingExpiresAt` within
 *      the warning windows, with their resolved recipients.
 *      The HTTP query is bounded at 500 rows; we re-fetch
 *      until empty (drain pattern, MAX_ITERATIONS=20).
 *   2. For each (window, recipient): POST `/recording-retention/notify`
 *      FIRST to dedupe-write the `recordingRetentionNotifications`
 *      row. If the mutation returns `{ skipped: true }`, we
 *      skip the email (a row already exists for this
 *      (session, recipient, threshold) tuple from a prior run).
 *   3. POST `/users/email` to resolve Clerk user → email.
 *   4. Send the Resend email with a Download CTA.
 *
 * Order is intentional (Greptile P1): notify BEFORE email so a
 * transient email failure on retry doesn't double-send.
 *
 * Dedupe: the Convex `createRecordingRetentionNotification`
 * mutation is idempotent on
 * (sessionId, recipientUserId, daysUntilDeletion).
 */
async function sendRecordingDeletionWarningEmail(
  to: string,
  daysUntilDeletion: number,
  workspaceName: string,
  sessionId: string
): Promise<void> {
  const downloadUrl =
    `${process.env.NEXT_PUBLIC_URL || "https://mentorships.example.com"}/workspace`;
  await resend.emails.send({
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
  });
}

export const sendRecordingRetentionWarnings = schedules.task({
  id: "send-recording-retention-warnings",
  cron: "0 10 * * *",
  maxDuration: 600,
  run: async (payload) => {
    logger.info("Starting call-recording retention warnings job", {
      timestamp: payload.timestamp,
    });

    // Greptile P2 (cleanup mirror): drain the queue. The HTTP
    // query is bounded at 500 rows; if the warnings backlog
    // exceeds that we re-fetch until empty (or hit the safety
    // cap below).
    const MAX_ITERATIONS = 20;
    const results = {
      windows: 0,
      emailsSent: 0,
      emailsFailed: 0,
      skippedNoEmail: 0,
    };

    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
      const page = (await callConvex(
        "/recording-retention/for-notification"
      )) as { notifications: NotificationWindow[] };

      const items = page.notifications ?? [];
      if (items.length === 0) {
        logger.info(
          `Drain complete after ${iteration} iteration(s) — no more notification windows`,
          { emailsSent: results.emailsSent, emailsFailed: results.emailsFailed }
        );
        break;
      }

      results.windows += items.length;
      logger.info(
        `Iteration ${iteration}: processing ${items.length} recording windows`
      );

      for (const window of items) {
        for (const recipient of window.recipients) {
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

            // Greptile P1: call /recording-retention/notify FIRST
            // so the dedupe row is written before the email goes
            // out. If the email succeeds and notify fails on the
            // next call, the mutation's `skipped: true` return
            // tells us a row already exists for this
            // (session, recipient, threshold) and we skip the
            // email entirely. This is the inverse of the
            // previous order (email → notify) which could
            // double-send if the notify request failed transiently.
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

            if (dedupeResult.skipped) {
              logger.info(
                `Skipped email — dedupe row already exists for ${recipient.userId} @ ${window.daysUntilDeletion} days`,
                {
                  sessionId: window.sessionId,
                  recipientUserId: recipient.userId,
                  notificationId: dedupeResult.id,
                }
              );
              continue;
            }

            await sendRecordingDeletionWarningEmail(
              userResponse.email,
              window.daysUntilDeletion,
              "Mentorship Workspace",
              window.sessionId
            );

            results.emailsSent++;
            logger.info(
              `Sent recording retention warning to ${userResponse.email} (${window.daysUntilDeletion} days)`,
              {
                sessionId: window.sessionId,
                recipientUserId: recipient.userId,
              }
            );
          } catch (error) {
            results.emailsFailed++;
            const message =
              error instanceof Error ? error.message : String(error);
            logger.error("Failed to send recording retention warning", {
              sessionId: window.sessionId,
              recipientUserId: recipient.userId,
              error: message,
            });
          }
        }
      }
    }

    logger.info("Recording retention warnings job completed", results);
    return results;
  },
});
