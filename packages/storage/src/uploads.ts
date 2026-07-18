import {
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  ListPartsCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getB2Client, B2_BUCKET_NAME } from "./client";

export interface UploadInit {
  fileId: string;
  uploadId: string;
  key: string;
  partSize: number;
  partCount: number;
  presignedUrls: string[];
}

export interface UploadPart {
  partNumber: number;
  etag: string;
}

const DEFAULT_PART_SIZE = 100 * 1024 * 1024; // 100MB
const MAX_PARTS = 200;
const URL_EXPIRY_SECONDS = 3600; // 1 hour

function generateKey(instructorId: string, fileId: string, filename: string): string {
  const safeSegment = (s: string) => s.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100);
  const sanitizedFilename = filename.replace(/[^a-zA-Z0-9.-]/g, "_");
  const date = new Date().toISOString().split("T")[0];
  return `${date}/${safeSegment(instructorId)}/${safeSegment(fileId)}/${sanitizedFilename}`;
}

export async function initiateMultipartUpload(params: {
  fileId: string;
  filename: string;
  contentType: string;
  size: number;
  instructorId: string;
}): Promise<UploadInit> {
  const client = getB2Client();
  const key = generateKey(params.instructorId, params.fileId, params.filename);
  
  if (!Number.isFinite(params.size) || params.size <= 0) {
    throw new Error("Invalid file size");
  }
  
  const partSize = DEFAULT_PART_SIZE;
  const partCount = Math.ceil(params.size / partSize);
  
  if (partCount > MAX_PARTS) {
    throw new Error(`File too large. Maximum ${MAX_PARTS} parts allowed.`);
  }

  const command = new CreateMultipartUploadCommand({
    Bucket: B2_BUCKET_NAME,
    Key: key,
    ContentType: params.contentType,
  });

  const response = await client.send(command);
  if (!response.UploadId) {
    throw new Error("Failed to initiate multipart upload");
  }
  const uploadId = response.UploadId;

  const presignedUrls: string[] = [];
  for (let i = 1; i <= partCount; i++) {
    const url = await getSignedUrl(
      client,
      new UploadPartCommand({
        Bucket: B2_BUCKET_NAME,
        Key: key,
        UploadId: uploadId,
        PartNumber: i,
      }),
      { expiresIn: URL_EXPIRY_SECONDS }
    );
    presignedUrls.push(url);
  }

  return {
    fileId: params.fileId,
    uploadId,
    key,
    partSize,
    partCount,
    presignedUrls,
  };
}

export async function getPresignedPartUrl(params: {
  key: string;
  uploadId: string;
  partNumber: number;
}): Promise<string> {
  const client = getB2Client();
  
  return getSignedUrl(
    client,
    new UploadPartCommand({
      Bucket: B2_BUCKET_NAME,
      Key: params.key,
      UploadId: params.uploadId,
      PartNumber: params.partNumber,
    }),
    { expiresIn: URL_EXPIRY_SECONDS }
  );
}

export async function completeMultipartUpload(params: {
  key: string;
  uploadId: string;
  parts: UploadPart[];
}): Promise<{ location: string; etag: string; versionId: string }> {
  const client = getB2Client();

  const actualParts = await listUploadedParts({ key: params.key, uploadId: params.uploadId });

  const sortedParts = [...params.parts].sort((a, b) => a.partNumber - b.partNumber);

  const command = new CompleteMultipartUploadCommand({
    Bucket: B2_BUCKET_NAME,
    Key: params.key,
    UploadId: params.uploadId,
    MultipartUpload: {
      Parts: sortedParts.map((part) => {
        const actualPart = actualParts.find(p => p.partNumber === part.partNumber);
        return {
          ETag: actualPart?.etag || part.etag,
          PartNumber: part.partNumber,
        };
      }),
    },
  });

  const response = await client.send(command);
  return {
    location: response.Location!,
    etag: response.ETag!,
    versionId: response.VersionId || "",
  };
}

export async function abortMultipartUpload(params: {
  key: string;
  uploadId: string;
}): Promise<void> {
  const client = getB2Client();

  await client.send(
    new AbortMultipartUploadCommand({
      Bucket: B2_BUCKET_NAME,
      Key: params.key,
      UploadId: params.uploadId,
    })
  );
}

export async function listUploadedParts(params: {
  key: string;
  uploadId: string;
}): Promise<UploadPart[]> {
  const client = getB2Client();

  const response = await client.send(
    new ListPartsCommand({
      Bucket: B2_BUCKET_NAME,
      Key: params.key,
      UploadId: params.uploadId,
    })
  );

  return (response.Parts || []).map((part) => ({
    partNumber: part.PartNumber!,
    etag: part.ETag!,
  })) as UploadPart[];
}

