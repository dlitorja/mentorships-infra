import { task, logger } from "@trigger.dev/sdk";
import archiver from "archiver";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { EXPORT_ARTIFACT_TTL_MS, uniqueArchiveName } from "@mentorships/storage";

/**
 * Onboarding artwork ZIP export.
 *
 * Reviewers (instructors acting on a submitted questionnaire, or
 * admin/support) can already open and download each work-example image
 * one at a time. This task adds "download all" without touching Convex
 * storage:
 *
 *   1. `createOnboardingArtworkExport` (Convex) inserts a pending row
 *      and triggers this task.
 *   2. The task asks Convex (HTTP + CONVEX_HTTP_KEY) for the active
 *      work-example keys.
 *   3. Each object is streamed straight out of the workspace B2 bucket
 *      into an `archiver` ZIP, which is uploaded back to the same
 *      bucket under `onboarding/<onboardingId>/exports/`.
 *   4. The row flips to `completed` with a 7-day signed URL.
 *
 * Bucket note: work-example uploads live in the WORKSPACE bucket
 * (`WORKSPACE_STORAGE_BUCKET_NAME`, prefix `onboarding/`), not the
 * video `B2_BUCKET_NAME`. Reading the wrong bucket yields NoSuchKey —
 * the same class of bug that broke workspace exports.
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

// Signed URLs expire with the artifact itself — the Trigger schedule
// `cleanup-export-artifacts` deletes the object after the same window.
const EXPORT_URL_EXPIRY_SECONDS = Math.floor(EXPORT_ARTIFACT_TTL_MS / 1000);

function getWorkspaceBucket(): string {
  if (!WORKSPACE_BUCKET) {
    throw new Error(
      "WORKSPACE_STORAGE_BUCKET_NAME is not set. Onboarding artwork lives in the " +
        "workspace bucket; falling back to B2_BUCKET_NAME would export nothing."
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

async function callConvexHttp(path: string, body: Record<string, unknown>): Promise<unknown> {
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
  return response.json();
}

interface ArtworkFile {
  b2Key: string;
  fileName: string;
  contentType: string;
  size: number;
}

async function getExportData(onboardingId: string) {
  return callConvexHttp("/onboarding/artwork-export/data", { onboardingId }) as Promise<{
    studentEmail: string;
    files: ArtworkFile[];
  }>;
}

async function updateExportStatus(
  exportId: string,
  status: "processing" | "completed" | "failed",
  options: { downloadUrl?: string; errorMessage?: string; fileCount?: number } = {}
) {
  const expiresAt =
    status === "completed"
      ? Date.now() + EXPORT_ARTIFACT_TTL_MS
      : undefined;

  return callConvexHttp("/onboarding/artwork-export/update-status", {
    exportId,
    status,
    downloadUrl: options.downloadUrl,
    expiresAt,
    errorMessage: options.errorMessage,
    fileCount: options.fileCount,
  });
}

function sanitizeFilename(filename: string): string {
  const cleaned = filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  return cleaned.length > 0 ? cleaned : "artwork";
}

/** Keeps archive entries unique when two uploads share a filename. */
const uniqueName = uniqueArchiveName;

function isNodeReadableStream(value: unknown): value is NodeJS.ReadableStream {
  return (
    value !== null &&
    typeof value === "object" &&
    "pipe" in value &&
    typeof (value as { pipe: unknown }).pipe === "function"
  );
}

export const processOnboardingArtworkExport = task({
  id: "process-onboarding-artwork-export",
  maxDuration: 600,
  retry: {
    maxAttempts: 3,
  },
  run: async (payload: { onboardingId: string; exportId: string }) => {
    const { onboardingId, exportId } = payload;
    logger.info("Starting onboarding artwork export", { onboardingId, exportId });

    try {
      await updateExportStatus(exportId, "processing");

      const exportData = await getExportData(onboardingId);
      if (exportData.files.length === 0) {
        throw new Error("No active artwork to export.");
      }

      const client = getB2Client();
      // Dedicated top-level namespace: upload keys embed a student-supplied
      // fileId under `onboarding/`, so generated archives must not live there
      // (a student could name a source file "exports" and be swept).
      const zipKey = `onboarding-exports/${onboardingId}/${Date.now()}-artwork.zip`;
      const safeEmail = sanitizeFilename(exportData.studentEmail.split("@")[0] ?? "student");
      const zipFilename = `${safeEmail}-artwork.zip`;

      // Buffer the archive and PUT it with PutObjectCommand, matching the
      // workspace export. `@aws-sdk/lib-storage` rejects archiver's
      // stream ("Body Data is unsupported format"): archiver builds on
      // `readable-stream`, whose Transform is not `instanceof` the core
      // `stream.Readable` the SDK checks. Artwork is capped at six 8 MB
      // files, so buffering is safe here.
      const archive = archiver("zip", { store: true });
      const chunks: Buffer[] = [];
      const archiveDone = new Promise<void>((resolve, reject) => {
        archive.on("data", (chunk: Buffer) => chunks.push(chunk));
        archive.on("error", reject);
        archive.on("end", () => resolve());
      });

      const usedNames = new Set<string>();
      let included = 0;

      try {
        for (const file of exportData.files) {
          const response = await client.send(
            new GetObjectCommand({
              Bucket: getWorkspaceBucket(),
              Key: file.b2Key,
            })
          );

          if (!response.Body || !isNodeReadableStream(response.Body)) {
            logger.warn("Skipping unreadable artwork object", { b2Key: file.b2Key });
            continue;
          }

          const name = uniqueName(sanitizeFilename(file.fileName), usedNames);
          // `artwork/` keeps the archive tidy and leaves room for a
          // future questionnaire.txt alongside it.
          archive.append(response.Body, { name: `artwork/${name}` });
          included += 1;
        }

        if (included === 0) {
          throw new Error("None of the artwork files could be read from storage.");
        }

        archive.finalize();
        await archiveDone;
      } catch (error) {
        archive.abort();
        throw error;
      }

      const zipBuffer = Buffer.concat(chunks);
      await client.send(
        new PutObjectCommand({
          Bucket: getWorkspaceBucket(),
          Key: zipKey,
          Body: zipBuffer,
          ContentType: "application/zip",
          ContentDisposition: `attachment; filename="${zipFilename}"`,
        })
      );

      const downloadUrl = await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: getWorkspaceBucket(),
          Key: zipKey,
          ResponseContentDisposition: `attachment; filename="${zipFilename}"`,
        }),
        { expiresIn: EXPORT_URL_EXPIRY_SECONDS }
      );

      await updateExportStatus(exportId, "completed", {
        downloadUrl,
        fileCount: included,
      });

      logger.info("Onboarding artwork export completed", {
        onboardingId,
        exportId,
        fileCount: included,
        requested: exportData.files.length,
      });

      return { success: true, downloadUrl, fileCount: included };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("Onboarding artwork export failed", { exportId, error: errorMessage });

      await updateExportStatus(exportId, "failed", { errorMessage });

      // Rethrow so Trigger.dev's retry policy (maxAttempts: 3) can
      // recover from transient B2 / Convex failures. Returning
      // `{ success: false }` marks the run complete and skips retries.
      throw error;
    }
  },
});
