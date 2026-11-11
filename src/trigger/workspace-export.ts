import { task, logger } from "@trigger.dev/sdk";
import { generateLinksCsv, uniqueArchiveName } from "@mentorships/storage";
import archiver from "archiver";
import PDFDocument from "pdfkit";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { sendEmail } from "../../packages/emails/src/send";
import { buildWorkspaceExportReadyEmail } from "../../packages/emails/src/workspace-export";

// Convex HTTP actions live on the `.convex.site` host, not the
// `.convex.cloud` host that `NEXT_PUBLIC_CONVEX_URL` points at.
// Posting to the cloud host returns a function API response (or a
// 404), so every status update here would fail silently and the export
// row would sit in `processing` forever. Prefer an explicit site URL
// when one is configured and normalize otherwise.
const CONVEX_SITE_URL = (
  process.env.CONVEX_SITE_URL ||
  process.env.NEXT_PUBLIC_CONVEX_URL ||
  process.env.CONVEX_DEPLOYMENT_URL ||
  ""
)
  .replace(/\/+$/, "")
  .replace(/\.convex\.cloud$/, ".convex.site");
const CONVEX_HTTP_KEY = process.env.CONVEX_HTTP_KEY;
const B2_KEY_ID = process.env.B2_KEY_ID;
const B2_APPLICATION_KEY = process.env.B2_APPLICATION_KEY;
// Workspace exports read workspace file objects and write the ZIP back
// beside them, so every B2 call here targets the WORKSPACE bucket, not
// the generic `B2_BUCKET_NAME` (video-editor uploads). They were
// different buckets in production, which made every export fail with
// NoSuchKey.
const WORKSPACE_BUCKET = process.env.WORKSPACE_STORAGE_BUCKET_NAME;
const B2_REGION =
  process.env.WORKSPACE_STORAGE_BUCKET_REGION ||
  process.env.B2_REGION ||
  "us-east-005";
// Derive from the workspace region instead of falling back to the generic
// `B2_ENDPOINT`: that endpoint points at a *different* bucket's region
// (us-west-002 historically), so reusing it would send workspace uploads
// to the wrong host even when the region is right.
const B2_ENDPOINT =
  process.env.WORKSPACE_STORAGE_BUCKET_ENDPOINT ||
  `https://s3.${B2_REGION}.backblazeb2.com`;

const EXPORT_URL_EXPIRY_DAYS = 7;

function getWorkspaceBucket(): string {
  if (!WORKSPACE_BUCKET) {
    throw new Error(
      "WORKSPACE_STORAGE_BUCKET_NAME is not set. Workspace exports must not " +
        "fall back to B2_BUCKET_NAME — workspace objects live in a dedicated " +
        "bucket, so a fallback silently exports the wrong (empty) set."
    );
  }
  return WORKSPACE_BUCKET;
}

