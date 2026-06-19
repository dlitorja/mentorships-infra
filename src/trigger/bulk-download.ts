import { task, logger } from "@trigger.dev/sdk";
import archiver from "archiver";
import { PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getB2Client, B2_BUCKET_NAME } from "@mentorships/storage/src/client";
import { createWriteStream, createReadStream, mkdir, rm } from "fs";
import { pipeline } from "stream/promises";
import { tmpdir } from "os";
import { join } from "path";

const MAX_FILES_PER_REQUEST = 20;
const JOB_EXPIRY_HOURS = 24;

export interface BulkDownloadFile {
  fileId: string;
  b2Key: string;
  originalName: string;
  contentType: string;
  size: number;
}

interface BulkDownloadJob {
  jobId: string;
  userId: string;
  files: BulkDownloadFile[];
  status: "pending" | "processing" | "completed" | "failed";
  downloadUrl?: string;
  error?: string;
  createdAt: number;
  expiresAt?: number;
}

async function saveJobStatus(job: BulkDownloadJob): Promise<void> {
  const client = getB2Client();
  const key = `bulk-download-jobs/${job.jobId}.json`;

  await client.send(
    new PutObjectCommand({
      Bucket: B2_BUCKET_NAME,
      Key: key,
      Body: JSON.stringify(job),
      ContentType: "application/json",
    })
  );
}

async function getJobStatus(jobId: string): Promise<BulkDownloadJob | null> {
  const client = getB2Client();
  const key = `bulk-download-jobs/${jobId}.json`;

  try {
    const response = await client.send(
      new GetObjectCommand({
        Bucket: B2_BUCKET_NAME,
        Key: key,
      })
    );

    if (!response.Body) return null;
    const chunks: Buffer[] = [];
    for await (const chunk of response.Body as any) {
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString());
  } catch (error: any) {
    if (error.name === "NoSuchKey" || error.$metadata?.httpStatusCode === 404) {
      return null;
    }
    throw error;
  }
}

function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200);
}

export const processBulkDownload = task({
  id: "process-bulk-download",
  maxDuration: 600,
  run: async (payload: { jobId: string; files: BulkDownloadFile[]; userId: string }) => {
    const { jobId, files, userId } = payload;

    logger.info("Starting bulk download", { jobId, fileCount: files.length });

    if (files.length > MAX_FILES_PER_REQUEST) {
      throw new Error(`Too many files. Maximum is ${MAX_FILES_PER_REQUEST}`);
    }

    const job: BulkDownloadJob = {
      jobId,
      userId,
      files,
      status: "processing",
      createdAt: Date.now(),
    };

    await saveJobStatus(job);

    const tempDir = join(tmpdir(), `bulk-download-${jobId}`);
    await mkdir(tempDir, { recursive: true });

    const client = getB2Client();
    const downloadedFiles: { localPath: string; originalName: string }[] = [];

    try {
      for (const file of files) {
        const localPath = join(tempDir, `${file.fileId}-${sanitizeFilename(file.originalName)}`);

        const response = await client.send(
          new GetObjectCommand({
            Bucket: B2_BUCKET_NAME,
            Key: file.b2Key,
          })
        );

        if (!response.Body) {
          logger.warn(`Empty response for file: ${file.fileId}`);
          continue;
        }

        const writeStream = createWriteStream(localPath);
        await pipeline(response.Body as any, writeStream);

        downloadedFiles.push({
          localPath,
          originalName: file.originalName,
        });

        logger.info(`Downloaded file: ${file.fileId}`);
      }

      if (downloadedFiles.length === 0) {
        throw new Error("No files available for download");
      }

      const zipFilename = `bulk-download-${jobId}.zip`;
      const zipPath = join(tempDir, zipFilename);

      await new Promise<void>((resolve, reject) => {
        const archive = archiver("zip", { zlib: { level: 9 } });
        const output = createWriteStream(zipPath);

        output.on("close", () => {
          logger.info(`ZIP created: ${archive.pointer()} bytes`);
          resolve();
        });

        archive.on("error", (err) => {
          reject(err);
        });

        archive.pipe(output);

        for (const file of downloadedFiles) {
          archive.append(createReadStream(file.localPath), { name: file.originalName });
        }

        archive.finalize();
      });

      const zipBuffer = await Promise.resolve(
        new Promise<Buffer>((resolve, reject) => {
          const chunks: Buffer[] = [];
          const readStream = createReadStream(zipPath);
          readStream.on("data", (chunk: Buffer) => chunks.push(chunk));
          readStream.on("end", () => resolve(Buffer.concat(chunks)));
          readStream.on("error", reject);
        })
      );

      const date = new Date().toISOString().split("T")[0];
      const zipKey = `bulk-downloads/${date}/${jobId}/${zipFilename}`;

      await client.send(
        new PutObjectCommand({
          Bucket: B2_BUCKET_NAME,
          Key: zipKey,
          Body: zipBuffer,
          ContentType: "application/zip",
          ContentDisposition: `attachment; filename="${zipFilename}"`,
        })
      );

      const downloadUrl = await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: B2_BUCKET_NAME,
          Key: zipKey,
          ResponseContentDisposition: `attachment; filename="${zipFilename}"`,
        }),
        { expiresIn: JOB_EXPIRY_HOURS * 60 * 60 }
      );

      job.status = "completed";
      job.downloadUrl = downloadUrl;
      job.expiresAt = Date.now() + JOB_EXPIRY_HOURS * 60 * 60 * 1000;

      logger.info("Bulk download completed", { jobId, downloadUrl });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("Bulk download failed", { jobId, error: errorMessage });

      job.status = "failed";
      job.error = errorMessage;
    } finally {
      await saveJobStatus(job);

      try {
        await rm(tempDir, { recursive: true, force: true });
      } catch (cleanupError) {
        logger.warn("Failed to cleanup temp directory", { tempDir });
      }
    }

    return {
      jobId,
      status: job.status,
      downloadUrl: job.downloadUrl,
      error: job.error,
    };
  },
});