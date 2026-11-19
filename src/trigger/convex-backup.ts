import { logger, schedules } from "@trigger.dev/sdk";
import {
  DeleteObjectCommand,
  ListObjectVersionsCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Resend } from "resend";
import {
  CONVEX_BACKUP_PREFIX,
  CONVEX_BACKUP_RETENTION_DAYS,
  buildConvexBackupKey,
  selectExpiredConvexBackupVersions,
} from "@mentorships/storage";
import { resolveFrom } from "../../packages/emails/src/envelope";

const execFileAsync = promisify(execFile);

/**
 * Daily Convex → B2 database backup.
 *
 * Why this exists: the managed Convex Starter plan has no dashboard
 * backups (daily backups are a Professional entitlement). On
 * 2026-11-14 a retention bug hard-deleted every workspace's chat,
 * images, notes, and links; images/files survived in B2, but the
 * plain-text rows had no copy anywhere. This task makes the row data
 * durable from now on.
 *
 * Export format: `convex export` produces a ZIP of every table's
 * documents (no file storage — B2 already holds the bytes). The
 * object key is immutable (`convex-backups/<deployment>/YYYY/MM/DD/
 * <timestamp>.zip`) and a manifest records size + sha256.
 *
 * Restore: see `docs/runbooks/convex-backups.md` and
 * `scripts/restore-convex-backup.mjs`. Never restore in place without
 * a fresh backup first.
 *
 * Cost: the ZIP is a few MB at the current scale; 90 daily copies in
 * B2 are negligible. Retention deletes object *versions* — B2 buckets
 * are versioned by default, so deleting a key alone would only add a
 * hide marker and keep billing the bytes.
 */

const CONVEX_DEPLOY_KEY = process.env.CONVEX_DEPLOY_KEY;
const CONVEX_URL =
  process.env.NEXT_PUBLIC_CONVEX_URL ||
  process.env.CONVEX_CLOUD_URL ||
  process.env.CONVEX_DEPLOYMENT_URL;

const BACKUP_BUCKET = process.env.WORKSPACE_STORAGE_BUCKET_NAME;
const B2_REGION =
  process.env.WORKSPACE_STORAGE_BUCKET_REGION ||
  process.env.B2_REGION ||
  "us-east-005";
const B2_ENDPOINT =
  process.env.WORKSPACE_STORAGE_BUCKET_ENDPOINT ||
  `https://s3.${B2_REGION}.backblazeb2.com`;

const EXPORT_TIMEOUT_MS = 30 * 60 * 1000;

function requireEnv(name: string, value: string | undefined): string {
  if (!value || value.trim().length === 0) {
    throw new Error(`${name} is not set; cannot run the Convex backup`);
  }
  return value.trim();
}

function deploymentNameFromUrl(url: string | undefined): string {
  const value = requireEnv("NEXT_PUBLIC_CONVEX_URL", url);
  try {
    const host = new URL(value).hostname;
    const [deployment] = host.split(".");
    if (deployment) return deployment;
  } catch {
    // fall through to the explicit error below
  }
  throw new Error(
    `NEXT_PUBLIC_CONVEX_URL "${value}" is not an absolute URL; cannot derive the deployment name`
  );
}

function getBackupBucket(): string {
  return requireEnv("WORKSPACE_STORAGE_BUCKET_NAME", BACKUP_BUCKET);
}