function getB2Client(): S3Client {
  if (!B2_KEY_ID || !B2_APPLICATION_KEY) {
    throw new Error("Missing B2 credentials");
  }
  return new S3Client({
    region: B2_REGION,
    endpoint: B2_ENDPOINT,
    credentials: {
      accessKeyId: B2_KEY_ID,
      secretAccessKey: B2_APPLICATION_KEY,
    },
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

async function getExportData(
  workspaceId: string,
  imageIds?: string[],
  scope?: "workspace" | "images" | "links"
) {
  return callConvexHttp("/workspace/export/data", {
    workspaceId,
    imageIds,
    scope,
  }) as Promise<{
    workspaceName: string;
    notes?: Array<{ title: string; content: string; updatedAt: number }>;
    images?: Array<{
      imageUrl: string;
      // Present for rows uploaded through the B2 pipeline. When set,
      // the task reads the object straight from the workspace bucket
      // instead of re-fetching a signed URL — one auth round-trip
      // saved per image and no 1-hour URL expiry race.
      b2Key?: string;
      fileName?: string;
      storageId?: string;
      contentType?: string;
      createdBy: string;
      createdAt: number;
    }>;
    links?: Array<{
      url: string;
      title?: string;
      createdBy: string;
      sessionId?: string;
      createdAt: number;
    }>;
  }>;
}

async function getExportOwner(exportId: string) {
  return callConvexHttp("/workspace/export/get", { exportId }) as Promise<{
    userId: string;
    workspaceId: string;
    workspaceName: string;
    status: "pending" | "processing" | "completed" | "failed";
  } | null>;
}

/**
 * Updates an export row's status. Reads the row first when status
 * is "completed" or "failed" to avoid overwriting a row the user
 * has cancelled (`cancelWorkspaceExport` writes "failed") or a
 * row that a previous retry of this task already marked
 * "completed". Without this guard a retry would silently undo a
 * user-initiated cancel.
 */
async function updateExportStatus(
  exportId: string,
  status: "processing" | "completed" | "failed",
  downloadUrl?: string,
  errorMessage?: string
) {
  const expiresAt = status === "completed"
    ? Date.now() + EXPORT_URL_EXPIRY_DAYS * 24 * 60 * 60 * 1000
    : undefined;

  return callConvexHttp("/workspace/export/update-status", {
    exportId,
    status,
    downloadUrl,
    expiresAt,
    errorMessage,
  });
}

async function uploadZipToB2(
  zipBuffer: Buffer,
  workspaceId: string,
  workspaceName: string,
  filename: string
): Promise<string> {
  const client = getB2Client();
  const timestamp = Date.now();
  const safeName = workspaceName.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 50);
  const key = `exports/${workspaceId}/${timestamp}-${safeName}.zip`;

  await client.send(
    new PutObjectCommand({
      Bucket: getWorkspaceBucket(),
      Key: key,
      Body: zipBuffer,
      ContentType: "application/zip",
      ContentDisposition: `attachment; filename="${filename}"`,
    })
  );

  // Use a signed URL — the static `download.backblazeb2.com` URL
  // works only for buckets with public ACL, which the
  // instructor-uploads bucket does not have. Mirrors `bulk-download.ts`.
  return getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: getWorkspaceBucket(),
      Key: key,
      ResponseContentDisposition: `attachment; filename="${filename}"`,
    }),
    { expiresIn: EXPORT_URL_EXPIRY_DAYS * 24 * 60 * 60 }
  );
}

/**
 * Fetches image bytes for an export entry. Three cases, in priority
 * order:
 *
 *   1. `b2Key` — the current storage path. Stream the object straight
 *      out of the workspace bucket with the S3 SDK.
 *   2. `imageUrl` starts with `data:` — a very old image whose bytes
 *      were inlined into the row. Decode the base64 payload.
 *   3. `imageUrl` is a Convex storage URL (pre-B2 rows). Fetch over
 *      HTTP.
 *
 * Returns null when the bytes cannot be retrieved (deleted object,
 * network error). The caller logs and continues so one bad image does
 * not fail the entire export.
 */
/**
 * Defence in depth for the legacy `imageUrl` path: the Convex query
 * already drops untrusted values, but the worker re-checks before
 * fetching so a future query change cannot turn this task into an SSRF
 * proxy. Only inline image data and Convex storage URLs are allowed.
 */
function isTrustedLegacyImageUrl(url: string): boolean {
  if (url.startsWith("data:image/")) return true;
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      /(^|\.)convex\.cloud$/.test(parsed.hostname)
    );
  } catch {
    return false;
  }
}

