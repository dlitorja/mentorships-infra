import { describe, it, expect } from "vitest";
import {
  chunkFiles,
  createChunkSummary,
  updateChunkSummary,
  type BulkDownloadFile,
  type BulkDownloadJob,
} from "./bulk-download-jobs";

function file(size: number, id = "file"): BulkDownloadFile {
  return {
    fileId: id,
    b2Key: `key/${id}`,
    originalName: `${id}.mp4`,
    contentType: "video/mp4",
    size,
  };
}

describe("chunkFiles", () => {
  it("splits files by count", () => {
    const files = Array.from({ length: 45 }, (_, i) => file(100, `f${i}`));
    const chunks = chunkFiles(files, 20, 10 * 1024 * 1024 * 1024);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(20);
    expect(chunks[1]).toHaveLength(20);
    expect(chunks[2]).toHaveLength(5);
  });

  it("splits files by total bytes", () => {
    const files = [
      file(2 * 1024 * 1024 * 1024, "a"),
      file(2 * 1024 * 1024 * 1024, "b"),
      file(2 * 1024 * 1024 * 1024, "c"),
    ];
    const chunks = chunkFiles(files, 10, 5 * 1024 * 1024 * 1024);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(2);
    expect(chunks[1]).toHaveLength(1);
  });

  it("puts an oversized file in its own chunk", () => {
    const files = [
      file(1 * 1024 * 1024 * 1024, "a"),
      file(6 * 1024 * 1024 * 1024, "b"),
      file(1 * 1024 * 1024 * 1024, "c"),
    ];
    const chunks = chunkFiles(files, 10, 5 * 1024 * 1024 * 1024);
    expect(chunks).toHaveLength(3);
    expect(chunks[1]).toHaveLength(1);
    expect(chunks[1][0].fileId).toBe("b");
  });

  it("returns a single chunk when under limits", () => {
    const files = [file(100, "a"), file(200, "b")];
    const chunks = chunkFiles(files, 20, 5 * 1024 * 1024 * 1024);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toHaveLength(2);
  });

  it("returns no chunks for empty input", () => {
    const chunks = chunkFiles([], 20, 5 * 1024 * 1024 * 1024);
    expect(chunks).toHaveLength(0);
  });
});

describe("createChunkSummary / updateChunkSummary", () => {
  it("creates a summary", () => {
    const summary = createChunkSummary(2, "processing", 5);
    expect(summary).toEqual({ chunkIndex: 2, status: "processing", fileCount: 5 });
  });

  it("updates an existing summary", () => {
    const job: BulkDownloadJob = {
      jobId: "job-1",
      userId: "user-1",
      files: [],
      status: "processing",
      chunkCount: 3,
      chunks: [createChunkSummary(0, "pending", 1)],
      createdAt: 0,
    };
    updateChunkSummary(job, 0, "completed");
    expect(job.chunks[0].status).toBe("completed");
  });

  it("adds a new summary when missing", () => {
    const job: BulkDownloadJob = {
      jobId: "job-1",
      userId: "user-1",
      files: [],
      status: "processing",
      chunkCount: 3,
      chunks: [],
      createdAt: 0,
    };
    updateChunkSummary(job, 1, "failed");
    expect(job.chunks).toHaveLength(1);
    expect(job.chunks[0]).toEqual({ chunkIndex: 1, status: "failed", fileCount: 0 });
  });
});
