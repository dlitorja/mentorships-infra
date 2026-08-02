'use client';

import { useState } from 'react';
import { Loader2, Upload } from 'lucide-react';
import { clsx } from 'clsx';
import { toast } from 'sonner';
import { useWorkspace, useWorkspaceFileCounts, useCreateWorkspaceMessage, useCreateWorkspaceImageAndMessage, useCreateWorkspaceFileMessage } from '@/lib/queries/convex/use-workspaces';
import { useConvexAction } from '@convex-dev/react-query';
import { api } from '@/convex/_generated/api';
import { ChatImageLightbox } from '../chat-lightbox';
import { WORKSPACE_IMAGE_CAPS, WORKSPACE_FILE_CAPS } from '@/lib/workspace-constants';
import { useChatMessages } from './hooks/use-chat-messages';
import { useChatAttachments } from './hooks/use-chat-attachments';
import { useLightboxImages } from './hooks/use-lightbox-images';
import { ChatMessageList } from './components/ChatMessageList';
import { ChatInputBar } from './components/ChatInputBar';
import { AttachmentPreviews } from './components/AttachmentPreviews';
import type { WorkspaceChatProps } from './types';

export default function WorkspaceChat({ workspaceId, currentUserId, role = 'student', activeSessionId }: WorkspaceChatProps) {
  const [message, setMessage] = useState('');
  const { messages, isLoading, paginationStatus, messagesContainerRef, messagesEndRef, handleLoadMore } = useChatMessages(workspaceId);
  const {
    lightboxOpen,
    setLightboxOpen,
    lightboxIndex,
    imageMessageIds,
    chatImages,
    chatImageDownloads,
    downloadingFiles,
    failedInlineImages,
    setFailedInlineImages,
    openImageLightbox,
    handleDownloadFile,
  } = useLightboxImages(messages);

  const { data: workspace, isLoading: isLoadingWorkspace } = useWorkspace(workspaceId);
  const { data: fileCounts } = useWorkspaceFileCounts(workspaceId);
  const createMessage = useCreateWorkspaceMessage();
  const createImageAndMessage = useCreateWorkspaceImageAndMessage();
  const createFileMessage = useCreateWorkspaceFileMessage();
  const generateUploadUrl = useConvexAction(api.workspaceActions.generateWorkspaceImageUploadUrl);

  const isAdmin = role === 'admin';
  const currentCount = isAdmin
    ? 0
    : (role === 'instructor'
      ? (workspace?.instructorImageCount ?? 0)
      : (workspace?.studentImageCount ?? 0));
  const remainingSlots = isAdmin
    ? WORKSPACE_IMAGE_CAPS.admin
    : (role === 'instructor' ? WORKSPACE_IMAGE_CAPS.instructor : WORKSPACE_IMAGE_CAPS.student) - currentCount;
  const currentFileCount = isAdmin
    ? 0
    : (fileCounts?.[role === 'instructor' ? 'instructor' : 'student'] ?? 0);
  const pendingFileCount = 0;
  const remainingFileSlots = isAdmin
    ? Number.MAX_SAFE_INTEGER
    : (role === 'instructor' ? WORKSPACE_FILE_CAPS.instructor : WORKSPACE_FILE_CAPS.student) - currentFileCount - pendingFileCount;

  const {
    attachments,
    setAttachments,
    isUploading,
    uploadProgress,
    fileInputRef,
    getRootProps,
    getInputProps,
    isDragActive,
    handleFileSelect,
    handleSendAttachments,
    handleRetryUpload,
    handleRetryAll,
    removeAttachment,
  } = useChatAttachments({
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
  });

  const handleSendMessage = async () => {
    if (!message.trim() || !workspaceId) return;

    try {
      await createMessage.mutateAsync({
        workspaceId,
        content: message.trim(),
        type: 'text',
        // PR #4b: tag to active call when present.
        sessionId: activeSessionId ?? undefined,
      });
      setMessage('');
    } catch (error) {
      console.error('Failed to send message:', error);
      toast.error('Failed to send message. Please try again.');
    }
  };

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

      <ChatMessageList
        messages={messages}
        currentUserId={currentUserId}
        activeSessionId={activeSessionId}
        workspaceId={workspaceId}
        paginationStatus={paginationStatus}
        onLoadMore={handleLoadMore}
        containerRef={messagesContainerRef}
        endRef={messagesEndRef}
        imageMessageIds={imageMessageIds}
        downloadingFiles={downloadingFiles}
        failedInlineImages={failedInlineImages}
        setFailedInlineImages={setFailedInlineImages}
        onOpenLightbox={openImageLightbox}
        onDownloadFile={handleDownloadFile}
      />

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

      <AttachmentPreviews
        attachments={attachments}
        isUploading={isUploading}
        onSend={handleSendAttachments}
        onRetryAll={handleRetryAll}
        onCancel={() => setAttachments([])}
        onRemove={removeAttachment}
        onRetry={handleRetryUpload}
      />

      <ChatInputBar
        message={message}
        onChangeMessage={setMessage}
        onSendMessage={handleSendMessage}
        onAttachClick={() => fileInputRef.current?.click()}
        isUploading={isUploading}
        isSending={createMessage.isPending}
      />

      <input
        ref={fileInputRef}
        type="file"
        multiple
        onChange={handleFileSelect}
        className="hidden"
      />

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