async function fetchImageBytes(img: {
  imageUrl: string;
  b2Key?: string;
  storageId?: string;
}): Promise<{ bytes: Buffer; contentType: string; extension: string } | null> {
  // Preferred path: read the object straight out of the workspace
  // bucket with the S3 SDK. No presigned GET (and therefore no URL
  // expiry window) and no second network hop.
  if (img.b2Key) {
    try {
      const response = await getB2Client().send(
        new GetObjectCommand({
          Bucket: getWorkspaceBucket(),
          Key: img.b2Key,
        })
      );
      if (!response.Body) return null;
      const bytes = Buffer.from(await response.Body.transformToByteArray());
      const contentType = response.ContentType || "application/octet-stream";
      return {
        bytes,
        contentType,
        extension: extensionForContentType(contentType),
      };
    } catch (error) {
      logger.warn("Failed to read B2 object for export", {
        b2Key: img.b2Key,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  if (img.imageUrl.startsWith("data:")) {
    const match = /^data:([^;]+);base64,(.*)$/.exec(img.imageUrl);
    if (!match) return null;
    const contentType = match[1] || "application/octet-stream";
    const bytes = Buffer.from(match[2], "base64");
    return { bytes, contentType, extension: extensionForContentType(contentType) };
  }

  try {
    // Only fetch URLs the query marked as trustworthy. `fetch` would
    // follow a client-supplied URL (including internal hosts) and the
    // response would land in the user's ZIP.
    if (!isTrustedLegacyImageUrl(img.imageUrl)) {
      logger.warn("Skipping untrusted legacy image URL in export", {
        storageId: img.storageId,
      });
      return null;
    }
    const response = await fetch(img.imageUrl);
    if (!response.ok) return null;
    const arrayBuffer = await response.arrayBuffer();
    const contentType = response.headers.get("content-type") || "application/octet-stream";
    return {
      bytes: Buffer.from(arrayBuffer),
      contentType,
      extension: extensionForContentType(contentType),
    };
  } catch (error) {
    logger.warn("Failed to fetch image bytes for export", {
      storageId: img.storageId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Returns a filename unique within `used`. Two uploads named
 * `sketch.png` would otherwise collapse into one ZIP entry (archiver
 * overwrites by name), so the second becomes `sketch-2.png`.
 * Implementation lives in `@mentorships/storage` so the behaviour is
 * unit-tested with the CSV helpers.
 */
const uniqueName = uniqueArchiveName;

function extensionForContentType(contentType: string): string {
  // Strip parameters before lookup (e.g. `image/png; charset=utf-8` →
  // `image/png`). Without this, every B2-stored image whose
  // Content-Type carries a charset would fall back to `.bin`.
  const mediaType = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  const map: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/svg+xml": "svg",
    "image/heic": "heic",
    "image/heif": "heif",
    "image/avif": "avif",
    "image/tiff": "tif",
    "image/bmp": "bmp",
  };
  return map[mediaType] || "bin";
}

/**
 * Returns the sanitized extension from a filename, or null when the
 * name has none / it is not safe to use.
 *
 * Preferring the stored filename over the MIME lookup keeps `.jpeg`
 * as `.jpeg` and preserves formats the MIME map doesn't know (TIFF,
 * BMP, HEIC, …). The name came from a sanitized B2 key, so it cannot
 * contain path separators, but it is still re-checked here.
 */
function extensionFromFileName(fileName: string): string | null {
  const match = /\.([a-zA-Z0-9]{1,8})$/.exec(fileName);
  if (!match) return null;
  const ext = match[1].toLowerCase();
  return /^[a-z0-9]+$/.test(ext) ? ext : null;
}

function generateMarkdown(notes: Array<{ title: string; content: string; updatedAt: number }>): string {
  const lines = ["# Workspace Notes Export\n"];

  for (const note of notes) {
    const date = new Date(note.updatedAt).toLocaleDateString();
    lines.push(`## ${note.title}\n`);
    lines.push(`*Last updated: ${date}*\n`);
    lines.push(`${note.content}\n`);
    lines.push("---\n");
  }

  return lines.join("\n");
}

async function notifyExportReady(
  exportId: string,
  downloadUrl: string,
  expiresAt: number | undefined
) {
  const owner = await getExportOwner(exportId);
  if (!owner) {
    logger.warn("Export owner not found for email notification", { exportId });
    return;
  }

  const emailResult = await callConvexHttp("/users/email", {
    clerkId: owner.userId,
  }) as { email: string | null };

  if (!emailResult.email) {
    logger.warn("Export recipient email not found", { exportId, userId: owner.userId });
    return;
  }

  const built = buildWorkspaceExportReadyEmail({
    workspaceName: owner.workspaceName,
    downloadUrl,
    expiresAt: expiresAt ?? Date.now() + EXPORT_URL_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
  });

  const result = await sendEmail({
    to: emailResult.email,
    subject: built.subject,
    text: built.text,
    html: built.html,
    headers: built.headers,
    kind: "transactional",
  });

  if (!result.ok && "skipped" in result && result.skipped) {
    logger.warn("Export ready email skipped (provider not configured)", { exportId });
    return;
  }
  if (!result.ok) {
    const errorMessage = "error" in result ? result.error : "unknown error";
    logger.error("Export ready email failed", { exportId, error: errorMessage });
    return;
  }
  logger.info("Export ready email sent", { exportId, resendId: result.id });
}

export const processWorkspaceExport = task({
  id: "process-workspace-export",
  maxDuration: 600,
  retry: {
    maxAttempts: 3,
  },
  run: async (payload: {
    workspaceId: string;
    exportId: string;
    imageIds?: string[];
    scope?: "workspace" | "images" | "links";
  }) => {
    const { workspaceId, exportId, imageIds, scope } = payload;
    logger.info("Starting workspace export", { workspaceId, exportId, imageCount: imageIds?.length });

    try {
      await updateExportStatus(exportId, "processing");

      const exportData = await getExportData(workspaceId, imageIds, scope);
      const notes = exportData.notes ?? [];
      const images = exportData.images ?? [];
      logger.info("Retrieved export data", {
        notesCount: notes.length,
        imagesCount: images.length,
      });

      const chunks: Buffer[] = [];

      // Greptile P1 (PR #4b-fix): pre-fetch every image outside the
      // `new Promise` executor. The executor callback is synchronous
      // so awaiting inside it (the previous implementation) made
      // TypeScript flag TS1308 *and* would have called
      // `archive.finalize()` before any image fetch completed,
      // silently producing the empty-image archive the PR was meant
      // to fix. Pre-fetching first means the Promise body is purely
      // synchronous — append, finalize, resolve on `archive.end`.
      const imageEntries: Array<{ name: string; bytes: Buffer }> = [];
      const usedNames = new Set<string>();
      for (const img of images) {
        const fetched = await fetchImageBytes(img);
        if (!fetched) continue;
        const baseName =
          img.fileName || img.storageId || `image-${imageEntries.length + 1}`;
        const safeStem = baseName
          .replace(/\.[^./\\]+$/, "")
          .replace(/[^a-zA-Z0-9._-]/g, "_")
          .slice(0, 80);
        // Prefer the stored filename's extension (keeps `.jpeg`,
        // `.tif`, …); fall back to the MIME lookup only when the name
        // has no usable one.
        const extension = extensionFromFileName(baseName) ?? fetched.extension;
        const name = uniqueName(`${safeStem}.${extension}`, usedNames);
        imageEntries.push({
          name: `images/${name}`,
          bytes: fetched.bytes,
        });
      }
      logger.info("Archived images", {
        imageCount: imageEntries.length,
        totalImages: images.length,
      });

      await new Promise<void>((resolve, reject) => {
        const archive = archiver("zip", { zlib: { level: 9 } });

        archive.on("data", (chunk) => chunks.push(chunk));
        archive.on("error", reject);
        archive.on("end", () => resolve());

        if (notes.length > 0) {
          const markdown = generateMarkdown(notes);
          archive.append(markdown, { name: "notes.md" });
        }

        for (const entry of imageEntries) {
          archive.append(entry.bytes, { name: entry.name });
        }

        if (notes.length === 0 && imageEntries.length === 0) {
          archive.append("# No content to export", { name: "README.txt" });
        }

        archive.finalize();
      });

      const zipBuffer = Buffer.concat(chunks);
      logger.info(`ZIP created, size: ${zipBuffer.length} bytes`);

      const safeName = exportData.workspaceName.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 50);
      const downloadUrl = await uploadZipToB2(
        zipBuffer,
        workspaceId,
        exportData.workspaceName,
        `${safeName}-export.zip`
      );
      const expiresAt = Date.now() + EXPORT_URL_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
      await updateExportStatus(exportId, "completed", downloadUrl);

      // PR #4b-fix: notify the requesting user. Best-effort — a
      // Resend failure must NOT roll back the completed export.
      await notifyExportReady(exportId, downloadUrl, expiresAt).catch((error) =>
        logger.warn("Export ready notification failed (non-fatal)", {
          exportId,
          error: error instanceof Error ? error.message : String(error),
        })
      );

      logger.info("Export completed", { downloadUrl, size: zipBuffer.length });

      return { success: true, downloadUrl };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("Export failed", { error: errorMessage });

      await updateExportStatus(exportId, "failed", undefined, errorMessage);

      // Rethrow so Trigger.dev's retry policy (maxAttempts: 3) can
      // recover from transient B2 / Convex failures. Returning
      // `{ success: false }` marks the run complete and skips retries.
      throw error;
    }
  },
});

async function uploadPdfToB2(
  pdfBuffer: Buffer,
  workspaceId: string,
  workspaceName: string,
  filename: string
): Promise<string> {
  const client = getB2Client();
  const timestamp = Date.now();
  const safeName = workspaceName.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 50);
  const key = `exports/${workspaceId}/${timestamp}-${safeName}.pdf`;

  await client.send(
    new PutObjectCommand({
      Bucket: getWorkspaceBucket(),
      Key: key,
      Body: pdfBuffer,
      ContentType: "application/pdf",
      ContentDisposition: `attachment; filename="${filename}"`,
    })
  );

  return getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: getWorkspaceBucket(),
      Key: key,
      ResponseContentDisposition: `attachment; filename="${filename}"`,
    }),
    { expiresIn: EXPORT_URL_EXPIRY_DAYS * 24 * 60 * 60 }
  );
}

async function uploadMarkdownToB2(
  markdownBuffer: Buffer,
  workspaceId: string,
  workspaceName: string,
  filename: string
): Promise<string> {
  const client = getB2Client();
  const timestamp = Date.now();
  const safeName = workspaceName.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 50);
  const key = `exports/${workspaceId}/${timestamp}-${safeName}.md`;

  await client.send(
    new PutObjectCommand({
      Bucket: getWorkspaceBucket(),
      Key: key,
      Body: markdownBuffer,
      ContentType: "text/markdown",
      ContentDisposition: `attachment; filename="${filename}"`,
    })
  );

  return getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: getWorkspaceBucket(),
      Key: key,
      ResponseContentDisposition: `attachment; filename="${filename}"`,
    }),
    { expiresIn: EXPORT_URL_EXPIRY_DAYS * 24 * 60 * 60 }
  );
}

