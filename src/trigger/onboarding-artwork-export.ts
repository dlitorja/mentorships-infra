import { task, logger } from "@trigger.dev/sdk";
import archiver from "archiver";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Upload } from "@aws-sdk/lib-storage";
import { uniqueArchiveName } from "@mentorships/storage";

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

const CONVEX_DEPLOYMENT_URL =
  process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_DEPLOYMENT_URL;
const CONVEX_HTTP_KEY = process.env.CONVEX_HTTP_KEY;

const WORKSPACE_BUCKET = process.env.WORKSPACE_STORAGE_BUCKET_NAME;
const B2_REGION =
  process.env.WORKSPACE_STORAGE_BUCKET_REGION || process.env.B2_REGION || "us-east-005";
const B2_ENDPOINT =
  process.env.WORKSPACE_STORAGE_BUCKET_ENDPOINT ||
  `https://s3.${B2_REGION}.backblazeb2.com`;

const EXPORT_URL_EXPIRY_DAYS = 7;

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
      ? Date.now() + EXPORT_URL_EXPIRY_DAYS * 24 * 60 * 60 * 1000
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
      const zipKey = `onboarding/${onboardingId}/exports/${Date.now()}-artwork.zip`;
      const safeEmail = sanitizeFilename(exportData.studentEmail.split("@")[0] ?? "student");
      const zipFilename = `${safeEmail}-artwork.zip`;

      const archive = archiver("zip", { store: true });
      const upload = new Upload({
        client,
        params: {
          Bucket: getWorkspaceBucket(),
          Key: zipKey,
          Body: archive,
          ContentType: "application/zip",
          ContentDisposition: `attachment; filename="${zipFilename}"`,
        },
        partSize: 5 * 1024 * 1024,
        leavePartsOnError: false,
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
        await upload.done();
      } catch (error) {
        try {
          await upload.abort();
        } catch (abortError) {
          logger.warn("Failed to abort artwork export upload", { abortError });
        }
        throw error;
      }

      const downloadUrl = await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: getWorkspaceBucket(),
          Key: zipKey,
          ResponseContentDisposition: `attachment; filename="${zipFilename}"`,
        }),
        { expiresIn: EXPORT_URL_EXPIRY_DAYS * 24 * 60 * 60 }
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

      return { success: false, error: errorMessage };
    }
  },
});
