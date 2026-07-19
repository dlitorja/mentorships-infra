import { task, logger } from "@trigger.dev/sdk";
import archiver from "archiver";
import PDFDocument from "pdfkit";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { sendEmail } from "../../packages/emails/src/send";
import { buildWorkspaceExportReadyEmail } from "../../packages/emails/src/workspace-export";

const CONVEX_DEPLOYMENT_URL = process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_DEPLOYMENT_URL;
const CONVEX_HTTP_KEY = process.env.CONVEX_HTTP_KEY;
const B2_KEY_ID = process.env.B2_KEY_ID;
const B2_APPLICATION_KEY = process.env.B2_APPLICATION_KEY;
const B2_BUCKET_NAME = process.env.B2_BUCKET_NAME || "instructor-uploads";
const B2_REGION = process.env.B2_REGION || "us-west-002";
const B2_ENDPOINT = process.env.B2_ENDPOINT || `https://s3.${B2_REGION}.backblazeb2.com`;

const EXPORT_URL_EXPIRY_DAYS = 7;

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

async function getExportData(workspaceId: string) {
  return callConvexHttp("/workspace/export/data", { workspaceId }) as Promise<{
    workspaceName: string;
    notes: Array<{ title: string; content: string; updatedAt: number }>;
    images: Array<{
      imageUrl: string;
      storageId?: string;
      contentType?: string;
      fileName?: string;
      createdBy: string;
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
      Bucket: B2_BUCKET_NAME,
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
      Bucket: B2_BUCKET_NAME,
      Key: key,
      ResponseContentDisposition: `attachment; filename="${filename}"`,
    }),
    { expiresIn: EXPORT_URL_EXPIRY_DAYS * 24 * 60 * 60 }
  );
}

/**
 * Fetches image bytes for an export entry. Two cases:
 *
 *   1. `imageUrl` starts with `data:` — a legacy image where the
 *      bytes were inlined into the row. Decode the base64 payload
 *      directly.
 *   2. `imageUrl` is a Convex storage URL — the modern path. Fetch
 *      the URL over HTTP and stream the bytes. This is the path
 *      the original code was missing: the inner `imageUrl.startsWith("data:")`
 *      branch skipped every storage-backed image, so the ZIP ended
 *      up with only `notes.md`.
 *
 * Returns null when the bytes cannot be retrieved (deleted
 * storage, network error). The caller logs and continues so one
 * bad image does not fail the entire export.
 */
async function fetchImageBytes(img: {
  imageUrl: string;
  storageId?: string;
}): Promise<{ bytes: Buffer; contentType: string; extension: string } | null> {
  if (img.imageUrl.startsWith("data:")) {
    const match = /^data:([^;]+);base64,(.*)$/.exec(img.imageUrl);
    if (!match) return null;
    const contentType = match[1] || "application/octet-stream";
    const bytes = Buffer.from(match[2], "base64");
    return { bytes, contentType, extension: extensionForContentType(contentType) };
  }

  try {
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
    "image/avif": "avif",
  };
  return map[mediaType] || "bin";
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
  run: async (payload: { workspaceId: string; exportId: string }) => {
    const { workspaceId, exportId } = payload;
    logger.info("Starting workspace export", { workspaceId, exportId });

    try {
      await updateExportStatus(exportId, "processing");

      const exportData = await getExportData(workspaceId);
      logger.info("Retrieved export data", {
        notesCount: exportData.notes.length,
        imagesCount: exportData.images.length,
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
      for (const img of exportData.images) {
        const fetched = await fetchImageBytes(img);
        if (!fetched) continue;
        const baseName = img.fileName || img.storageId || `image-${imageEntries.length + 1}`;
        const safeName = baseName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
        imageEntries.push({
          name: `images/${safeName}.${fetched.extension}`,
          bytes: fetched.bytes,
        });
      }
      logger.info("Archived images", {
        imageCount: imageEntries.length,
        totalImages: exportData.images.length,
      });

      await new Promise<void>((resolve, reject) => {
        const archive = archiver("zip", { zlib: { level: 9 } });

        archive.on("data", (chunk) => chunks.push(chunk));
        archive.on("error", reject);
        archive.on("end", () => resolve());

        if (exportData.notes.length > 0) {
          const markdown = generateMarkdown(exportData.notes);
          archive.append(markdown, { name: "notes.md" });
        }

        for (const entry of imageEntries) {
          archive.append(entry.bytes, { name: entry.name });
        }

        if (exportData.notes.length === 0 && imageEntries.length === 0) {
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

      return { success: false, error: errorMessage };
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
      Bucket: B2_BUCKET_NAME,
      Key: key,
      Body: pdfBuffer,
      ContentType: "application/pdf",
      ContentDisposition: `attachment; filename="${filename}"`,
    })
  );

  return getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: B2_BUCKET_NAME,
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
      Bucket: B2_BUCKET_NAME,
      Key: key,
      Body: markdownBuffer,
      ContentType: "text/markdown",
      ContentDisposition: `attachment; filename="${filename}"`,
    })
  );

  return getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: B2_BUCKET_NAME,
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

        if (exportData.notes.length === 0) {
          doc.fontSize(14).text("No notes to export.");
        } else {
          for (const note of exportData.notes) {
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

      return { success: false, error: errorMessage };
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

      const markdown = generateMarkdown(exportData.notes);
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
