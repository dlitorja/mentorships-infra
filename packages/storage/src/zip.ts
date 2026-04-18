import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getB2Client, B2_BUCKET_NAME } from "./client";
import archiver from "archiver";

interface ExportItem {
  name: string;
  data: string | Buffer;
  isBuffer?: boolean;
}

export async function createAndUploadZip(params: {
  items: ExportItem[];
  filename: string;
  workspaceId: string;
}): Promise<{ key: string; size: number }> {
  const { items, filename, workspaceId } = params;

  const date = new Date().toISOString().split("T")[0];
  const key = `exports/${date}/${workspaceId}/${filename}`;

  const client = getB2Client();

  return new Promise((resolve, reject) => {
    const archive = archiver("zip", {
      zlib: { level: 9 },
    });

    const chunks: Buffer[] = [];

    archive.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });

    archive.on("error", (err: Error) => {
      reject(err);
    });

    archive.on("end", async () => {
      try {
        const buffer = Buffer.concat(chunks);
        const size = buffer.length;

        await client.send(
          new PutObjectCommand({
            Bucket: B2_BUCKET_NAME,
            Key: key,
            Body: buffer,
            ContentType: "application/zip",
            ContentDisposition: `attachment; filename="${filename}"`,
          })
        );

        resolve({ key, size });
      } catch (error) {
        reject(error);
      }
    });

    for (const item of items) {
      if (item.isBuffer) {
        archive.append(item.data as Buffer, { name: item.name });
      } else {
        archive.append(item.data as string, { name: item.name });
      }
    }

    archive.finalize();
  });
}

export function generateExportKey(workspaceId: string, format: string): string {
  const timestamp = Date.now();
  return `exports/workspace-${workspaceId}-${timestamp}.${format}`;
}