export async function getUploadDestination(key: string): Promise<string> {
  const client = getB2Client();

  return getSignedUrl(
    client,
    new PutObjectCommand({
      Bucket: B2_BUCKET_NAME,
      Key: key,
    }),
    { expiresIn: URL_EXPIRY_SECONDS }
  );
}

interface B2Auth {
  accountId: string;
  authorizationToken: string;
  apiUrl: string;
  bucketId?: string;
}

let b2AuthCache: B2Auth | null = null;
let b2AuthCacheTime: number = 0;
const B2_AUTH_CACHE_TTL = 3600_000; // 1 hour

export async function getB2Auth(): Promise<B2Auth> {
  if (b2AuthCache && Date.now() - b2AuthCacheTime < B2_AUTH_CACHE_TTL) {
    return b2AuthCache;
  }

  const keyId = process.env.B2_APPLICATION_KEY_ID || process.env.B2_KEY_ID;
  const applicationKey = process.env.B2_APPLICATION_KEY;

  if (!keyId || !applicationKey) {
    throw new Error("Missing B2 credentials: B2_APPLICATION_KEY_ID (or B2_KEY_ID) and B2_APPLICATION_KEY must be set");
  }

  const credentials = Buffer.from(`${keyId}:${applicationKey}`).toString("base64");

  const response = await fetch("https://api.backblazeb2.com/b2api/v4/b2_authorize_account", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`B2 authorization failed: ${response.status} ${errorText}`);
  }

  const data = await response.json() as { accountId: string; authorizationToken: string; apiUrl: string; allowed: { bucketId: string } | null };

  b2AuthCache = {
    accountId: data.accountId,
    authorizationToken: data.authorizationToken,
    apiUrl: data.apiUrl,
    bucketId: data.allowed?.bucketId,
  };
  b2AuthCacheTime = Date.now();

  return b2AuthCache;
}

