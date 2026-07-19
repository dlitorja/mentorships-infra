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
 *   2. For each (window, recipient): POST `/users/email` to
 *      resolve the Clerk user → email address.
 *   3. Send a Resend email with a Download CTA.
 *   4. POST `/recording-retention/notify` to dedupe-write a
 *      `recordingRetentionNotifications` row, which is what
 *      the in-app banner reads from.
 *
 * Dedupe: the Convex `createRecordingRetentionNotification`
 * mutation is idempotent on
 * (sessionId, recipientUserId, daysUntilDeletion), so a
 * second daily tick that finds the same window+recipient is
 * a no-op.
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

    const windows = (await callConvex(
      "/recording-retention/for-notification"
    )) as { notifications: NotificationWindow[] };

    const items = windows.notifications ?? [];
    logger.info(`Found ${items.length} recording windows needing notification`);

    const results = {
      windows: items.length,
      emailsSent: 0,
      emailsFailed: 0,
      skippedNoEmail: 0,
    };

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

          await sendRecordingDeletionWarningEmail(
            userResponse.email,
            window.daysUntilDeletion,
            "Mentorship Workspace",
            window.sessionId
          );

          await callConvex("/recording-retention/notify", {
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
          });

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
          const message = error instanceof Error ? error.message : String(error);
          logger.error("Failed to send recording retention warning", {
            sessionId: window.sessionId,
            recipientUserId: recipient.userId,
            error: message,
          });
        }
      }
    }

    logger.info("Recording retention warnings job completed", results);
    return results;
  },
});
