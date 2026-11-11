import { logger, schedules } from "@trigger.dev/sdk";
import {
  DeleteObjectsCommand,
  ListObjectVersionsCommand,
  S3Client,
} from "@aws-sdk/client-s3";

/**
 * Deletes onboarding-questionnaire artwork six months after upload.
 *
 * The retention window is a privacy commitment shown to students on the
 * questionnaire and to reviewers in the artwork gallery
 * (`ONBOARDING_WORK_EXAMPLE_RETENTION_MS` in
 * `convex/workspaceConstants.ts`). The Convex query only selects rows
 * older than the window; this task removes the bytes and then marks the
 * rows deleted.
 *
 * The workspace bucket has B2 versioning enabled, so a plain
 * `DeleteObject` would only add a delete marker. Each key's versions
 * (and delete markers) are listed and removed, which is what actually
 * takes the artwork out of storage.
 *
 * Failure handling: if any object cannot be fully deleted, the rows for
 * it are left untouched and the task throws so the schedule retries.
 * Deleting is idempotent, so a partial success is safe to repeat.
 */

const CONVEX_SITE_URL = (
  process.env.CONVEX_SITE_URL ||
  process.env.NEXT_PUBLIC_CONVEX_URL ||
  process.env.CONVEX_DEPLOYMENT_URL ||
  ""
)
  .replace(/\/+$/, "")
  .replace(/\.convex\.cloud$/, ".convex.site");
const CONVEX_HTTP_KEY = process.env.CONVEX_HTTP_KEY;

const WORKSPACE_BUCKET = process.env.WORKSPACE_STORAGE_BUCKET_NAME;
const B2_REGION =
  process.env.WORKSPACE_STORAGE_BUCKET_REGION || process.env.B2_REGION || "us-east-005";
const B2_ENDPOINT =
  process.env.WORKSPACE_STORAGE_BUCKET_ENDPOINT ||
  `https://s3.${B2_REGION}.backblazeb2.com`;

const BATCH_SIZE = 100;
const MAX_BATCHES_PER_RUN = 20;
const DELETE_BATCH_SIZE = 1000;

interface ExpiredWorkExample {
  _id: string;
  onboardingId: string;
  b2Key: string;
  uploadedAt: number;
  /** Another newer live row points at the same key (legacy collision). */
  sharedWithNewerLive: boolean;
}

function getWorkspaceBucket(): string {
  if (!WORKSPACE_BUCKET) {
    throw new Error(
      "WORKSPACE_STORAGE_BUCKET_NAME is not set. Onboarding artwork lives in " +
        "the workspace bucket; refusing to guess."
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

async function callConvexHttp<T>(path: string, body: Record<string, unknown>): Promise<T> {
  if (!CONVEX_SITE_URL || !CONVEX_HTTP_KEY) {
    throw new Error("Convex site URL or HTTP key not configured");
  }
  const response = await fetch(`${CONVEX_SITE_URL}${path}`, {
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
  return (await response.json()) as T;
}

/** Deletes every version (and delete marker) of one object key. */
async function deleteObjectVersions(
  client: S3Client,
  bucket: string,
  key: string
): Promise<number> {
  const targets: Array<{ Key: string; VersionId?: string }> = [];
  let keyMarker: string | undefined;
  let versionIdMarker: string | undefined;

  do {
    const page = await client.send(
      new ListObjectVersionsCommand({
        Bucket: bucket,
        Prefix: key,
        KeyMarker: keyMarker,
        VersionIdMarker: versionIdMarker,
        MaxKeys: DELETE_BATCH_SIZE,
      })
    );

    for (const entry of [...(page.Versions ?? []), ...(page.DeleteMarkers ?? [])]) {
      // Prefix match can return longer keys that start with this one.
      if (entry.Key !== key) continue;
      // The `null` version id is the unversioned object; omit it.
      targets.push(
        entry.VersionId && entry.VersionId !== "null"
          ? { Key: key, VersionId: entry.VersionId }
          : { Key: key }
      );
    }

    keyMarker = page.IsTruncated ? page.NextKeyMarker : undefined;
    versionIdMarker = page.IsTruncated ? page.NextVersionIdMarker : undefined;
  } while (keyMarker);

  if (targets.length === 0) return 0;

  let deleted = 0;
  const failures: string[] = [];
  for (let index = 0; index < targets.length; index += DELETE_BATCH_SIZE) {
    const batch = targets.slice(index, index + DELETE_BATCH_SIZE);
    const response = await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: batch, Quiet: true },
      })
    );
    const failed = response.Errors?.length ?? 0;
    deleted += batch.length - failed;
    for (const error of response.Errors ?? []) {
      failures.push(`${error.Key}: ${error.Code ?? "error"} ${error.Message ?? ""}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `Failed to delete ${failures.length} version(s) of ${key}: ${failures
        .slice(0, 3)
        .join("; ")}`
    );
  }
  return deleted;
}

export const cleanupExpiredOnboardingArtwork = schedules.task({
  id: "cleanup-expired-onboarding-artwork",
  // Daily, off-peak and offset from the other cleanup schedules.
  cron: "45 3 * * *",
  maxDuration: 1800,
  run: async () => {
    const client = getB2Client();
    const bucket = getWorkspaceBucket();

    let scannedRows = 0;
    let deletedVersions = 0;
    let markedRows = 0;
    const errors: string[] = [];

    for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch++) {
      const data = await callConvexHttp<{ workExamples: ExpiredWorkExample[] }>(
        "/onboarding/work-examples/expired",
        { limit: BATCH_SIZE }
      );
      const rows = data.workExamples ?? [];
      if (rows.length === 0) break;
      scannedRows += rows.length;

      const deletedIds: string[] = [];
      for (const row of rows) {
        // Legacy shared key: retire the row but keep the object for the
        // newer upload that still points at it.
        if (row.sharedWithNewerLive) {
          deletedIds.push(row._id);
          continue;
        }
        try {
          deletedVersions += await deleteObjectVersions(client, bucket, row.b2Key);
          deletedIds.push(row._id);
        } catch (error) {
          errors.push(
            `${row.b2Key}: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }

      if (deletedIds.length > 0) {
        const result = await callConvexHttp<{ marked: number }>(
          "/onboarding/work-examples/mark-expired",
          { workExampleIds: deletedIds }
        );
        markedRows += result.marked ?? 0;
      }

      // Do not spin on a batch that failed; the next daily run retries.
      if (errors.length > 0) break;
      if (rows.length < BATCH_SIZE) break;
    }

    logger.info("Onboarding artwork retention sweep complete", {
      scannedRows,
      deletedVersions,
      markedRows,
      failedObjects: errors.length,
    });

    if (errors.length > 0) {
      throw new Error(
        `Failed to delete ${errors.length} expired artwork object(s): ${errors
          .slice(0, 5)
          .join("; ")}`
      );
    }

    return { scannedRows, deletedVersions, markedRows };
  },
});

export default cleanupExpiredOnboardingArtwork;
