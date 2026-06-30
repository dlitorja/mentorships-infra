'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useDropzone } from 'react-dropzone';
import { Id } from '../../../../convex/_generated/dataModel';
import { useWorkspaceMessages, useCreateWorkspaceMessage, useCreateWorkspaceImageAndMessage, useCreateWorkspaceFileMessage, useWorkspaceImages, useCreateWorkspaceLink } from '@/lib/queries/convex/use-workspaces';
import { useConvexAction } from '@convex-dev/react-query';
import { api } from '@/convex/_generated/api';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Send, Paperclip, X, Upload, AlertCircle, RefreshCw, FileText, Download, Link as LinkIcon } from 'lucide-react';
import { clsx } from 'clsx';
import { toast } from 'sonner';
import { createImagePreviews, uploadImageForChat, uploadFileForChat, LARGE_CHAT_FILE_BYTES, MAX_CHAT_FILE_BYTES, type UploadError } from '@/lib/workspace-image-upload';
import { ChatImageLightbox } from './chat-lightbox';

const MAX_CHAT_IMAGES_PER_UPLOAD = 5;

const WORKSPACE_FILE_CAPS = {
  student: 25,
  instructor: 50,
} as const;

interface Message {
  _id: Id<'workspaceMessages'>;
  workspaceId: Id<'workspaces'>;
  userId: string;
  content: string;
  type: 'text' | 'image' | 'file';
  senderRole?: 'student' | 'instructor' | 'admin';
}

interface ImageMessageEntry {
  msg: Message;
  parsed: ParsedFileMessage;
}

interface PendingAttachment {
  file: File;
  isImage: boolean;
  preview?: string;
  error?: string;
}

interface WorkspaceImageDoc {
  _id: Id<'workspaceImages'>;
  workspaceId: Id<'workspaces'>;
  imageUrl: string;
  storageId?: string;
  createdBy: string;
  deletedAt?: number;
}

interface WorkspaceChatProps {
  workspaceId: Id<'workspaces'>;
  currentUserId: string;
  role?: 'student' | 'instructor' | 'admin';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface ParsedFileMessage {
  fileName: string;
  url: string;
}

interface DownloadError extends Error {
  skipFallback?: boolean;
}

function decodeFileName(encodedFileName: string, fallback: string): string {
  try {
    return decodeURIComponent(encodedFileName) || fallback;
  } catch {
    return encodedFileName || fallback;
  }
}

function parseFileMessage(content: string): ParsedFileMessage {
  const separatorIndex = content.indexOf('|');
  if (separatorIndex === -1) {
    return { fileName: 'Download file', url: content };
  }

  const encodedFileName = content.slice(0, separatorIndex);
  const url = content.slice(separatorIndex + 1);

  return { fileName: decodeFileName(encodedFileName, 'Download file'), url };
}

function parseImageMessage(content: string): ParsedFileMessage {
  const parsed = parseFileMessage(content);
  return parsed.fileName === 'Download file'
    ? { fileName: 'Shared image', url: parsed.url }
    : parsed;
}

function isImageFileName(fileName: string): boolean {
  return /\.(avif|gif|jpe?g|png|webp)$/i.test(fileName);
}

async function downloadFile(url: string, fileName: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  let responseStarted = false;

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      const error: DownloadError = new Error('Download failed');
      error.skipFallback = true;
      throw error;
    }

    responseStarted = true;
    const objectUrl = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = fileName;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  } catch (error) {
    console.error('Failed to download file:', error);
    const isAbort = error instanceof DOMException && error.name === 'AbortError';
    if (isAbort) {
      toast.error('Download timed out. Please try again.');
      return;
    }

    if (error instanceof Error && (error as DownloadError).skipFallback) {
      toast.error('Download failed. Please try again.');
      return;
    }

    if (responseStarted) {
      toast.error('Download was interrupted. Please try again.');
      return;
    }

    window.open(url, '_blank', 'noopener,noreferrer');
    toast.info('File opened in a new tab if your browser allowed it');
  } finally {
    clearTimeout(timeout);
  }
}

