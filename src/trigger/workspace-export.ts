import { task, logger } from "@trigger.dev/sdk";
import archiver from "archiver";
import PDFDocument from "pdfkit";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { S3Client } from "@aws-sdk/client-s3";

const CONVEX_DEPLOYMENT_URL = process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_DEPLOYMENT_URL;
const CONVEX_HTTP_KEY = process.env.CONVEX_HTTP_KEY;
const B2_KEY_ID = process.env.B2_KEY_ID;
const B2_APPLICATION_KEY = process.env.B2_APPLICATION_KEY;
const B2_BUCKET_NAME = process.env.B2_BUCKET_NAME || "instructor-uploads";
const B2_REGION = process.env.B2_REGION || "us-east-005";
const B2_ENDPOINT = process.env.B2_ENDPOINT || `https://s3.${B2_REGION}.backblazeb2.com`;
const B2_DOWNLOAD_HOST = process.env.B2_DOWNLOAD_HOST || "download.backblazeb2.com";

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
    images: Array<{ imageUrl: string; storageId?: string; createdBy: string; createdAt: number }>;
  }>;
}

async function updateExportStatus(
  exportId: string,
  status: "processing" | "completed" | "failed",
  downloadUrl?: string
) {
  const expiresAt = status === "completed"
    ? Date.now() + EXPORT_URL_EXPIRY_DAYS * 24 * 60 * 60 * 1000
    : undefined;

  return callConvexHttp("/workspace/export/update-status", {
    exportId,
    status,
    downloadUrl,
    expiresAt,
  });
}

async function uploadZipToB2(zipBuffer: Buffer, workspaceId: string, workspaceName: string): Promise<string> {
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
      ContentDisposition: `attachment; filename="${safeName}-export.zip"`,
    })
  );

  return `https://${B2_DOWNLOAD_HOST}/file/${B2_BUCKET_NAME}/${key}`;
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

export const processWorkspaceExport = task({
  id: "process-workspace-export",
  maxDuration: 600,
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

      await new Promise<void>((resolve, reject) => {
        const archive = archiver("zip", { zlib: { level: 9 } });

        archive.on("data", (chunk) => chunks.push(chunk));
        archive.on("error", reject);
        archive.on("end", () => resolve());

        if (exportData.notes.length > 0) {
          const markdown = generateMarkdown(exportData.notes);
          archive.append(markdown, { name: "notes.md" });
        }

        if (exportData.images.length > 0) {
          await (async () => {
            for (let i = 0; i < exportData.images.length; i++) {
              const img = exportData.images[i];
              const imageUrl = img.imageUrl;

              if (!imageUrl) {
                logger.warn(`Skipping image ${i + 1} - no URL available (storageId: ${img.storageId})`);
                continue;
              }

              if (imageUrl.startsWith("data:")) {
                const base64Data = imageUrl.split(",")[1];
                if (base64Data) {
                  const ext = imageUrl.match(/data:([^;]+);/)?.[1] || "image/png";
                  const mimeToExt: Record<string, string> = {
                    "image/png": "png",
                    "image/jpeg": "jpg",
                    "image/gif": "gif",
                    "image/webp": "webp",
                  };
                  const extension = mimeToExt[ext] || "png";
                  const filename = `images/image-${i + 1}.${extension}`;
                  const buffer = Buffer.from(base64Data, "base64");
                  archive.append(buffer, { name: filename });
                }
              } else if (imageUrl.startsWith("http://") || imageUrl.startsWith("https://")) {
                try {
                  const response = await fetch(imageUrl);
                  if (response.ok) {
                    const buffer = Buffer.from(await response.arrayBuffer());
                    const contentType = response.headers.get("content-type") || "image/png";
                    const mimeToExt: Record<string, string> = {
                      "image/png": "png",
                      "image/jpeg": "jpg",
                      "image/gif": "gif",
                      "image/webp": "webp",
                    };
                    const extension = mimeToExt[contentType] || "png";
                    const filename = `images/image-${i + 1}.${extension}`;
                    archive.append(buffer, { name: filename });
                    logger.info(`Added image ${i + 1} from ${imageUrl.slice(0, 50)}...`);
                  } else {
                    logger.warn(`Failed to fetch image ${i + 1}: ${response.status}`);
                  }
                } catch (fetchError) {
                  logger.warn(`Error fetching image ${i + 1}: ${fetchError}`);
                }
              }
            }
          })();
        }

        if (exportData.notes.length === 0 && exportData.images.length === 0) {
          archive.append("# No content to export", { name: "README.txt" });
        }

        archive.finalize();
      });

      const zipBuffer = Buffer.concat(chunks);
      logger.info(`ZIP created, size: ${zipBuffer.length} bytes`);

      const downloadUrl = await uploadZipToB2(
        zipBuffer,
        workspaceId,
        exportData.workspaceName
      );

      await updateExportStatus(exportId, "completed", downloadUrl);

      logger.info("Export completed", { downloadUrl, size: zipBuffer.length });

      return { success: true, downloadUrl };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("Export failed", { error: errorMessage });

      await updateExportStatus(exportId, "failed");

      return { success: false, error: errorMessage };
    }
  },
});

