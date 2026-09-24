'use client';

import { Id } from '@/convex/_generated/dataModel';

import {
  MAX_IMAGE_BYTES,
  MAX_CHAT_FILE_BYTES,
  PER_UPLOAD_CAP,
} from './workspace-constants';

/**
 * Workspace upload to Backblaze B2 (PR 1 of the workspace storage
 * migration). Mirrors `workspace-image-upload.ts` so chat and
 * gallery flows can swap between Convex storage and B2 by changing
 * which helper they import.
 *
 * Security:
 *   - The presigned PUT URL is the proof of authorization — only a
 *     caller who successfully minted an upload URL can put bytes
 *     into B2 (the URL embeds an x-amz-signature scoped to that
 *     key).
 *   - The `b2Key` is bound to the caller in `fileUploads` at mint
 *     time (eager insert). `recordB2FileUpload` re-verifies the
 *     binding is within the freshness window before the caller can
 *     pass the key into a chat-create mutation.
 */

export interface B2UploadResult {
  success: true;
  b2Key: string;
  fileId: string;
}

export interface B2UploadError {
  success: false;
  error: string;
}

export type B2UploadResponse = B2UploadResult | B2UploadError;

export interface FileValidationResult {
  valid: File[];
  invalid: { file: File; error: string }[];
}

export function validateB2Files(
  files: File[],
  remainingSlots: number,
  isAdmin: boolean
): FileValidationResult {
  const valid: File[] = [];
  const invalid: { file: File; error: string }[] = [];

  for (const file of files) {
    const isImage = file.type.startsWith('image/');
    const sizeCap = isImage ? MAX_IMAGE_BYTES : MAX_CHAT_FILE_BYTES;
    const capLabel = isImage ? '8MB' : '500MB';
    if (isImage && file.size > sizeCap) {
      invalid.push({ file, error: `Image is too large. Maximum size is ${capLabel}.` });
      continue;
    }
    if (!isImage && file.size > sizeCap) {
      invalid.push({ file, error: `File is too large. Maximum size is ${capLabel}.` });
      continue;
    }
    valid.push(file);
  }

  if (!isAdmin && valid.length > PER_UPLOAD_CAP) {
    const excess = valid.splice(PER_UPLOAD_CAP);
    invalid.push(...excess.map((f) => ({ file: f, error: `You can only upload up to ${PER_UPLOAD_CAP} files at a time.` })));
  }

  if (!isAdmin && valid.length > remainingSlots) {
    const excess = valid.splice(remainingSlots);
    invalid.push(...excess.map((f) => ({ file: f, error: `You only have ${remainingSlots} file slots remaining.` })));
  }

  return { valid, invalid };
}

/**
 * Generate a `fileId` for the B2 upload path. Caller passes it into
 * the mint action so the resulting B2 key embeds a
 * caller-controlled segment without depending on a server-side
 * crypto.randomUUID() round-trip.
 */
export function generateB2FileId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Upload a single file to the workspace's B2 bucket using a
 * presigned PUT URL minted by Convex. Returns the `b2Key` so the
 * caller can pass it to `recordB2FileUpload` and the chat-create
 * mutation.
 */
export async function uploadFileToB2(
  workspaceId: Id<'workspaces'>,
  file: File,
  generateUploadUrl: (args: {
    workspaceId: Id<'workspaces'>;
    fileId: string;
    fileName: string;
    contentType: string;
  }) => Promise<{ uploadUrl: string; b2Key: string; fileId: string }>,
  recordFileUpload?: (args: {
    workspaceId: Id<'workspaces'>;
    b2Key: string;
  }) => Promise<unknown>
): Promise<B2UploadResponse> {
  const fileId = generateB2FileId();
  try {
    const { uploadUrl, b2Key } = await generateUploadUrl({
      workspaceId,
      fileId,
      fileName: file.name,
      contentType: file.type || 'application/octet-stream',
    });

    const response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    });

    if (!response.ok) {
      return {
        success: false,
        error: `B2 upload failed (HTTP ${response.status})`,
      };
    }

    if (recordFileUpload) {
      try {
        await recordFileUpload({ workspaceId, b2Key });
      } catch (bindErr) {
        return {
          success: false,
          error:
            bindErr instanceof Error
              ? bindErr.message
              : 'Failed to record upload binding',
        };
      }
    }

    return { success: true, b2Key, fileId };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Upload failed',
    };
  }
}

/**
 * Resolve a `b2Key` to a signed GET URL. TTL bounded to 60s..24h
 * by the action.
 */
export async function resolveB2DownloadUrl(
  b2Key: string,
  workspaceId: Id<'workspaces'>,
  getDownloadUrl: (args: {
    b2Key: string;
    workspaceId: Id<'workspaces'>;
    expiresInSeconds?: number;
  }) => Promise<{ url: string; expiresAt: number }>
): Promise<{ url: string; expiresAt: number } | { error: string }> {
  try {
    return await getDownloadUrl({ b2Key, workspaceId });
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to resolve download URL' };
  }
}

/**
 * Base64 data URL previews for image files. Duplicates
 * `createImagePreviews` from `workspace-image-upload.ts` so the B2
 * helper has no implicit dependency on the legacy module.
 */
export function createB2ImagePreviews(files: File[]): Promise<string[]> {
  return Promise.all(
    files.map(
      (file) =>
        new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target?.result as string);
          reader.readAsDataURL(file);
        })
    )
  );
}
