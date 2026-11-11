import { logger, schedules } from "@trigger.dev/sdk";
import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  EXPORT_ARTIFACT_TTL_MS,
  selectExpiredExportArtifacts,
} from "@mentorships/storage";

/**
 * Deletes generated export artifacts after 72 hours.
 *
 * Export files are disposable: download links are short-lived and any
 * reviewer can rebuild the archive in seconds. Without a sweeper they
 * accumulate in the workspace bucket forever.
 *
 * What counts as an export artifact (see
 * `packages/storage/src/export-artifacts.ts`):
 *   - `exports/<workspaceId>/…`      — workspace ZIP / links CSV
 *   - `onboarding/<id>/exports/…`    — artwork ZIP
 *
 * Uploaded artwork itself (`onboarding/<id>/<fileId>/<name>`) shares the
 * `onboarding/` prefix and is intentionally NOT touched.
 *
 * The matching Convex rows are pruned by the `cleanup-expired-export-records`
 * cron (`convex/exportMaintenance.ts`), so this task only needs object
 * storage. Both use the same 72-hour window as the signed download URL.
 *
 * Idempotent: a missing object is simply absent from the listing. Delete
 * errors are reported and rethrown so the schedule retries; already
 * deleted keys are skipped by the next run.
 */
const LIST_PREFIXES = ["exports/", "onboarding/"] as const;
const DELETE_BATCH_SIZE = 1000;

const WORKSPACE_BUCKET = process.env.WORKSPACE_STORAGE_BUCKET_NAME;
const B2_REGION =
  process.env.WORKSPACE_STORAGE_BUCKET_REGION || process.env.B2_REGION || "us-east-005";
const B2_ENDPOINT =
  process.env.WORKSPACE_STORAGE_BUCKET_ENDPOINT ||
  `https://s3.${B2_REGION}.backblazeb2.com`;

function getWorkspaceBucket(): string {
  if (!WORKSPACE_BUCKET) {
    throw new Error(
      "WORKSPACE_STORAGE_BUCKET_NAME is not set. Export artifacts live in the " +
        "workspace bucket; refusing to guess."
    );
  }
  return WORKSPACE_BUCKET;
}

function getB2Client(): S3Client {
  const accessKeyId = process.env.B2_KEY_ID;
  const secretAccessKey = process.env.B2_APPLICATION_KEY;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error("Missing B2 credentials");
  }
  return new S3Client({
    region: B2_REGION,
    endpoint: B2_ENDPOINT,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });
}

export const cleanupExportArtifacts = schedules.task({
  id: "cleanup-export-artifacts",
  // Hourly; artifacts are eligible strictly after 72h, so the sweep can
  // run up to an hour late but never early.
  cron: "15 * * * *",
  maxDuration: 600,
  run: async () => {
    const client = getB2Client();
    const bucket = getWorkspaceBucket();
    const now = Date.now();

    let scanned = 0;
    const candidates: string[] = [];

    for (const prefix of LIST_PREFIXES) {
      let continuationToken: string | undefined;
      do {
        const page = await client.send(
          new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: prefix,
            ContinuationToken: continuationToken,
            MaxKeys: DELETE_BATCH_SIZE,
          })
        );

        const contents = (page.Contents ?? [])
          .map((object) => ({
            key: object.Key ?? "",
            lastModified: object.LastModified?.getTime() ?? 0,
          }))
          .filter((object) => object.key.length > 0);
        scanned += contents.length;
        candidates.push(
          ...selectExpiredExportArtifacts(contents, now, EXPORT_ARTIFACT_TTL_MS)
        );

        continuationToken = page.IsTruncated
          ? page.NextContinuationToken
          : undefined;
      } while (continuationToken);
    }

    const keys = [...new Set(candidates)];
    if (keys.length === 0) {
      logger.info("Export artifact sweep: nothing to delete", { scanned });
      return { scanned, expired: 0, deleted: 0 };
    }

    let deleted = 0;
    const errors: string[] = [];
    for (let index = 0; index < keys.length; index += DELETE_BATCH_SIZE) {
      const batch = keys.slice(index, index + DELETE_BATCH_SIZE);
      const response = await client.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: {
            Objects: batch.map((Key) => ({ Key })),
            Quiet: true,
          },
        })
      );
      const failed = response.Errors?.length ?? 0;
      deleted += batch.length - failed;
      for (const error of response.Errors ?? []) {
        errors.push(`${error.Key}: ${error.Code ?? "error"} ${error.Message ?? ""}`);
      }
    }

    logger.info("Export artifact sweep complete", {
      scanned,
      expired: keys.length,
      deleted,
      failed: errors.length,
    });

    if (errors.length > 0) {
      // Let the schedule retry; the delete is idempotent.
      throw new Error(
        `Failed to delete ${errors.length} export artifact(s): ${errors
          .slice(0, 5)
          .join("; ")}`
      );
    }

    return { scanned, expired: keys.length, deleted };
  },
});

export default cleanupExportArtifacts;