async function uploadPdfToB2(pdfBuffer: Buffer, workspaceId: string, workspaceName: string): Promise<string> {
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
      ContentDisposition: `attachment; filename="${safeName}-export.pdf"`,
    })
  );

  return `https://${B2_DOWNLOAD_HOST}/file/${B2_BUCKET_NAME}/${key}`;
}

async function uploadMarkdownToB2(markdownBuffer: Buffer, workspaceId: string, workspaceName: string): Promise<string> {
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
      ContentDisposition: `attachment; filename="${safeName}-export.md"`,
    })
  );

  return `https://${B2_DOWNLOAD_HOST}/file/${B2_BUCKET_NAME}/${key}`;
}

export const processWorkspacePdfExport = task({
  id: "process-workspace-pdf-export",
  maxDuration: 600,
  run: async (payload: { workspaceId: string; exportId: string }) => {
    const { workspaceId, exportId } = payload;
    logger.info("Starting workspace PDF export", { workspaceId, exportId });

    try {
      await updateExportStatus(exportId, "processing");

      const exportData = await getExportData(workspaceId);
      logger.info("Retrieved export data for PDF", {
        notesCount: exportData.notes.length,
        imagesCount: exportData.images.length,
      });

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
        }

        for (const note of exportData.notes) {
          const y = doc.y;
          doc.fontSize(16).text(note.title);
          doc.fontSize(10).fillColor("gray").text(`Last updated: ${new Date(note.updatedAt).toLocaleDateString()}`);
          doc.moveDown(0.5);
          doc.fillColor("black");
          doc.fontSize(12).text(note.content || "(empty note)", { align: "left" });
          doc.moveDown();
          doc.moveTo(72, doc.y).lineTo(523, doc.y).strokeColor("lightgray").stroke();
          doc.moveDown(2);
        }

        if (exportData.images.length > 0) {
          doc.addPage();
          doc.fontSize(18).text("Images");
          doc.moveDown();
          
          for (let i = 0; i < exportData.images.length; i++) {
            const img = exportData.images[i];
            
            if (img.imageUrl && img.imageUrl.startsWith("data:")) {
              const base64Data = img.imageUrl.split(",")[1];
              const mimeMatch = img.imageUrl.match(/data:([^;]+);/);
              const mimeType = mimeMatch ? mimeMatch[1] : "image/png";
              
              try {
                const imageBuffer = Buffer.from(base64Data, "base64");
                doc.fontSize(12).text(`Image ${i + 1} - Added ${new Date(img.createdAt).toLocaleDateString()}`, { continued: false });
                doc.image(imageBuffer, { fit: [450, 300], align: "center" });
                doc.moveDown(2);
              } catch (imgError) {
                logger.warn("Failed to embed image in PDF", { index: i, error: imgError });
                doc.fontSize(10).fillColor("gray").text(`[Image ${i + 1} - Failed to embed]`);
                doc.moveDown();
              }
            } else if (img.imageUrl) {
              doc.fontSize(12).text(`Image ${i + 1} - Added ${new Date(img.createdAt).toLocaleDateString()}`);
              doc.fontSize(10).fillColor("blue").text(img.imageUrl, { link: img.imageUrl });
              doc.moveDown();
            } else {
              doc.fontSize(12).text(`Image ${i + 1} - Added ${new Date(img.createdAt).toLocaleDateString()}`);
              doc.fontSize(10).fillColor("gray").text(`[Image stored in Convex - download ZIP for embedded file]`);
              doc.moveDown();
            }
            
            if (i < exportData.images.length - 1) {
              doc.moveDown();
            }
          }
        }

        doc.end();
      });

      logger.info(`PDF created, size: ${pdfBuffer.length} bytes`);

      const downloadUrl = await uploadPdfToB2(pdfBuffer, workspaceId, exportData.workspaceName);

      await updateExportStatus(exportId, "completed", downloadUrl);

      logger.info("PDF export completed", { downloadUrl, size: pdfBuffer.length });

      return { success: true, downloadUrl };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("PDF export failed", { error: errorMessage });

      await updateExportStatus(exportId, "failed");

      return { success: false, error: errorMessage };
    }
  },
});

