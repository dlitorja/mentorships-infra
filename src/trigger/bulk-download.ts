import { task, logger, tasks } from "@trigger.dev/sdk";
import {
  saveJobStatus,
  saveChunkStatus,
  chunkFiles,
  updateChunkSummary,
  createChunkSummary,
  type BulkDownloadJob,
  type BulkDownloadFile,
  MAX_FILES_PER_CHUNK,
  MAX_BYTES_PER_CHUNK,
  BULK_DOWNLOAD_JOB_EXPIRY_HOURS,
} from "@mentorships/storage";

interface ChunkResult {
  chunkIndex: number;
  downloadUrl: string;
  fileCount: number;
  totalBytes: number;
  expiresAt: number;
}

export const processBulkDownload = task({
  id: "process-bulk-download",
  maxDuration: 3600,
  run: async (payload: {
    jobId: string;
    files: BulkDownloadFile[];
    userId: string;
  }) => {
    const { jobId, files, userId } = payload;

    logger.info("Starting bulk download", {
      jobId,
      fileCount: files.length,
      totalBytes: files.reduce((sum, f) => sum + f.size, 0),
    });

    const chunks = chunkFiles(files, MAX_FILES_PER_CHUNK, MAX_BYTES_PER_CHUNK);

    const job: BulkDownloadJob = {
      jobId,
      userId,
      files,
      status: "processing",
      chunkCount: chunks.length,
      chunks: chunks.map((chunk, index) =>
        createChunkSummary(index, "pending", chunk.length)
      ),
      createdAt: Date.now(),
    };

    await saveJobStatus(job);

    // Create pending chunk records so the poll endpoint can see progress
    // even before child tasks finish.
    await Promise.all(
      chunks.map(async (chunkFiles, index) => {
        await saveChunkStatus({
          jobId: `${jobId}-${index}`,
          parentJobId: jobId,
          chunkIndex: index,
          files: chunkFiles,
          status: "pending",
          createdAt: Date.now(),
        });
      })
    );

    const batchItems = chunks.map((chunkFiles, index) => ({
      payload: {
        parentJobId: jobId,
        chunkIndex: index,
        files: chunkFiles,
      },
    }));

    try {
      const results = await tasks.batchTriggerAndWait(
        "process-bulk-download-chunk",
        batchItems
      );

      const chunkResults: ChunkResult[] = [];
      const errors: string[] = [];

      for (const result of results) {
        if (result.ok && result.output) {
          const output = result.output as ChunkResult;
          chunkResults.push(output);
          updateChunkSummary(job, output.chunkIndex, "completed");
        } else {
          const error = result.error
            ? String(result.error)
            : "Unknown chunk error";
          errors.push(error);
          const chunkIndex = results.indexOf(result);
          updateChunkSummary(job, chunkIndex, "failed");
          logger.error("Chunk failed", { jobId, chunkIndex, error });
        }
      }

      if (errors.length > 0) {
        job.status = "failed";
        job.error = `Some chunks failed: ${errors.join("; ")}`;
        await saveJobStatus(job);
        throw new Error(job.error);
      }

      chunkResults.sort((a, b) => a.chunkIndex - b.chunkIndex);

      const downloadUrls = chunkResults.map((r) => r.downloadUrl);
      const expiresAt = Math.min(...chunkResults.map((r) => r.expiresAt));
      const totalBytes = chunkResults.reduce((sum, r) => sum + r.totalBytes, 0);
      const fileCount = chunkResults.reduce((sum, r) => sum + r.fileCount, 0);

      job.status = "completed";
      job.downloadUrls = downloadUrls;
      // Keep a single URL for backward compatibility when there's only one chunk.
      if (downloadUrls.length === 1) {
        job.downloadUrl = downloadUrls[0];
      }
      job.expiresAt = expiresAt;
      job.totalBytes = totalBytes;
      job.fileCount = fileCount;
      await saveJobStatus(job);

      logger.info("Bulk download completed", {
        jobId,
        chunkCount: chunks.length,
        totalBytes,
      });

      return {
        jobId,
        status: job.status,
        downloadUrls,
        downloadUrl: job.downloadUrl,
        totalBytes,
        fileCount,
        expiresAt,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("Bulk download failed", { jobId, error: errorMessage });

      if (job.status !== "completed") {
        job.status = "failed";
        job.error = errorMessage;
        await saveJobStatus(job);
      }

      throw error;
    }
  },
});

export default processBulkDownload;
