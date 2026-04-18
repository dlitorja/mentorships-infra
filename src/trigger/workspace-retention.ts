import { logger, schedules } from "@trigger.dev/sdk";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);
const EMAIL_FROM = process.env.EMAIL_FROM || "noreply@mentorships.example.com";
const CONVEX_DEPLOYMENT_URL = process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_DEPLOYMENT_URL;
const CONVEX_HTTP_KEY = process.env.CONVEX_HTTP_KEY;

async function callConvexHttp(path: string, body: Record<string, unknown>): Promise<unknown> {
  if (!CONVEX_DEPLOYMENT_URL || !CONVEX_HTTP_KEY) {
    throw new Error("Convex deployment URL or HTTP key not configured");
  }

  const response = await fetch(`${CONVEX_DEPLOYMENT_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${CONVEX_HTTP_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Convex HTTP call failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

async function sendRetentionWarningEmail(
  to: string,
  daysUntilDeletion: number,
  workspaceName: string
): Promise<void> {
  await resend.emails.send({
    from: EMAIL_FROM,
    to,
    subject: `Your workspace content will be deleted in ${daysUntilDeletion} days`,
    html: `
      <h1>Workspace Content Deletion Warning</h1>
      <p>Hello,</p>
      <p>Your mentorship workspace "<strong>${workspaceName}</strong>" content will be permanently deleted in <strong>${daysUntilDeletion} days</strong>.</p>
      <p>After this date, all notes, links, images, and messages will be deleted. Please download any content you want to keep before then.</p>
      <p><a href="${process.env.NEXT_PUBLIC_URL || "https://mentorships.example.com"}/workspace" style="background: #0070f3; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">Download All Content</a></p>
      <p>If you have any questions, please contact your instructor.</p>
      <p>Best regards,<br/>The Mentorships Team</p>
    `,
  });
}

export const deleteExpiredWorkspaceContent = schedules.task({
  id: "delete-expired-workspace-content",
  cron: "0 4 * * *",
  maxDuration: 1800,
  run: async (payload) => {
    logger.info("Starting workspace content deletion job", { timestamp: payload.timestamp });

    if (!CONVEX_DEPLOYMENT_URL || !CONVEX_HTTP_KEY) {
      throw new Error("Convex not configured");
    }

    const response = await fetch(
      `${CONVEX_DEPLOYMENT_URL}/workspace/retention/needing-deletion`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${CONVEX_HTTP_KEY}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch workspaces: ${response.status}`);
    }

    const result = await response.json() as { workspaces: Array<{ id: string }> };
    const workspaces = result.workspaces || [];
    logger.info(`Found ${workspaces.length} workspaces to delete`);

    const results = { deleted: 0, failed: 0 };

    for (const workspace of workspaces) {
      try {
        await callConvexHttp("/workspace/retention/delete", {
          workspaceId: workspace.id,
        });
        results.deleted++;
        logger.info(`Deleted content for workspace ${workspace.id}`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(`Failed to delete workspace ${workspace.id}: ${errorMessage}`);
        results.failed++;
      }
    }

    logger.info("Workspace deletion job completed", { results });
    return results;
  },
});

export const sendWorkspaceRetentionWarnings = schedules.task({
  id: "send-workspace-retention-warnings",
  cron: "0 10 * * *",
  maxDuration: 600,
  run: async (payload) => {
    logger.info("Starting workspace retention warnings job", { timestamp: payload.timestamp });

    if (!CONVEX_DEPLOYMENT_URL || !CONVEX_HTTP_KEY) {
      throw new Error("Convex not configured");
    }

    const response = await fetch(
      `${CONVEX_DEPLOYMENT_URL}/workspace/retention/for-notification`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${CONVEX_HTTP_KEY}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch workspaces for notification: ${response.status}`);
    }

    const result = await response.json() as { notifications: Array<{ workspaceId: string; userId: string; daysUntilDeletion: number }> };
    const notifications = result.notifications || [];
    logger.info(`Found ${notifications.length} workspaces needing notification`);

    const results = { emailsSent: 0, emailsFailed: 0 };

    for (const notification of notifications) {
      try {
        const userResponse = await callConvexHttp("/users/email", {
          clerkId: notification.userId,
        }) as { email: string | null };

        if (!userResponse.email) {
          logger.warn(`No email found for user ${notification.userId}`);
          results.emailsFailed++;
          continue;
        }

        await sendRetentionWarningEmail(
          userResponse.email,
          notification.daysUntilDeletion,
          "Mentorship Workspace"
        );

        await callConvexHttp("/workspace/retention/notify", {
          workspaceId: notification.workspaceId,
          userId: notification.userId,
          notificationType: "expiry_warning",
        });

        results.emailsSent++;
        logger.info(`Sent retention warning to ${userResponse.email} (${notification.daysUntilDeletion} days)`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(`Failed to send warning for workspace ${notification.workspaceId}: ${errorMessage}`);
        results.emailsFailed++;
      }
    }

    logger.info("Retention warnings job completed", { results });
    return results;
  },
});