export const processWorkspaceMarkdownExport = task({
  id: "process-workspace-markdown-export",
  maxDuration: 600,
  run: async (payload: { workspaceId: string; exportId: string }) => {
    const { workspaceId, exportId } = payload;
    logger.info("Starting workspace Markdown export", { workspaceId, exportId });

    try {
      await updateExportStatus(exportId, "processing");

      const exportData = await getExportData(workspaceId);
      logger.info("Retrieved export data for Markdown", {
        notesCount: exportData.notes.length,
        imagesCount: exportData.images.length,
      });

      const lines: string[] = [];

      lines.push("---");
      lines.push(`title: "${exportData.workspaceName} Export"`);
      lines.push(`date: "${new Date().toISOString()}"`);
      lines.push(`exported: "${new Date().toLocaleDateString()}"`);
      lines.push("---");
      lines.push("");
      lines.push(`# ${exportData.workspaceName}`);
      lines.push("");
      lines.push("## Notes");
      lines.push("");

      if (exportData.notes.length === 0) {
        lines.push("*No notes in this workspace.*");
        lines.push("");
      } else {
        for (const note of exportData.notes) {
          lines.push(`### ${note.title}`);
          lines.push("");
          lines.push(`*Last updated: ${new Date(note.updatedAt).toLocaleDateString()}*`);
          lines.push("");
          lines.push(note.content || "*(empty note)*");
          lines.push("");
          lines.push("---");
          lines.push("");
        }
      }

      if (exportData.images.length > 0) {
        lines.push("## Images");
        lines.push("");
        
        for (let i = 0; i < exportData.images.length; i++) {
          const img = exportData.images[i];
          const date = new Date(img.createdAt).toLocaleDateString();
          const filename = `image-${i + 1}`;
          
          if (img.imageUrl && img.imageUrl.startsWith("data:")) {
            lines.push(`### ${filename}`);
            lines.push("");
            lines.push(`*Created by ${img.createdBy.slice(0, 8)}... on ${date}*`);
            lines.push("");
            lines.push(`![${filename}](${img.imageUrl})`);
            lines.push("");
          } else if (img.storageId && CONVEX_DEPLOYMENT_URL) {
            const imageDownloadUrl = `${CONVEX_DEPLOYMENT_URL}/api/storage/${img.storageId}`;
            lines.push(`### ${filename}`);
            lines.push("");
            lines.push(`*Created by ${img.createdBy.slice(0, 8)}... on ${date}*`);
            lines.push("");
            lines.push(`![${filename}](${imageDownloadUrl})`);
            lines.push("");
          } else if (img.imageUrl) {
            lines.push(`### ${filename}`);
            lines.push("");
            lines.push(`*Created by ${img.createdBy.slice(0, 8)}... on ${date}*`);
            lines.push("");
            lines.push(`![${filename}](${img.imageUrl})`);
            lines.push("");
          }
        }
        
        lines.push("*For best image quality, download the ZIP export which includes embedded image files.*");
      }

      const markdown = lines.join("\n");
      const markdownBuffer = Buffer.from(markdown, "utf-8");

      logger.info(`Markdown created, size: ${markdownBuffer.length} bytes`);

      const downloadUrl = await uploadMarkdownToB2(markdownBuffer, workspaceId, exportData.workspaceName);

      await updateExportStatus(exportId, "completed", downloadUrl);

      logger.info("Markdown export completed", { downloadUrl, size: markdownBuffer.length });

      return { success: true, downloadUrl };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("Markdown export failed", { error: errorMessage });

      await updateExportStatus(exportId, "failed");

      return { success: false, error: errorMessage };
    }
  },
});
