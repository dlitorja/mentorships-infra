'use client';

import { useState, useRef, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Id } from '@/convex/_generated/dataModel';
import { toast } from 'sonner';
import { createImagePreviews, uploadImageForChat, uploadFileForChat, type UploadError } from '@/lib/workspace-image-upload';
import {
  MAX_CHAT_FILE_BYTES,
  MAX_IMAGE_BYTES,
  LARGE_CHAT_FILE_BYTES,
  MAX_CHAT_IMAGES_PER_UPLOAD,
  WORKSPACE_FILE_CAPS,
} from '@/lib/workspace-constants';
import { formatBytes } from '../utils';
import type { PendingAttachment } from '../types';
import type { UserRole } from '@/lib/auth-helpers';

interface UseChatAttachmentsOptions {
  workspaceId: Id<'workspaces'>;
  role: UserRole;
  activeSessionId: Id<'sessions'> | null;
  isLoadingWorkspace: boolean;
  isAdmin: boolean;
  remainingSlots: number;
  remainingFileSlots: number;
  createImageAndMessage: ReturnType<typeof import('@/lib/queries/convex/use-workspaces').useCreateWorkspaceImageAndMessage>;
  createFileMessage: ReturnType<typeof import('@/lib/queries/convex/use-workspaces').useCreateWorkspaceFileMessage>;
  generateUploadUrl: (...args: any[]) => Promise<string>;
}

