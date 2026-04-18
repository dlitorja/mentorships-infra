import { task, logger } from "@trigger.dev/sdk";
import archiver from "archiver";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { S3Client } from "@aws-sdk/client-s3";

const CONVEX_DEPLOYMENT_URL = process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_DEPLOYMENT_URL;
const CONVEX_HTTP_KEY = process.env.CONVEX_HTTP_KEY;
const B2_KEY_ID = process.env.B2_KEY_ID;
const B2_APPLICATION_KEY = process.env.B2_APPLICATION_KEY;
const B2_BUCKET_NAME = process.env.B2_BUCKET_NAME || "instructor-uploads";
const B2_REGION = process.env.B2_REGION || "us-west-002";
const B2_ENDPOINT = `https://s3.${B2_REGION}.backblazeb2.com`;

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
    images: Array<{ imageUrl: string; createdBy: string; createdAt: number }>;
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

  return `${B2_ENDPOINT}/${B2_BUCKET_NAME}/${key}`;
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
          const imagesDir: Array<{ name: string; data: string }> = [];
          
          for (let i = 0; i < exportData.images.length; i++) {
            const img = exportData.images[i];
            const dataUrl = img.imageUrl;
            const base64Data = dataUrl.split(",")[1];
            if (base64Data) {
              const ext = dataUrl.match(/data:([^;]+);/)?.[1] || "image/png";
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
          }
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