const URL_REGEX = /(?:(?:https?|ftp):\/\/)?(?:www\.)?(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+(?:com|net|org|edu|gov|mil|io|co|app|dev|xyz|gg|info|biz|me|pro|site|online|store|tech|ai|cloud|sh|vc|fm|ly|to|cm|nu|kiwi|work|life|homes|systems|group|fyi|day|cool|world|top|zone|blog|chat|mail|email|center|shop|market|media|news|press|pub|space|team|live|plus|web)\b(?:[/?#][^\s<]*)?/gi;
const TRAILING_URL_PUNCTUATION_REGEX = /[.,!?:;]+$/;

function splitUrlTrailingPunctuation(url: string): { cleanUrl: string; trailingText: string } {
  let cleanUrl = url;
  let trailingText = '';

  while (cleanUrl.length > 0) {
    const punctuation = cleanUrl.match(TRAILING_URL_PUNCTUATION_REGEX)?.[0];
    if (punctuation) {
      cleanUrl = cleanUrl.slice(0, -punctuation.length);
      trailingText = punctuation + trailingText;
      continue;
    }

    const lastChar = cleanUrl.at(-1);
    if (lastChar === ')' && (cleanUrl.match(/\)/g)?.length ?? 0) > (cleanUrl.match(/\(/g)?.length ?? 0)) {
      cleanUrl = cleanUrl.slice(0, -1);
      trailingText = ')' + trailingText;
      continue;
    }

    if (lastChar === ']' && (cleanUrl.match(/\]/g)?.length ?? 0) > (cleanUrl.match(/\[/g)?.length ?? 0)) {
      cleanUrl = cleanUrl.slice(0, -1);
      trailingText = ']' + trailingText;
      continue;
    }

    break;
  }

  return { cleanUrl, trailingText };
}

function isEmailDomainMatch(content: string, index: number): boolean {
  return index > 0 && content[index - 1] === '@';
}

function normalizeUrl(url: string): string {
  if (!url.match(/^(https?|ftp):\/\//i)) {
    return 'https://' + url;
  }
  return url;
}

function extractUrls(content: string): string[] {
  const matches = [...content.matchAll(URL_REGEX)]
    .filter((match) => !isEmailDomainMatch(content, match.index ?? 0))
    .map((match) => splitUrlTrailingPunctuation(match[0]).cleanUrl);
  return [...new Set(matches)];
}

function renderMessageWithLinks(content: string): React.ReactNode {
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;

  for (const match of content.matchAll(URL_REGEX)) {
    const { cleanUrl, trailingText } = splitUrlTrailingPunctuation(match[0]);
    const index = match.index ?? 0;
    if (isEmailDomainMatch(content, index)) {
      continue;
    }

    if (index > lastIndex) {
      nodes.push(content.slice(lastIndex, index));
    }

    nodes.push(
      <a
        key={`${cleanUrl}-${index}`}
        href={normalizeUrl(cleanUrl)}
        target="_blank"
        rel="noopener noreferrer"
        className="text-foreground underline hover:opacity-80 break-all"
      >
        {cleanUrl}
      </a>
    );
    if (trailingText) {
      nodes.push(trailingText);
    }

    lastIndex = index + match[0].length;
  }

  if (lastIndex < content.length) {
    nodes.push(content.slice(lastIndex));
  }

  return nodes;
}

interface ShareLinkButtonProps {
  urls: string[];
  workspaceId: Id<'workspaces'>;
}

function ShareLinkButton({ urls, workspaceId }: ShareLinkButtonProps) {
  const createLink = useCreateWorkspaceLink();
  const [sharedUrls, setSharedUrls] = useState<Set<string>>(new Set());

  const handleShare = async (url: string) => {
    try {
      const normalizedUrl = normalizeUrl(url);
      await createLink.mutateAsync({
        workspaceId,
        url: normalizedUrl,
      });
      setSharedUrls((prev) => new Set(prev).add(normalizedUrl));
      toast.success('Link shared to Links tab');
    } catch (error) {
      console.error('Failed to share link:', error);
      toast.error('Failed to share link');
    }
  };

  if (urls.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {urls.map((url, index) => {
        const isShared = sharedUrls.has(normalizeUrl(url));
        return (
          <Button
            key={index}
            variant="ghost"
            size="sm"
            className="h-6 text-xs py-0 px-1.5"
            onClick={() => handleShare(url)}
            disabled={isShared || createLink.isPending}
          >
            <LinkIcon className="h-3 w-3 mr-0.5" />
            {isShared ? 'Shared' : 'Share to Links'}
          </Button>
        );
      })}
    </div>
  );
}

export default function WorkspaceChat({ workspaceId, currentUserId, role = 'student' }: WorkspaceChatProps) {
  const [message, setMessage] = useState('');
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [retryingIndices, setRetryingIndices] = useState<Set<number>>(new Set());
  const [downloadingFiles, setDownloadingFiles] = useState<Set<string>>(new Set());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: messages, isLoading } = useWorkspaceMessages(workspaceId);
  const { data: existingImages } = useWorkspaceImages(workspaceId);
  const createMessage = useCreateWorkspaceMessage();
  const createImageAndMessage = useCreateWorkspaceImageAndMessage();
  const createFileMessage = useCreateWorkspaceFileMessage();
  const generateUploadUrl = useConvexAction(api.workspaceActions.generateWorkspaceImageUploadUrl);

  const isAdmin = role === 'admin';
  const currentCount = (existingImages as WorkspaceImageDoc[] | undefined)?.filter((img) => !img.deletedAt).length || 0;
  const remainingSlots = isAdmin ? 999 : 500 - currentCount;
  const currentFileCount = (messages as Message[] | undefined)?.filter(
    (msg) => msg.type === 'file' && (msg.senderRole === role || msg.senderRole === undefined)
  ).length || 0;
  const pendingFileCount = attachments.filter((attachment) => !attachment.isImage).length;
  const remainingFileSlots = isAdmin
    ? Number.MAX_SAFE_INTEGER
    : (role === 'instructor' ? WORKSPACE_FILE_CAPS.instructor : WORKSPACE_FILE_CAPS.student) - currentFileCount - pendingFileCount;
  const imageMessages = useMemo<ImageMessageEntry[]>(() => {
    const result: ImageMessageEntry[] = [];
    for (const msg of (messages as Message[] | undefined) ?? []) {
      if (msg.type === 'image') {
        result.push({ msg, parsed: parseImageMessage(msg.content) });
      } else if (msg.type === 'file') {
        const parsed = parseFileMessage(msg.content);
        if (isImageFileName(parsed.fileName)) {
          result.push({ msg, parsed });
        }
      }
    }
    return result;
  }, [messages]);
  const chatImages = useMemo(() => imageMessages.map(({ parsed }) => (
    parsed.url
  )), [imageMessages]);
  const chatImageDownloads = useMemo(() => imageMessages.map(({ msg, parsed }) => {
    if (msg.type !== 'file') return null;
    return { ...parsed, isDownloading: downloadingFiles.has(parsed.url) };
  }), [downloadingFiles, imageMessages]);
  const failedCount = attachments.filter((attachment) => attachment.error).length;

  useEffect(() => {
    if (messages && messages.length > 0) {
      const timeout = setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ block: "end" });
      }, 100);
      return () => clearTimeout(timeout);
    }
  }, [messages]);

  const handleSendMessage = async () => {
    if (!message.trim() || !workspaceId) return;

    try {
      await createMessage.mutateAsync({
        workspaceId,
        userId: currentUserId,
        content: message.trim(),
        type: 'text',
      });
      setMessage('');
    } catch (error) {
      console.error('Failed to send message:', error);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const processFiles = useCallback(async (files: File[]) => {
    const imageFiles = files.filter((file) => file.type.startsWith('image/'));
    const otherFiles = files.filter((file) => !file.type.startsWith('image/'));
    const newAttachments: PendingAttachment[] = [];

    if (imageFiles.length > 0) {
      const validImages: File[] = [];
      let availableImageSlots = isAdmin ? 9999 : remainingSlots - attachments.filter((attachment) => attachment.isImage).length;

      for (const file of imageFiles) {
        if (file.size > MAX_CHAT_FILE_BYTES) {
          toast.error(`${file.name}: Image is too large. Maximum size is 50MB.`);
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
  }, [attachments, isAdmin, remainingFileSlots, remainingSlots, role]);

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
        });
      } else {
        await createFileMessage.mutateAsync({
          workspaceId,
          storageId: uploadResult.storageId as Id<'_storage'>,
          fileName: attachment.file.name,
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

  const openImageLightbox = (messageId: Id<'workspaceMessages'>) => {
    const index = imageMessages.findIndex(({ msg }) => msg._id === messageId);
    setLightboxIndex(index === -1 ? 0 : index);
    setLightboxOpen(true);
  };

  const handleDownloadFile = useCallback(async (url: string, fileName: string) => {
    if (downloadingFiles.has(url)) return;

    setDownloadingFiles((prev) => new Set(prev).add(url));
    try {
      await downloadFile(url, fileName);
    } finally {
      setDownloadingFiles((prev) => {
        const next = new Set(prev);
        next.delete(url);
        return next;
      });
    }
  }, [downloadingFiles]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div {...getRootProps()} className={clsx(
      'relative h-full flex flex-col rounded-lg border-2 transition-colors',
      isDragActive ? 'border-primary bg-primary/5' : 'border-transparent'
    )}>
      <input {...getInputProps()} />

      {isDragActive && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/90 rounded-lg z-10">
          <div className="text-center">
            <Upload className="h-12 w-12 mx-auto mb-2 text-primary" />
            <p className="text-lg font-medium">Drop files here</p>
            <p className="text-sm text-muted-foreground">Release to attach</p>
          </div>
        </div>
      )}

      {/* Messages List */}
      <div className="flex-1 overflow-y-auto min-h-0 space-y-3 p-2">
        {messages && messages.length > 0 ? (
          (messages as Message[]).map((msg) => {
            const fileMessage = msg.type === 'file' ? parseFileMessage(msg.content) : null;
            const imageMessage = msg.type === 'image' ? parseImageMessage(msg.content) : null;
            const fileImageMessage = fileMessage && isImageFileName(fileMessage.fileName) ? fileMessage : null;
            const displayImageMessage = imageMessage ?? fileImageMessage;
            const isFileImageDownloading = fileImageMessage ? downloadingFiles.has(fileImageMessage.url) : false;

            return (
              <div
                key={msg._id}
                className={clsx(
                  'flex',
                  msg.userId === currentUserId ? 'justify-end' : 'justify-start'
                )}
              >
                <div className={clsx(
                  'max-w-[80%] rounded-lg px-3 py-2',
                  msg.userId === currentUserId
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted'
                )}>
                  {displayImageMessage?.url ? (
                    <div className="space-y-1">
                      <button
                        type="button"
                        className="block overflow-hidden rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => openImageLightbox(msg._id)}
                      >
                        <img
                          src={displayImageMessage.url}
                          alt={displayImageMessage.fileName}
                          className="max-w-full rounded-md transition-opacity hover:opacity-90"
                        />
                      </button>
                      {displayImageMessage.fileName !== 'Shared image' && (
                        <div className="flex items-center gap-2">
                          <p className="min-w-0 flex-1 truncate text-xs opacity-80">{displayImageMessage.fileName}</p>
                          {fileImageMessage && (
                            <Button
                              type="button"
                              size="icon"
                              variant={msg.userId === currentUserId ? 'secondary' : 'outline'}
                              className="h-6 w-6 shrink-0"
                              onClick={() => void handleDownloadFile(fileImageMessage.url, fileImageMessage.fileName)}
                              disabled={isFileImageDownloading}
                              aria-label={`Download ${fileImageMessage.fileName}`}
                            >
                              {isFileImageDownloading ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Download className="h-3 w-3" />
                              )}
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  ) : msg.type === 'file' && fileMessage ? (
                    <div className={clsx(
                      'flex min-w-0 items-center gap-2 rounded-md border p-2',
                      msg.userId === currentUserId
                        ? 'border-primary-foreground/20 bg-primary-foreground/10'
                        : 'border-border bg-background/70'
                    )}>
                      <FileText className="h-5 w-5 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{fileMessage.fileName}</p>
                        <p className={clsx(
                          'text-xs',
                          msg.userId === currentUserId ? 'text-primary-foreground/70' : 'text-muted-foreground'
                        )}>
                          File attachment
                        </p>
                      </div>
                      <Button
                        asChild
                        size="icon"
                        variant={msg.userId === currentUserId ? 'secondary' : 'outline'}
                        className="h-8 w-8 shrink-0"
                      >
                        <a href={fileMessage.url} download={fileMessage.fileName} target="_blank" rel="noopener noreferrer" aria-label={`Download ${fileMessage.fileName}`}>
                          <Download className="h-4 w-4" />
                        </a>
                      </Button>
                    </div>
                  ) : (
                    <>
                      <p className="whitespace-pre-wrap">{renderMessageWithLinks(msg.content)}</p>
                      {msg.type === 'text' && <ShareLinkButton urls={extractUrls(msg.content)} workspaceId={workspaceId} />}
                    </>
                  )}
                  <p className={clsx(
                    'text-xs mt-1',
                    msg.userId === currentUserId
                      ? 'text-primary-foreground/70'
                      : 'text-muted-foreground'
                  )}>
                    {msg.userId === currentUserId ? 'You' : msg.userId.slice(0, 8)}
                  </p>
                </div>
              </div>
            );
          })
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <div className="text-center">
              <p>No messages yet</p>
              <p className="text-sm">Start the conversation!</p>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Upload Progress */}
      {isUploading && uploadProgress && (
        <div className="px-3 py-2 border-t bg-muted/50">
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">
              Uploading: {uploadProgress.current} of {uploadProgress.total} attachments
            </span>
          </div>
          <div className="mt-2 h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${(uploadProgress.current / uploadProgress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Attachment Previews */}
      {attachments.length > 0 && !isUploading && (
        <div className="p-3 border-t bg-muted/50">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">
              {failedCount > 0 ? `${failedCount} failed` : `${attachments.length} attachment${attachments.length !== 1 ? 's' : ''} ready`}
            </span>
            {failedCount > 1 && (
              <Button size="sm" variant="outline" onClick={handleRetryAll}>
                <RefreshCw className="h-3 w-3 mr-1" />
                Retry All
              </Button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {attachments.map((attachment, index) => (
              <div key={`${attachment.file.name}-${index}`} className="relative group" title={attachment.error}>
                {attachment.isImage && attachment.preview ? (
                  <img
                    src={attachment.preview}
                    alt={`Preview ${index + 1}`}
                    className={clsx(
                      'h-20 w-20 object-cover rounded-md border',
                      attachment.error ? 'border-red-500' : 'border-muted'
                    )}
                  />
                ) : (
                  <div className={clsx(
                    'h-20 w-44 rounded-md border bg-background p-2 flex items-center gap-2',
                    attachment.error ? 'border-red-500' : 'border-muted'
                  )}>
                    <FileText className="h-6 w-6 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium">{attachment.file.name}</p>
                      <p className="text-xs text-muted-foreground">{formatBytes(attachment.file.size)}</p>
                    </div>
                  </div>
                )}
                {attachment.error ? (
                  <>
                    <div className="absolute inset-0 bg-black/50 rounded-md flex items-center justify-center">
                      <AlertCircle className="h-6 w-6 text-red-500" />
                    </div>
                    <Button
                      size="icon"
                      variant="secondary"
                      className="h-6 w-6 absolute -top-2 -right-2"
                      onClick={() => handleRetryUpload(attachment, index)}
                      aria-label={`Retry uploading ${attachment.file.name}`}
                    >
                      <RefreshCw className="h-3 w-3" />
                    </Button>
                  </>
                ) : (
                  <Button
                    size="icon"
                    variant="destructive"
                    className="h-6 w-6 absolute -top-2 -right-2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => removeAttachment(index)}
                    aria-label={`Remove ${attachment.file.name} from attachments`}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                )}
              </div>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <Button size="sm" onClick={handleSendAttachments} disabled={isUploading} aria-label={`Send ${attachments.length} attachment${attachments.length !== 1 ? 's' : ''}`}>
              <Send className="h-4 w-4 mr-1" />
              Send {attachments.length} Attachment{attachments.length !== 1 ? 's' : ''}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setAttachments([])} aria-label="Cancel all attachments">
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Message Input */}
      <div className="p-3 border-t shrink-0">
        <div className="flex gap-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={handleFileSelect}
            className="hidden"
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            aria-label="Attach files"
          >
            {isUploading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Paperclip className="h-4 w-4" />
            )}
          </Button>
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            className="min-h-[44px] max-h-32 resize-none"
            rows={1}
          />
          <Button onClick={handleSendMessage} disabled={!message.trim() || createMessage.isPending} aria-label="Send message">
            <Send className="h-4 w-4" />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-2 text-center">
          Drag and drop images or files directly into the chat
        </p>
      </div>

      <ChatImageLightbox
        images={chatImages}
        downloadItems={chatImageDownloads}
        initialIndex={lightboxIndex}
        open={lightboxOpen}
        onOpenChange={setLightboxOpen}
        onDownload={handleDownloadFile}
      />
    </div>
  );
}