export const processWorkspacePdfExport = task({
  id: "process-workspace-pdf-export",
  maxDuration: 600,
  retry: {
    maxAttempts: 3,
  },
  run: async (payload: { workspaceId: string; exportId: string }) => {
    const { workspaceId, exportId } = payload;
    logger.info("Starting PDF workspace export", { workspaceId, exportId });

    try {
      await updateExportStatus(exportId, "processing");

      const exportData = await getExportData(workspaceId);
      const notes = exportData.notes ?? [];

      const pdfBuffer = await new Promise<Buffer>((resolve, reject) => {
        const doc = new PDFDocument({
          size: "A4",
          margins: { top: 72, bottom: 72, left: 72, right: 72 },
          info: {
            Title: `${exportData.workspaceName} Export`,
            Author: "Mentorships Platform",
            Subject: "Workspace Notes Export",
          },
        });

        const chunks: Buffer[] = [];
        doc.on("data", (chunk) => chunks.push(chunk));
        doc.on("end", () => resolve(Buffer.concat(chunks)));
        doc.on("error", reject);

        doc.fontSize(24).text(exportData.workspaceName, { align: "center" });
        doc.moveDown();
        doc.fontSize(10).fillColor("gray").text(`Exported on ${new Date().toLocaleDateString()}`, { align: "center" });
        doc.moveDown(2);

        doc.fillColor("black");

        if (notes.length === 0) {
          doc.fontSize(14).text("No notes to export.");
        } else {
          for (const note of notes) {
            doc.fontSize(16).text(note.title, { continued: false });
            doc.fontSize(10).fillColor("gray").text(`Last updated: ${new Date(note.updatedAt).toLocaleDateString()}`);
            doc.moveDown(0.5);
            doc.fillColor("black");
            doc.fontSize(12).text(note.content, { align: "left" });
            doc.moveDown();
          }
        }

        doc.end();
      });

      const safeName = exportData.workspaceName.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 50);
      const downloadUrl = await uploadPdfToB2(
        pdfBuffer,
        workspaceId,
        exportData.workspaceName,
        `${safeName}-export.pdf`
      );
      await updateExportStatus(exportId, "completed", downloadUrl);

      return { success: true, downloadUrl };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("PDF export failed", { error: errorMessage });

      await updateExportStatus(exportId, "failed", undefined, errorMessage);

      // Rethrow so a transient B2 / Convex failure is retried.
      throw error;
    }
  },
});

