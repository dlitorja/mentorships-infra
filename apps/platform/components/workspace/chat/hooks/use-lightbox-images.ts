'use client';

import { useState, useMemo, useCallback, useRef } from 'react';
import { Id } from '@/convex/_generated/dataModel';
import { downloadFile, parseFileMessage, parseImageMessage, isImageFileName, isLegacyUrlContent } from '../utils';
import type { MessageList, ImageMessageEntry, ChatImageDownloadItem } from '../types';

export function useLightboxImages(messages: MessageList | undefined) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [downloadingFiles, setDownloadingFiles] = useState<Set<string>>(new Set());
  const [failedInlineImages, setFailedInlineImages] = useState<Set<Id<'workspaceMessages'>>>(new Set());
  const downloadingFilesRef = useRef<Set<string>>(new Set());

  const imageMessages = useMemo<ImageMessageEntry[]>(() => {
    const result: ImageMessageEntry[] = [];
    for (const msg of messages ?? []) {
      // PR workspace-storage-3c follow-up: prefer the server-resolved
      // signed URL (`msg.imageUrl` / `msg.fileUrl`). The legacy
      // `content`-as-URL fallback only fires when `content` looks
      // like a URL — post-PR-3c rows store the `b2Key` literal
      // (image) or `${fileName}|${b2Key}` (file), neither of which
      // is a URL. Treating them as URLs would leak the storage key
      // into `<img src=…>` and `<a href=…>`.
      if (msg.type === 'image') {
        const parsed = parseImageMessage(msg.content);
        const url =
          msg.imageUrl ??
          (isLegacyUrlContent(msg.content) ? parsed.url : '');
        if (!url) continue;
        result.push({
          msg,
          parsed: url === parsed.url ? parsed : { fileName: parsed.fileName, url },
        });
      } else if (msg.type === 'file' && !failedInlineImages.has(msg._id)) {
        const parsed = parseFileMessage(msg.content);
        if (!isImageFileName(parsed.fileName)) continue;
        // Legacy file rows stored the URL directly in `content`
        // (no `|` separator). `parsed.url` is then the entire
        // `content` string. New rows store `${name}|${b2Key}` —
        // `parsed.url` is the `b2Key` portion.
        const url =
          msg.fileUrl ??
          (isLegacyUrlContent(msg.content) ? parsed.url : '');
        if (!url) continue;
        result.push({
          msg,
          parsed: url === parsed.url ? parsed : { fileName: parsed.fileName, url },
        });
      }
    }
    return result;
  }, [failedInlineImages, messages]);

  const chatImages = useMemo(() => imageMessages.map(({ parsed }) => (
    parsed.url
  )), [imageMessages]);
  const imageMessageIds = useMemo(() => new Set(imageMessages.map(({ msg }) => msg._id)), [imageMessages]);
  const chatImageDownloads = useMemo<Array<ChatImageDownloadItem | null>>(() => imageMessages.map(({ msg, parsed }) => {
    if (msg.type !== 'file') return null;
    return { ...parsed, isDownloading: downloadingFiles.has(parsed.url) };
  }), [downloadingFiles, imageMessages]);

  const openImageLightbox = (messageId: Id<'workspaceMessages'>) => {
    const index = imageMessages.findIndex(({ msg }) => msg._id === messageId);
    setLightboxIndex(index === -1 ? 0 : index);
    setLightboxOpen(true);
  };

  const handleDownloadFile = useCallback(async (url: string, fileName: string): Promise<void> => {
    if (downloadingFilesRef.current.has(url)) return;

    downloadingFilesRef.current.add(url);
    setDownloadingFiles(new Set(downloadingFilesRef.current));
    try {
      await downloadFile(url, fileName);
    } finally {
      downloadingFilesRef.current.delete(url);
      setDownloadingFiles(new Set(downloadingFilesRef.current));
    }
  }, []);

  return {
    lightboxOpen,
    setLightboxOpen,
    lightboxIndex,
    setLightboxIndex,
    downloadingFiles,
    downloadingFilesRef,
    failedInlineImages,
    setFailedInlineImages,
    imageMessages,
    chatImages,
    imageMessageIds,
    chatImageDownloads,
    openImageLightbox,
    handleDownloadFile,
  };
}