export function useChatAttachments({
  workspaceId,
  role,
  activeSessionId,
  isLoadingWorkspace,
  isAdmin,
  remainingSlots,
  remainingFileSlots,
  createImageAndMessage,
  createFileMessage,
  generateUploadUrl,
}: UseChatAttachmentsOptions) {
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null);
  const [retryingIndices, setRetryingIndices] = useState<Set<number>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFiles = useCallback(async (files: File[]) => {
    if (isLoadingWorkspace) {
      for (const file of files) {
        toast.error(`${file.name}: Workspace image/file count is still loading.`);
      }
      return;
    }
    const imageFiles = files.filter((file) => file.type.startsWith('image/'));
    const otherFiles = files.filter((file) => !file.type.startsWith('image/'));
    const newAttachments: PendingAttachment[] = [];

    if (imageFiles.length > 0) {
      const validImages: File[] = [];
      let availableImageSlots = isAdmin ? 9999 : remainingSlots - attachments.filter((attachment) => attachment.isImage).length;

      for (const file of imageFiles) {
        if (file.size > MAX_IMAGE_BYTES) {
          toast.error(`${file.name}: Image is too large. Maximum size is 5MB.`);
          continue;
        }

        if (!isAdmin && validImages.length >= MAX_CHAT_IMAGES_PER_UPLOAD) {
          toast.error(`${file.name}: You can only upload up to ${MAX_CHAT_IMAGES_PER_UPLOAD} images at a time.`);
          continue;
        }

        if (availableImageSlots <= 0) {
          toast.error(`${file.name}: You only have ${Math.max(0, remainingSlots)} image slots remaining.`);
          continue;
        }

        if (file.size > LARGE_CHAT_FILE_BYTES) {
          toast.warning(`${file.name} is large (${formatBytes(file.size)}). Upload may take longer.`);
        }

        validImages.push(file);
        availableImageSlots -= 1;
      }

      const previews = await createImagePreviews(validImages);
      newAttachments.push(...validImages.map((file, index) => ({
        file,
        isImage: true,
        preview: previews[index],
      })));
    }

    let availableFileSlots = remainingFileSlots;
    for (const file of otherFiles) {
      if (file.size > MAX_CHAT_FILE_BYTES) {
        toast.error(`${file.name}: File is too large. Maximum size is 50MB.`);
        continue;
      }

      if (availableFileSlots <= 0) {
        const cap = role === 'instructor' ? WORKSPACE_FILE_CAPS.instructor : WORKSPACE_FILE_CAPS.student;
        toast.error(`${file.name}: File limit reached (${cap} ${role} files allowed per workspace).`);
        continue;
      }

      if (file.size > LARGE_CHAT_FILE_BYTES) {
        toast.warning(`${file.name} is large (${formatBytes(file.size)}). Upload may take longer.`);
      }

      newAttachments.push({ file, isImage: false });
      availableFileSlots -= 1;
    }

    if (newAttachments.length > 0) {
      setAttachments((prev) => [...prev, ...newAttachments]);
    }
  }, [attachments, isAdmin, isLoadingWorkspace, remainingFileSlots, remainingSlots, role]);

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    await processFiles(acceptedFiles);
  }, [processFiles]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    noClick: true,
    noKeyboard: true,
  });

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0 || !workspaceId) return;
    await processFiles(files);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const uploadAttachment = async (attachment: PendingAttachment): Promise<PendingAttachment | null> => {
    const uploadResult = attachment.isImage
      ? await uploadImageForChat(workspaceId, attachment.file, generateUploadUrl)
      : await uploadFileForChat(workspaceId, attachment.file, generateUploadUrl);

    if (!uploadResult.success) {
      return {
        ...attachment,
        error: (uploadResult as UploadError).error,
      };
    }

    try {
      if (attachment.isImage) {
        await createImageAndMessage.mutateAsync({
          workspaceId,
          storageId: uploadResult.storageId,
          // PR #4b: tag both the image and the message row to the
          // active session.
          sessionId: activeSessionId ?? undefined,
        });
      } else {
        await createFileMessage.mutateAsync({
          workspaceId,
          storageId: uploadResult.storageId as Id<'_storage'>,
          fileName: attachment.file.name,
          sessionId: activeSessionId ?? undefined,
        });
      }
      return null;
    } catch (err) {
      return {
        ...attachment,
        error: err instanceof Error ? err.message : 'Failed to create message',
      };
    }
  };

  const handleSendAttachments = async () => {
    if (attachments.length === 0 || !workspaceId) return;

    setIsUploading(true);
    setUploadProgress({ current: 0, total: attachments.length });

    const failedAttachments: PendingAttachment[] = [];

    for (let i = 0; i < attachments.length; i++) {
      setUploadProgress({ current: i + 1, total: attachments.length });
      const failedAttachment = await uploadAttachment(attachments[i]);
      if (failedAttachment) {
        failedAttachments.push(failedAttachment);
      }
    }

    setIsUploading(false);
    setUploadProgress(null);

    const successfulCount = attachments.length - failedAttachments.length;
    if (failedAttachments.length > 0) {
      setAttachments(failedAttachments);
      toast.error(`${failedAttachments.length} of ${attachments.length} attachments failed to upload. Tap to retry.`);
    } else {
      setAttachments([]);
      toast.success(`${successfulCount} attachment${successfulCount !== 1 ? 's' : ''} sent`);
    }
  };

  const handleRetryUpload = async (attachment: PendingAttachment, index: number) => {
    if (retryingIndices.has(index)) return;

    setRetryingIndices((prev) => new Set(prev).add(index));
    const failedAttachment = await uploadAttachment({ ...attachment, error: undefined });

    if (failedAttachment) {
      setAttachments((prev) => prev.map((item, itemIndex) => (
        itemIndex === index ? failedAttachment : item
      )));
      setRetryingIndices((prev) => {
        const next = new Set(prev);
        next.delete(index);
        return next;
      });
      return;
    }

    setAttachments((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
    setRetryingIndices((prev) => {
      const next = new Set(prev);
      next.delete(index);
      return next;
    });
    toast.success('Attachment uploaded successfully');
  };

  const handleRetryAll = async () => {
    const failed = [...attachments];
    setIsUploading(true);
    setUploadProgress({ current: 0, total: failed.length });

    const stillFailed: PendingAttachment[] = [];
    const indicesToTrack = new Set<number>();

    for (let i = 0; i < failed.length; i++) {
      if (retryingIndices.has(i)) continue;

      indicesToTrack.add(i);
      setRetryingIndices((prev) => new Set(prev).add(i));
      setUploadProgress({ current: i + 1, total: failed.length });
      const failedAttachment = await uploadAttachment({ ...failed[i], error: undefined });
      indicesToTrack.delete(i);
      setRetryingIndices((prev) => {
        const next = new Set(prev);
        next.delete(i);
        return next;
      });

      if (failedAttachment) {
        stillFailed.push(failedAttachment);
      }
    }

    setIsUploading(false);
    setUploadProgress(null);

    if (stillFailed.length > 0) {
      setAttachments(stillFailed);
    } else {
      setAttachments([]);
      toast.success('All attachments uploaded successfully');
    }
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
  };

  return {
    attachments,
    setAttachments,
    isUploading,
    uploadProgress,
    retryingIndices,
    fileInputRef,
    getRootProps,
    getInputProps,
    isDragActive,
    handleFileSelect,
    handleSendAttachments,
    handleRetryUpload,
    handleRetryAll,
    removeAttachment,
  };
}
