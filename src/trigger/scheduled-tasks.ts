import { logger, schedules } from "@trigger.dev/sdk";
import { eq, isNull, lt, and, gte, sql, inArray } from "drizzle-orm";
import { db } from "../../packages/db/src/lib/drizzle";
import { instructorUploads, monthlyStorageCosts, users } from "../../packages/db/src/schema";
import { copyToS3, verifyS3Upload } from "../../packages/storage/src/archive";
import {
  estimateB2StorageCost,
  estimateS3StorageCost,
  formatCost,
  formatBytesToGB,
} from "../../packages/storage/src/costs";
import { Resend } from "resend";

const MAX_TRANSFER_RETRIES = 4;
const DAYS_BEFORE_ARCHIVE = 30;
const DAYS_BEFORE_WARNING = 7;

const resend = new Resend(process.env.RESEND_API_KEY);
const EMAIL_FROM = process.env.EMAIL_FROM || "noreply@mentorships.example.com";

async function sendArchiveWarningEmail(
  to: string,
  instructorName: string,
  files: Array<{ filename: string; size: number }>
): Promise<void> {
  const totalSize = files.reduce((sum, f) => sum + f.size, 0);

  await resend.emails.send({
    from: EMAIL_FROM,
    to,
    subject: "Your files will be archived soon - Action Required",
    html: `
      <h1>File Archive Warning</h1>
      <p>Hello ${instructorName},</p>
      <p>The following files will be archived to cold storage (S3 Glacier) in ${DAYS_BEFORE_WARNING} days:</p>
      <ul>
        ${files.map((f) => `<li>${f.filename} (${formatBytesToGB(f.size)})</li>`).join("")}
      </ul>
      <p><strong>Total size:</strong> ${formatBytesToGB(totalSize)}</p>
      <p>If you still need these files to be quickly accessible, please download them before the archive date.</p>
      <p>After archival, files will still be available but may take 12-48 hours to restore.</p>
      <p>Best regards,<br/>The Mentorships Team</p>
    `,
  });
}

export const archiveOldFiles = schedules.task({
  id: "archive-old-files",
  cron: "0 3 * * *",
  maxDuration: 1800,
  run: async (payload) => {
    logger.info("Starting archive job", { timestamp: payload.timestamp });

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - DAYS_BEFORE_ARCHIVE);

    const filesToArchive = await db
      .select()
      .from(instructorUploads)
      .where(
        and(
          eq(instructorUploads.status, "completed"),
          lt(instructorUploads.createdAt, cutoffDate),
          sql`(${instructorUploads.transferStatus} IS NULL OR ${instructorUploads.transferStatus} = 'pending')`
        )
      )
      .limit(50);

    logger.info(`Found ${filesToArchive.length} files to archive`);

    const results = { success: 0, failed: 0 };

    for (const file of filesToArchive) {
      try {
        const b2Key = file.filename;
        logger.info(`Archiving file ${file.id}: ${b2Key}`);

        const { s3Key, s3Url } = await copyToS3({
          fileId: file.id,
          b2Key,
          filename: file.originalName || file.filename,
        });

        const verified = await verifyS3Upload(s3Key);
        if (!verified) {
          throw new Error("S3 upload verification failed");
        }

        await db
          .update(instructorUploads)
          .set({
            status: "archived",
            transferStatus: "completed",
            archivedAt: new Date(),
            s3Key,
            s3Url,
            updatedAt: new Date(),
          })
          .where(eq(instructorUploads.id, file.id));

        results.success++;
        logger.info(`Successfully archived file ${file.id}`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(`Failed to archive file ${file.id}: ${errorMessage}`);

        await db
          .update(instructorUploads)
          .set({
            transferStatus: "failed",
            errorMessage,
            updatedAt: new Date(),
          })
          .where(eq(instructorUploads.id, file.id));

        results.failed++;
      }
    }

    logger.info("Archive job completed", { results });
    return { processed: filesToArchive.length, ...results };
  },
});

