import {
  getRecordingsBucketName,
  RECORDINGS_KEY_PREFIX,
} from "./client";
import {
  getDownloadUrlWithContentDisposition,
  getStreamUrl,
} from "./downloads";
import { deleteFile, headFile, type FileMetadata } from "./files";
import { uploadFromUrl, type UploadFromUrlResult } from "./uploads";

/**
 * Recording-specific storage helpers.
 *
 * Call recordings live in a **dedicated bucket** (`RECORDINGS_BUCKET_NAME`,
 * currently `mentorship-call-storage`) that is deliberately separate from
 * `B2_BUCKET_NAME` (video-editor uploads in `huckleberry-drive-files`).
 *
 * Why a separate module rather than passing a bucket around: three
 * runtimes disagreed about `B2_BUCKET_NAME`, so live transfers wrote to
 * `instructor-uploads` while the signing path read from
 * `mentorship-call-storage`. Recordings were unplayable, and purges
 * silently no-oped because S3 `DeleteObject` returns success for a
 * missing key. Routing every recording read/write through these helpers
 * makes the bucket explicit and impossible to inherit by accident.
 *
 * `getRecordingsBucketName()` throws when `RECORDINGS_BUCKET_NAME` is
 * unset — there is intentionally no fallback.
 */

const RECORDINGS_URL_EXPIRY_SECONDS = 3600;

/**
 * Guard against a caller passing a non-recording key (e.g. a workspace
 * or instructor-upload key) into a recordings-bucket operation, which
 * would silently target the wrong object namespace.
 */
function assertRecordingKey(key: string): void {
  if (!key.startsWith(RECORDINGS_KEY_PREFIX)) {
    throw new Error(
      `Recording key must start with "${RECORDINGS_KEY_PREFIX}" (got "${key.slice(0, 80)}")`
    );
  }
}

/** Signed GET URL for in-page playback. */
export async function getRecordingStreamUrl(
  key: string,
  contentType: string,
  expiresInSeconds: number = RECORDINGS_URL_EXPIRY_SECONDS
): Promise<string> {
  assertRecordingKey(key);
  return getStreamUrl(
    key,
    contentType,
    expiresInSeconds,
    getRecordingsBucketName()
  );
}

/** Signed GET URL that forces a browser download with a clean filename. */
export async function getRecordingDownloadUrl(
  key: string,
  filename: string,
  expiresInSeconds: number = RECORDINGS_URL_EXPIRY_SECONDS
): Promise<string> {
  assertRecordingKey(key);
  return getDownloadUrlWithContentDisposition(
    key,
    filename,
    expiresInSeconds,
    getRecordingsBucketName()
  );
}

/** Stream a remote MP4 (Daily access link) into the recordings bucket. */
export async function uploadRecordingFromUrl(params: {
  sourceUrl: string;
  key: string;
  contentType: string;
  maxBytes?: number;
}): Promise<UploadFromUrlResult> {
  assertRecordingKey(params.key);
  return uploadFromUrl({ ...params, bucket: getRecordingsBucketName() });
}

/** HEAD a recording object in the recordings bucket. */
export async function headRecordingFile(
  key: string
): Promise<FileMetadata | null> {
  assertRecordingKey(key);
  return headFile(key, getRecordingsBucketName());
}

/** Delete a recording object from the recordings bucket. */
export async function deleteRecordingFromB2(key: string): Promise<void> {
  assertRecordingKey(key);
  await deleteFile(key, getRecordingsBucketName());
}

export { getRecordingsBucketName, RECORDINGS_KEY_PREFIX };