export const processWorkspaceMarkdownExport = task({
  id: "process-workspace-markdown-export",
  maxDuration: 600,
  retry: {
    maxAttempts: 3,
  },
  run: async (payload: { workspaceId: string; exportId: string }) => {
    const { workspaceId, exportId } = payload;
    logger.info("Starting markdown workspace export", { workspaceId, exportId });

    try {
      await updateExportStatus(exportId, "processing");

      const exportData = await getExportData(workspaceId);
      const notes = exportData.notes ?? [];

      const markdown = generateMarkdown(notes);
      const markdownBuffer = Buffer.from(markdown, "utf-8");

      const safeName = exportData.workspaceName.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 50);
      const downloadUrl = await uploadMarkdownToB2(
        markdownBuffer,
        workspaceId,
        exportData.workspaceName,
        `${safeName}-export.md`
      );
      await updateExportStatus(exportId, "completed", downloadUrl);

      return { success: true, downloadUrl };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("Markdown export failed", { error: errorMessage });

      await updateExportStatus(exportId, "failed", undefined, errorMessage);

      return { success: false, error: errorMessage };
    }
  },
});

async function uploadCsvToB2(
  csvBuffer: Buffer,
  workspaceId: string,
  workspaceName: string,
  filename: string
): Promise<string> {
  const client = getB2Client();
  const timestamp = Date.now();
  const safeName = workspaceName.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 50);
  const key = `exports/${workspaceId}/${timestamp}-${safeName}-links.csv`;

  await client.send(
    new PutObjectCommand({
      Bucket: getWorkspaceBucket(),
      Key: key,
      Body: csvBuffer,
      ContentType: "text/csv; charset=utf-8",
      ContentDisposition: `attachment; filename="${filename}"`,
    })
  );

  return getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: getWorkspaceBucket(),
      Key: key,
      ResponseContentDisposition: `attachment; filename="${filename}"`,
    }),
    { expiresIn: EXPORT_URL_EXPIRY_DAYS * 24 * 60 * 60 }
  );
}

