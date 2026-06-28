'use client';

import { Id } from '@/convex/_generated/dataModel';

export interface UploadResult {
  storageId: string;
  success: true;
}

export interface UploadError {
  success: false;
  error: string;
}

export type UploadResponse = UploadResult | UploadError;

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB
const PER_UPLOAD_CAP = 5;

export interface ImageValidationResult {
  valid: File[];
  invalid: { file: File; error: string }[];
}

export function validateImageFiles(
  files: File[],
  remainingSlots: number,
  isAdmin: boolean
): ImageValidationResult {
  const valid: File[] = [];
  const invalid: { file: File; error: string }[] = [];

  for (const file of files) {
    if (!file.type.startsWith('image/')) {
      invalid.push({ file, error: 'Only image files are supported.' });
      continue;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      invalid.push({ file, error: 'Image is too large. Maximum size is 5MB.' });
      continue;
    }
    valid.push(file);
  }

  if (!isAdmin && valid.length > PER_UPLOAD_CAP) {
    const excess = valid.splice(PER_UPLOAD_CAP);
    invalid.push(...excess.map(f => ({ file: f, error: `You can only upload up to ${PER_UPLOAD_CAP} images at a time.` })));
  }

  if (!isAdmin && valid.length > remainingSlots) {
    const excess = valid.splice(remainingSlots);
    invalid.push(...excess.map(f => ({ file: f, error: `You only have ${remainingSlots} image slots remaining.` })));
  }

  return { valid, invalid };
}

export async function uploadSingleImage(
  workspaceId: Id<'workspaces'>,
  file: File,
  generateUploadUrl: (args: { workspaceId: Id<'workspaces'> }) => Promise<string>,
  createImage: (args: { workspaceId: Id<'workspaces'>; storageId: string; imageUrl: string }) => Promise<unknown>
): Promise<UploadResponse> {
  try {
    const uploadUrl = await generateUploadUrl({ workspaceId });
    const response = await fetch(uploadUrl, {
      method: 'POST',
      headers: { 'Content-Type': file.type },
      body: file,
    });

    if (!response.ok) {
      return { success: false, error: 'Upload failed' };
    }

    const { storageId } = await response.json();
    await createImage({ workspaceId, storageId, imageUrl: '' });
    return { success: true, storageId };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Upload failed' };
  }
}

export async function uploadImageForChat(
  workspaceId: Id<'workspaces'>,
  file: File,
  generateUploadUrl: (args: { workspaceId: Id<'workspaces'> }) => Promise<string>
): Promise<UploadResponse> {
  try {
    const uploadUrl = await generateUploadUrl({ workspaceId });
    const response = await fetch(uploadUrl, {
      method: 'POST',
      headers: { 'Content-Type': file.type },
      body: file,
    });

    if (!response.ok) {
      return { success: false, error: 'Upload failed' };
    }

    const { storageId } = await response.json();
    return { success: true, storageId };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Upload failed' };
  }
}

export function createImagePreviews(files: File[]): Promise<string[]> {
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