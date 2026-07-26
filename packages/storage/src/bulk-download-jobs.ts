import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getB2Client, B2_BUCKET_NAME } from "./client";

export const BULK_DOWNLOAD_JOB_EXPIRY_HOURS = 24;

export const MAX_FILES_PER_CHUNK = 20;

export const MAX_BYTES_PER_CHUNK = 5 * 1024 * 1024 * 1024; // 5 GB

export interface BulkDownloadFile {
  fileId: string;
  b2Key: string;
  originalName: string;
  contentType: string;
  size: number;
}

export type BulkDownloadJobStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed";

export interface BulkDownloadChunkSummary {
  chunkIndex: number;
  status: BulkDownloadJobStatus;
  fileCount: number;
}

export interface BulkDownloadJob {
  jobId: string;
  userId: string;
  files: BulkDownloadFile[];
  status: BulkDownloadJobStatus;
  chunkCount: number;
  chunks: BulkDownloadChunkSummary[];
  downloadUrl?: string;
  downloadUrls?: string[];
  error?: string;
  fileCount?: number;
  totalBytes?: number;
  expiresAt?: number;
  createdAt: number;
}

export interface BulkDownloadChunk {
  jobId: string;
  parentJobId: string;
  chunkIndex: number;
  files: BulkDownloadFile[];
  status: BulkDownloadJobStatus;
  downloadUrl?: string;
  error?: string;
  fileCount?: number;
  totalBytes?: number;
  expiresAt?: number;
  createdAt: number;
}

const JOB_PREFIX = "bulk-download-jobs";

function jobKey(jobId: string): string {
  return `${JOB_PREFIX}/${jobId}.json`;
}

function chunkKey(parentJobId: string, chunkIndex: number): string {
  return `${JOB_PREFIX}/${parentJobId}/chunks/${chunkIndex}.json`;
}

function isAsyncIterable(value: unknown): value is AsyncIterable<Uint8Array> {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as { [Symbol.asyncIterator]: unknown })[Symbol.asyncIterator] === "function"
  );
}

async function streamToBuffer(body: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of body) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function getJsonObject<T>(key: string): Promise<T | null> {
  const client = getB2Client();
  try {
    const response = await client.send(
      new GetObjectCommand({
        Bucket: B2_BUCKET_NAME,
        Key: key,
      })
    );

    if (!response.Body || !isAsyncIterable(response.Body)) return null;
    const body = await streamToBuffer(response.Body);
    return JSON.parse(body.toString()) as T;
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      (error.name === "NoSuchKey" ||
        (error as { $metadata?: { httpStatusCode?: number } }).$metadata
          ?.httpStatusCode === 404)
    ) {
      return null;
    }
    throw error;
  }
}

async function putJsonObject(key: string, value: unknown): Promise<void> {
  const client = getB2Client();
  await client.send(
    new PutObjectCommand({
      Bucket: B2_BUCKET_NAME,
      Key: key,
      Body: JSON.stringify(value),
      ContentType: "application/json",
    })
  );
}

export async function getJobStatus(
  jobId: string
): Promise<BulkDownloadJob | null> {
  return getJsonObject<BulkDownloadJob>(jobKey(jobId));
}

export async function saveJobStatus(job: BulkDownloadJob): Promise<void> {
  await putJsonObject(jobKey(job.jobId), job);
}

export async function getChunkStatus(
  parentJobId: string,
  chunkIndex: number
): Promise<BulkDownloadChunk | null> {
  return getJsonObject<BulkDownloadChunk>(chunkKey(parentJobId, chunkIndex));
}

export async function saveChunkStatus(chunk: BulkDownloadChunk): Promise<void> {
  await putJsonObject(chunkKey(chunk.parentJobId, chunk.chunkIndex), chunk);
}

export function createChunkSummary(
  chunkIndex: number,
  status: BulkDownloadJobStatus,
  fileCount: number
): BulkDownloadChunkSummary {
  return { chunkIndex, status, fileCount };
}

export function updateChunkSummary(
  job: BulkDownloadJob,
  chunkIndex: number,
  status: BulkDownloadJobStatus
): void {
  const existing = job.chunks.find((c) => c.chunkIndex === chunkIndex);
  if (existing) {
    existing.status = status;
  } else {
    job.chunks.push(createChunkSummary(chunkIndex, status, 0));
  }
}

export function chunkFiles(
  files: BulkDownloadFile[],
  maxFiles: number,
  maxBytes: number
): BulkDownloadFile[][] {
  const chunks: BulkDownloadFile[][] = [];
  let currentChunk: BulkDownloadFile[] = [];
  let currentBytes = 0;

  for (const file of files) {
    // If a single file is larger than the byte cap, it gets its own chunk.
    // Callers should enforce a global max file size before this point.
    const isNewChunkNeeded =
      currentChunk.length >= maxFiles ||
      (currentBytes + file.size > maxBytes && currentChunk.length > 0);

    if (isNewChunkNeeded) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentBytes = 0;
    }

    currentChunk.push(file);
    currentBytes += file.size;
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
}

export function isChunkFailed(job: BulkDownloadJob): boolean {
  return job.chunks.some((c) => c.status === "failed");
}

export function isChunkCompleted(job: BulkDownloadJob): boolean {
  return (
    job.chunks.length > 0 && job.chunks.every((c) => c.status === "completed")
  );
}
