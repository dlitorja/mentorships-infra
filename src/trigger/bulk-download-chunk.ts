import { task, logger } from "@trigger.dev/sdk";
import archiver from "archiver";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Upload } from "@aws-sdk/lib-storage";
import {
  getB2Client,
  B2_BUCKET_NAME,
  saveChunkStatus,
  type BulkDownloadChunk,
  type BulkDownloadFile,
  BULK_DOWNLOAD_JOB_EXPIRY_HOURS,
} from "@mentorships/storage";

function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200);
}

function isNodeReadableStream(value: unknown): value is NodeJS.ReadableStream {
  return (
    value !== null &&
    typeof value === "object" &&
    "pipe" in value &&
    typeof (value as { pipe: unknown }).pipe === "function"
  );
}

function buildChunkJob(
  parentJobId: string,
  chunkIndex: number,
  files: BulkDownloadFile[]
): BulkDownloadChunk {
  return {
    jobId: crypto.randomUUID(),
    parentJobId,
    chunkIndex,
    files,
    status: "pending",
    createdAt: Date.now(),
  };
}

export const processBulkDownloadChunk = task({
  id: "process-bulk-download-chunk",
  maxDuration: 3600,
  run: async (payload: {
    parentJobId: string;
    chunkIndex: number;
    files: BulkDownloadFile[];
  }) => {
    const { parentJobId, chunkIndex, files } = payload;

    logger.info("Starting bulk download chunk", {
      parentJobId,
      chunkIndex,
      fileCount: files.length,
      totalBytes: files.reduce((sum, f) => sum + f.size, 0),
    });

    const chunk: BulkDownloadChunk = buildChunkJob(
      parentJobId,
      chunkIndex,
      files
    );
    chunk.status = "processing";
    await saveChunkStatus(chunk);

    const client = getB2Client();
    const date = new Date().toISOString().split("T")[0];
    const zipKey = `bulk-downloads/${date}/${parentJobId}/chunk-${chunkIndex}.zip`;
    const zipFilename = `bulk-download-${chunkIndex}.zip`;

    const archive = archiver("zip", { store: true });

    const upload = new Upload({
      client,
      params: {
        Bucket: B2_BUCKET_NAME,
        Key: zipKey,
        Body: archive,
        ContentType: "application/zip",
        ContentDisposition: `attachment; filename="${zipFilename}"`,
      },
      partSize: 5 * 1024 * 1024,
      leavePartsOnError: false,
    });

    let uploadedBytes = 0;

    try {
      for (const file of files) {
        const response = await client.send(
          new GetObjectCommand({
            Bucket: B2_BUCKET_NAME,
            Key: file.b2Key,
          })
        );

        if (!response.Body || !isNodeReadableStream(response.Body)) {
          logger.warn(`Empty or non-streamable response for file: ${file.fileId}`);
          continue;
        }

        const safeName = sanitizeFilename(file.originalName);
        archive.append(response.Body, {
          name: safeName,
        });
        uploadedBytes += file.size;

        logger.info(`Appended file to chunk archive: ${file.fileId}`);
      }

      archive.finalize();

      await upload.done();

      const downloadUrl = await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: B2_BUCKET_NAME,
          Key: zipKey,
          ResponseContentDisposition: `attachment; filename="${zipFilename}"`,
        }),
        { expiresIn: BULK_DOWNLOAD_JOB_EXPIRY_HOURS * 60 * 60 }
      );

      const now = Date.now();
      chunk.status = "completed";
      chunk.downloadUrl = downloadUrl;
      chunk.fileCount = files.length;
      chunk.totalBytes = uploadedBytes;
      chunk.expiresAt = now + BULK_DOWNLOAD_JOB_EXPIRY_HOURS * 60 * 60 * 1000;
      await saveChunkStatus(chunk);

      logger.info("Bulk download chunk completed", {
        parentJobId,
        chunkIndex,
        zipKey,
      });

      return {
        chunkIndex,
        downloadUrl,
        fileCount: files.length,
        totalBytes: uploadedBytes,
        expiresAt: chunk.expiresAt,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("Bulk download chunk failed", {
        parentJobId,
        chunkIndex,
        error: errorMessage,
      });

      try {
        await upload.abort();
      } catch (abortError) {
        logger.warn("Failed to abort multipart upload", { abortError });
      }

      chunk.status = "failed";
      chunk.error = errorMessage;
      await saveChunkStatus(chunk);

      throw error;
    }
  },
});

export default processBulkDownloadChunk;