export const retryFailedTransfers = schedules.task({
  id: "retry-failed-transfers",
  cron: "0 */6 * * *",
  maxDuration: 1800,
  run: async (payload) => {
    logger.info("Starting retry failed transfers job", { timestamp: payload.timestamp });

    const failedTransfers = await db
      .select()
      .from(instructorUploads)
      .where(
        and(
          eq(instructorUploads.transferStatus, "failed"),
          sql`${instructorUploads.transferRetryCount} < ${MAX_TRANSFER_RETRIES}`
        )
      )
      .limit(50);

    logger.info(`Found ${failedTransfers.length} transfers to retry`);

    const results = { success: 0, failed: 0, maxRetriesReached: 0 };

    for (const file of failedTransfers) {
      try {
        const retryCount = file.transferRetryCount ?? 0;
        logger.info(`Retrying transfer for file ${file.id} (attempt ${retryCount + 1}/${MAX_TRANSFER_RETRIES})`);

        const b2Key = file.filename;
        const { s3Key, s3Url } = await copyToS3({
          fileId: file.id,
          b2Key,
          filename: file.originalName || file.filename,
        });

        const verified = await verifyS3Upload(s3Key);
        if (!verified) {
          throw new Error("S3 upload verification failed");
        }

        await db
          .update(instructorUploads)
          .set({
            status: "archived",
            transferStatus: "completed",
            transferRetryCount: retryCount + 1,
            archivedAt: new Date(),
            s3Key,
            s3Url,
            updatedAt: new Date(),
          })
          .where(eq(instructorUploads.id, file.id));

        results.success++;
        logger.info(`Successfully retried and archived file ${file.id}`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(`Retry failed for file ${file.id}: ${errorMessage}`);

        const newRetryCount = (file.transferRetryCount ?? 0) + 1;

        if (newRetryCount >= MAX_TRANSFER_RETRIES) {
          await db
            .update(instructorUploads)
            .set({
              status: "failed",
              errorMessage: `Max retries (${MAX_TRANSFER_RETRIES}) reached. Last error: ${errorMessage}`,
              transferRetryCount: newRetryCount,
              updatedAt: new Date(),
            })
            .where(eq(instructorUploads.id, file.id));
          results.maxRetriesReached++;
        } else {
          await db
            .update(instructorUploads)
            .set({
              transferStatus: "failed",
              errorMessage,
              transferRetryCount: newRetryCount,
              updatedAt: new Date(),
            })
            .where(eq(instructorUploads.id, file.id));
          results.failed++;
        }
      }
    }

    logger.info("Retry job completed", { results });
    return { processed: failedTransfers.length, ...results };
  },
});

export const calculateStorageCosts = schedules.task({
  id: "calculate-storage-costs",
  cron: "0 2 * * *",
  run: async (payload) => {
    logger.info("Starting cost calculation job", { timestamp: payload.timestamp });

    const now = new Date();
    const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

    const b2Files = await db
      .select({
        totalSize: sql<number>`COALESCE(SUM(${instructorUploads.size}), 0)`,
        fileCount: sql<number>`COUNT(*)`,
      })
      .from(instructorUploads)
      .where(
        and(
          eq(instructorUploads.status, "completed"),
          isNull(instructorUploads.archivedAt)
        )
      );

    const s3Files = await db
      .select({
        totalSize: sql<number>`COALESCE(SUM(${instructorUploads.size}), 0)`,
        fileCount: sql<number>`COUNT(*)`,
      })
      .from(instructorUploads)
      .where(
        and(
          eq(instructorUploads.status, "archived"),
          isNull(instructorUploads.deletedAt)
        )
      );

    const b2TotalSize = Number(b2Files[0]?.totalSize ?? 0);
    const s3TotalSize = Number(s3Files[0]?.totalSize ?? 0);

    const b2StorageCost = estimateB2StorageCost(b2TotalSize);
    const s3StorageCost = estimateS3StorageCost(s3TotalSize);

    const b2ApiCost = Math.round((Number(b2Files[0]?.fileCount ?? 0) / 1000) * 4);

    const totalCost = b2StorageCost + b2ApiCost + s3StorageCost;

    logger.info("Storage costs calculated", {
      month,
      b2Files: b2Files[0]?.fileCount ?? 0,
      b2Size: b2TotalSize,
      s3Files: s3Files[0]?.fileCount ?? 0,
      s3Size: s3TotalSize,
      costs: {
        b2Storage: formatCost(b2StorageCost),
        b2Api: formatCost(b2ApiCost),
        s3Storage: formatCost(s3StorageCost),
        total: formatCost(totalCost),
      },
    });

    await db
      .insert(monthlyStorageCosts)
      .values({
        id: crypto.randomUUID(),
        month,
        b2StorageCost,
        b2DownloadCost: 0,
        b2ApiCost,
        s3StorageCost,
        s3RetrievalCost: 0,
        totalCost,
        alertSent: false,
        alertThreshold: 5000,
      })
      .onConflictDoUpdate({
        target: monthlyStorageCosts.month,
        set: {
          b2StorageCost,
          b2DownloadCost: 0,
          b2ApiCost,
          s3StorageCost,
          s3RetrievalCost: 0,
          totalCost,
          updatedAt: new Date(),
        },
      });

    return {
      month,
      b2: { size: b2TotalSize, files: Number(b2Files[0]?.fileCount ?? 0), cost: b2StorageCost },
      s3: { size: s3TotalSize, files: Number(s3Files[0]?.fileCount ?? 0), cost: s3StorageCost },
      totalCost,
    };
  },
});

export const sendArchiveWarnings = schedules.task({
  id: "send-archive-warnings",
  cron: "0 9 * * *",
  maxDuration: 600,
  run: async (payload) => {
    logger.info("Starting archive warnings job", { timestamp: payload.timestamp });

    const daysBeforeArchiveCutoff = DAYS_BEFORE_ARCHIVE - DAYS_BEFORE_WARNING;
    const cutoffEnd = new Date();
    cutoffEnd.setDate(cutoffEnd.getDate() - daysBeforeArchiveCutoff);
    const cutoffStart = new Date();
    cutoffStart.setDate(cutoffStart.getDate() - daysBeforeArchiveCutoff - 1);

    const filesToWarn = await db
      .select({
        upload: instructorUploads,
        user: users,
      })
      .from(instructorUploads)
      .innerJoin(users, eq(instructorUploads.instructorId, users.id))
      .where(
        and(
          eq(instructorUploads.status, "completed"),
          gte(instructorUploads.createdAt, cutoffStart),
          lt(instructorUploads.createdAt, cutoffEnd),
          sql`(${instructorUploads.transferStatus} IS NULL OR ${instructorUploads.transferStatus} = 'pending')`,
          sql`(${instructorUploads.notifiedAt} IS NULL OR ${instructorUploads.notifiedAt} < NOW() - INTERVAL '1 day')`
        )
      )
      .limit(100);

    const instructorFiles = new Map<string, { email: string; name: string; files: Array<{ id: string; filename: string; size: number }> }>();

    for (const row of filesToWarn) {
      const instructorId = row.upload.instructorId;
      if (!instructorFiles.has(instructorId)) {
        instructorFiles.set(instructorId, {
          email: row.user.email,
          name: row.user.email.split("@")[0],
          files: [],
        });
      }
      instructorFiles.get(instructorId)!.files.push({
        id: row.upload.id,
        filename: row.upload.originalName || row.upload.filename,
        size: Number(row.upload.size),
      });
    }

    logger.info(`Sending warnings to ${instructorFiles.size} instructors`);

    const results = { emailsSent: 0, emailsFailed: 0 };

    for (const [instructorId, data] of instructorFiles) {
      try {
        await sendArchiveWarningEmail(data.email, data.name, data.files);

        await db
          .update(instructorUploads)
          .set({
            notifiedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(instructorUploads.instructorId, instructorId),
              inArray(instructorUploads.id, data.files.map((f) => f.id))
            )
          );

        results.emailsSent++;
        logger.info(`Sent archive warning to ${data.email}`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(`Failed to send warning to ${data.email}: ${errorMessage}`);
        results.emailsFailed++;
      }
    }

    logger.info("Archive warnings job completed", { results });
    return {
      instructorsNotified: instructorFiles.size,
      filesMentioned: filesToWarn.length,
      ...results,
    };
  },
});