function getB2Client(): S3Client {
  const accessKeyId = requireEnv("B2_KEY_ID", process.env.B2_KEY_ID);
  const secretAccessKey = requireEnv(
    "B2_APPLICATION_KEY",
    process.env.B2_APPLICATION_KEY
  );
  return new S3Client({
    region: B2_REGION,
    endpoint: B2_ENDPOINT,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

async function sendFailureAlert(message: string, runId: string): Promise<void> {
  const to = process.env.CONVEX_BACKUP_ALERT_EMAIL?.trim();
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!to || !apiKey) return;

  try {
    const resend = new Resend(apiKey);
    const result = await resend.emails.send({
      from: resolveFrom("transactional") || "noreply@mentorships.example.com",
      to,
      subject: "Convex database backup FAILED",
      headers: { "X-Email-Kind": "transactional" },
      html: `
        <h2>Convex database backup failed</h2>
        <p>Run: <code>${runId}</code></p>
        <p>${message.replace(/[<>&]/g, "")}</p>
        <p>The previous backups in B2 are unchanged.</p>
      `,
    });
    // Resend returns `{ error }` for rate limits, unverified senders, and
    // other rejections instead of throwing. Ignoring it made alerts
    // disappear while looking sent.
    if (result.error) {
      logger.error("Convex backup alert email was rejected", {
        error: result.error.message ?? String(result.error),
      });
    } else if (!result.data?.id) {
      logger.warn("Convex backup alert email returned no message id");
    }
  } catch (error) {
    logger.error("Convex backup alert email failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function listAllVersions(
  client: S3Client,
  bucket: string
): Promise<Array<{ key: string; versionId: string; lastModified: number }>> {
  const versions: Array<{ key: string; versionId: string; lastModified: number }> = [];
  let keyMarker: string | undefined;
  let versionIdMarker: string | undefined;

  while (true) {
    const response = await client.send(
      new ListObjectVersionsCommand({
        Bucket: bucket,
        Prefix: `${CONVEX_BACKUP_PREFIX}/`,
        KeyMarker: keyMarker,
        VersionIdMarker: versionIdMarker,
      })
    );

    for (const version of response.Versions ?? []) {
      if (!version.Key || !version.VersionId) continue;
      versions.push({
        key: version.Key,
        versionId: version.VersionId,
        lastModified: version.LastModified?.getTime() ?? 0,
      });
    }

    if (!response.IsTruncated) break;
    keyMarker = response.NextKeyMarker;
    versionIdMarker = response.NextVersionIdMarker;
  }

  return versions;
}

export const convexDatabaseBackup = schedules.task({
  id: "convex-database-backup",
  cron: "0 2 * * *",
  maxDuration: 3600,
  retry: { maxAttempts: 2 },
  run: async (payload, { ctx }) => {
    // Schedule payloads arrive as Date; a manual test trigger may
    // deliver an ISO string, so normalize before serializing.
    const scheduledAt = new Date(payload.timestamp).toISOString();
    logger.info("Starting Convex database backup", { scheduledAt });

    let workDir: string | undefined;
    try {
      requireEnv("CONVEX_DEPLOY_KEY", CONVEX_DEPLOY_KEY);
      const bucket = getBackupBucket();
      const deployment = deploymentNameFromUrl(CONVEX_URL);
      const client = getB2Client();

      workDir = await mkdtemp(join(tmpdir(), "convex-backup-"));
      const zipPath = join(workDir, `${deployment}.zip`);

      logger.info("Exporting Convex documents", { deployment });
      await execFileAsync("convex", ["export", "--path", zipPath], {
        env: process.env,
        timeout: EXPORT_TIMEOUT_MS,
        maxBuffer: 16 * 1024 * 1024,
      });

      const fileStat = await stat(zipPath);
      if (!fileStat.isFile() || fileStat.size === 0) {
        throw new Error("convex export produced an empty archive");
      }

      const sha256 = await sha256File(zipPath);
      const timestamp = Date.now();
      const keys = buildConvexBackupKey(deployment, timestamp);
      const manifest = {
        version: 1,
        deployment,
        createdAt: new Date(timestamp).toISOString(),
        scheduledAt,
        zipKey: keys.zipKey,
        sizeBytes: fileStat.size,
        sha256,
        convexUrl: CONVEX_URL,
        triggerRunId: ctx.run.id,
        includesFileStorage: false,
      };

      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: keys.zipKey,
          Body: createReadStream(zipPath),
          ContentType: "application/zip",
          ContentLength: fileStat.size,
          Metadata: { sha256, deployment },
        })
      );
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: keys.manifestKey,
          Body: JSON.stringify(manifest, null, 2),
          ContentType: "application/json",
        })
      );

      logger.info("Uploaded Convex backup", {
        key: keys.zipKey,
        sizeBytes: fileStat.size,
        sha256,
      });

      // Retention sweep. Object versions, not keys: B2 is versioned,
      // so `DeleteObject` without a VersionId would only hide the
      // archive and keep the bytes on the bill. B2's multi-object
      // delete does not accept VersionId, so delete one version at a
      // time. A prune failure must not fail the backup itself — the
      // fresh archive is already durable.
      let deletedVersions = 0;
      let retentionError: string | undefined;
      try {
        const versions = await listAllVersions(client, bucket);
        const expired = selectExpiredConvexBackupVersions(versions, Date.now());
        for (const version of expired) {
          await client.send(
            new DeleteObjectCommand({
              Bucket: bucket,
              Key: version.key,
              VersionId: version.versionId,
            })
          );
          deletedVersions += 1;
        }

        logger.info("Convex backup retention sweep complete", {
          scannedVersions: versions.length,
          deletedVersions,
          retentionDays: CONVEX_BACKUP_RETENTION_DAYS,
        });
      } catch (error) {
        retentionError = error instanceof Error ? error.message : String(error);
        logger.error("Convex backup retention sweep failed", {
          error: retentionError,
          deletedVersions,
        });
      }

      return {
        key: keys.zipKey,
        manifestKey: keys.manifestKey,
        sizeBytes: fileStat.size,
        sha256,
        retentionDays: CONVEX_BACKUP_RETENTION_DAYS,
        deletedVersions,
        retentionError,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("Convex database backup failed", { error: message });
      await sendFailureAlert(message, ctx.run.id);
      throw error;
    } finally {
      if (workDir) {
        await rm(workDir, { recursive: true, force: true }).catch(() => {});
      }
    }
  },
});