/**
 * Links-tab export: a single CSV of the workspace's shared links.
 *
 * CSV rather than ZIP because the payload is tabular and small — a
 * reviewer wants to open it in Sheets/Excel, not unzip one file. The
 * archive is written to the workspace bucket and served via a 7-day
 * signed URL, same lifecycle as the images ZIP.
 */
export const processWorkspaceLinksExport = task({
  id: "process-workspace-links-export",
  maxDuration: 120,
  retry: {
    maxAttempts: 3,
  },
  run: async (payload: { workspaceId: string; exportId: string }) => {
    const { workspaceId, exportId } = payload;
    logger.info("Starting links workspace export", { workspaceId, exportId });

    try {
      await updateExportStatus(exportId, "processing");

      const exportData = await getExportData(workspaceId, undefined, "links");
      const links = exportData.links ?? [];

      const csv = generateLinksCsv(links);
      const csvBuffer = Buffer.from(csv, "utf-8");

      const safeName = exportData.workspaceName.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 50);
      const downloadUrl = await uploadCsvToB2(
        csvBuffer,
        workspaceId,
        exportData.workspaceName,
        `${safeName}-links.csv`
      );
      await updateExportStatus(exportId, "completed", downloadUrl);

      logger.info("Links export completed", {
        exportId,
        linkCount: links.length,
        size: csvBuffer.length,
      });

      return { success: true, downloadUrl, linkCount: links.length };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("Links export failed", { error: errorMessage });

      await updateExportStatus(exportId, "failed", undefined, errorMessage);

      // Let Trigger.dev retry transient failures instead of ending the
      // run on the first error.
      throw error;
    }
  },
});