export async function listFileVersions(bucketId: string, prefix?: string): Promise<Array<{
  fileId: string;
  fileName: string;
  action: string;
}>> {
  const auth = await getB2Auth();
  const params = new URLSearchParams({ bucketId });
  if (prefix) params.set("prefix", prefix);
  params.set("maxFileCount", "1000");

  const allFiles: Array<{ fileId: string; fileName: string; action: string }> = [];
  let startFileId: string | undefined;
  let startFileName: string | undefined;

  while (true) {
    const fetchParams = new URLSearchParams(params);
    if (startFileId) fetchParams.set("startFileId", startFileId);
    if (startFileName) fetchParams.set("startFileName", startFileName);

    const response = await fetch(`${auth.apiUrl}/b2api/v4/b2_list_file_versions?${fetchParams}`, {
      method: "GET",
      headers: {
        Authorization: `B2 ${auth.authorizationToken}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`B2 list_file_versions failed: ${response.status} ${errorText}`);
    }

    const data = await response.json() as {
      files: Array<{ fileId: string; fileName: string; action: string }>;
      nextFileId?: string;
      nextFileName?: string;
    };

    allFiles.push(...data.files);

    if (!data.nextFileId || !data.nextFileName) {
      break;
    }
    startFileId = data.nextFileId;
    startFileName = data.nextFileName;
  }

  return allFiles;
}

export async function deleteFileVersion(fileId: string, fileName: string): Promise<void> {
  const auth = await getB2Auth();

  const response = await fetch(`${auth.apiUrl}/b2api/v4/b2_delete_file_version`, {
    method: "POST",
    headers: {
      Authorization: `B2 ${auth.authorizationToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fileId, fileName }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`B2 delete_file_version failed: ${response.status} ${errorText}`);
  }
}

export async function deleteAllVersionsFromB2(fileName: string): Promise<{ deleted: number; errors: string[] }> {
  let bucketId = process.env.B2_BUCKET_ID;
  if (!bucketId) {
    throw new Error("B2_BUCKET_ID environment variable is required for B2 native API operations");
  }

  const versions = await listFileVersions(bucketId, fileName);
  const fileVersions = versions.filter(v => v.fileName === fileName && (v.action === "upload" || v.action === "hide"));

  const errors: string[] = [];
  let deleted = 0;

  for (const version of fileVersions) {
    try {
      await deleteFileVersion(version.fileId, fileName);
      deleted++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`Failed to delete ${version.fileId}: ${message}`);
    }
  }

  return { deleted, errors };
}

export type UploadFromUrlParams = {
  sourceUrl: string;
  key: string;
  contentType: string;
  maxBytes?: number;
};

export type UploadFromUrlResult = {
  etag: string;
  versionId: string;
  bytes: number;
};

/**
 * Streams a remote URL (typically a Daily.co presigned access-link)
 * into a Backblaze B2 object using a single `PutObjectCommand`.
 *
 * Why single-shot and not multipart: `@aws-sdk/lib-storage` is not
 * a workspace dependency and adding it pulls in a transitive set
 * we do not otherwise need. The S3 single-PUT limit is 5 GiB which
 * comfortably covers a 4-hour Daily recording at the default
 * 720p/30fps bitrate (~1–2 GiB); anything larger than `maxBytes`
 * (default 5 GiB) is rejected before any network IO so we never
 * silently chunk and lose progress on a truncated PUT.
 *
 * Streaming: `fetch` returns a `ReadableStream` and the AWS SDK
 * `Body` field accepts a web `ReadableStream` directly when the
 * runtime supports it (Node 18+ / Next.js). Backpressure is handled
 * by the SDK — chunks are pulled from the source stream at the
 * rate the SDK writes them. We DO NOT buffer the whole file in
 * memory.
 *
 * Size enforcement: `Content-Length` (when present) is checked
 * upfront. For chunked responses (no Content-Length) we wrap the
 * stream in a counting `TransformStream` that aborts as soon as the
 * cumulative byte count exceeds `maxBytes`, and surfaces the
 * rejected upload as a thrown error so the caller's retry logic
 * can act. The streamed byte count is also returned as `bytes` so
 * callers log the actual uploaded size, not the announced size.
 *
 * Failure modes:
 *  - source URL fetch fails (non-2xx): the underlying `fetch` throws
 *    and bubbles up so the caller's retry logic can act.
 *  - B2 PUT fails: AWS SDK throws `S3ServiceError` carrying the B2
 *    error class; same retry handling.
 *  - Source advertises or streams more than `maxBytes`: rejected
 *    before / during upload; never silently chunk.
 *
 * Returned `bytes` is the actual streamed byte count so callers
 * always log the real upload size regardless of `Content-Length`.
 */
export async function uploadFromUrl(
  params: UploadFromUrlParams
): Promise<UploadFromUrlResult> {
  const maxBytes = params.maxBytes ?? 5 * 1024 * 1024 * 1024;
  const response = await fetch(params.sourceUrl, { method: "GET" });
  if (!response.ok) {
    throw new Error(
      `Source fetch failed: ${response.status} ${response.statusText}`
    );
  }
  if (response.body === null) {
    throw new Error("Source response had no body");
  }

  const contentLengthHeader = response.headers.get("content-length");
  if (contentLengthHeader !== null) {
    const announced = Number.parseInt(contentLengthHeader, 10);
    if (Number.isFinite(announced) && announced > maxBytes) {
      throw new Error(
        `Source advertises ${announced} bytes; exceeds maxBytes=${maxBytes}`
      );
    }
  }

  const { stream: countedStream, totalBytes } = wrapWithByteLimit(
    response.body,
    maxBytes
  );

  const client = getB2Client();
  const command = new PutObjectCommand({
    Bucket: B2_BUCKET_NAME,
    Key: params.key,
    Body: countedStream as unknown as ReadableStream,
    ContentType: params.contentType,
  });

  const result = await client.send(command);
  return {
    etag: result.ETag ?? "",
    versionId: result.VersionId ?? "",
    bytes: totalBytes(),
  };
}

/**
 * Wraps a `ReadableStream<Uint8Array>` in a counting `TransformStream`
 * that tracks cumulative bytes and throws once `maxBytes` is exceeded.
 *
 * Without this, a chunked response (no Content-Length) can stream an
 * arbitrarily large body into a single `PutObjectCommand`, only failing
 * once the AWS SDK rejects the request after the entire body has been
 * read. This wrapper makes the size limit a true cutoff that the SDK
 * surfaces as a thrown error instead of a silent, repeated B2 PUT
 * failure.
 */
function wrapWithByteLimit(
  source: ReadableStream<Uint8Array>,
  maxBytes: number
): {
  stream: ReadableStream<Uint8Array>;
  totalBytes: () => number;
} {
  let total = 0;
  let exceeded = false;
  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      if (exceeded) {
        return;
      }
      total += chunk.byteLength;
      if (total > maxBytes) {
        exceeded = true;
        controller.error(
          new Error(
            `Source exceeded maxBytes=${maxBytes} during streaming (saw at least ${total} bytes)`
          )
        );
        return;
      }
      controller.enqueue(chunk);
    },
  });
  const stream = source.pipeThrough(transform);
  return { stream, totalBytes: () => total };
}