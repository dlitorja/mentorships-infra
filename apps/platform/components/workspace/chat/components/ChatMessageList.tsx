'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Loader2, FileText, Download, Trash2 } from 'lucide-react';
import { clsx } from 'clsx';
import { Id } from '@/convex/_generated/dataModel';
import { ShareLinkButton } from './ShareLinkButton';
import { DeleteChatFileDialog } from './DeleteChatFileDialog';
import { parseFileMessage, parseImageMessage, renderMessageWithLinks, extractUrls, isLegacyUrlContent } from '../utils';
import type { ChatMessageListProps, MessageList } from '../types';

/**
 * Hook that removes failed inline image markers when their message is no longer present.
 */
function useFailedImageCleanup(
  messages: MessageList | undefined,
  setFailedInlineImages: React.Dispatch<React.SetStateAction<Set<Id<'workspaceMessages'>>>>
) {
  useEffect(() => {
    const currentMessageIds = new Set((messages ?? []).map((msg) => msg._id));
    setFailedInlineImages((prev) => {
      const next = new Set([...prev].filter((id) => currentMessageIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [messages, setFailedInlineImages]);
}

/**
 * Scrollable list of chat messages with support for text, images, files, and active-call tagging.
 */
export function ChatMessageList({
  messages,
  currentUserId,
  role,
  activeSessionId,
  paginationStatus,
  onLoadMore,
  containerRef,
  endRef,
  imageMessageIds,
  downloadingFiles,
  failedInlineImages,
  setFailedInlineImages,
  onOpenLightbox,
  onDownloadFile,
  workspaceId,
}: ChatMessageListProps & {
  workspaceId: Id<'workspaces'>;
  setFailedInlineImages: React.Dispatch<React.SetStateAction<Set<Id<'workspaceMessages'>>>>;
}) {
  useFailedImageCleanup(messages, setFailedInlineImages);

  // PR #B: per-message delete state for chat file/image messages.
  // Single dialog instance; the parent message bubble sets the
  // pending target via setPendingDelete before opening.
  const [pendingDelete, setPendingDelete] = useState<{
    messageId: Id<'workspaceMessages'>;
    fileName: string;
    fileUrl: string;
  } | null>(null);

  const canDeleteMessage = (msg: MessageList[number]): boolean => {
    if (msg.type !== 'file' && msg.type !== 'image') return false;
    if (role === 'admin' || role === 'instructor') return true;
    return msg.userId === currentUserId;
  };

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto min-h-0 space-y-3 p-2">
      {(paginationStatus === "CanLoadMore" || paginationStatus === "LoadingMore") && (
        <div className="flex justify-center py-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onLoadMore}
            disabled={paginationStatus === "LoadingMore"}
          >
            {paginationStatus === "LoadingMore" ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : null}
            {paginationStatus === "LoadingMore" ? "Loading older messages..." : "Load older messages"}
          </Button>
        </div>
      )}
      {messages && messages.length > 0 ? (
        messages.map((msg) => {
          // PR platform-call-bugs: system messages are rendered as
          // a muted, centered notice without an avatar / bubble /
          // share-link / delete affordance. They describe the
          // participant-joined / -left event that produced them
          // (e.g. "Alex joined the call") and surface in both the
          // workspace Chat tab and the in-call Chat tab so both
          // parties see who joined / left.
          if (msg.type === 'system') {
            return (
              <div
                key={msg._id}
                className="flex justify-center"
                data-testid="chat-system-message"
                data-system-event-kind={msg.systemEventKind ?? ''}
              >
                <p className="text-xs italic text-muted-foreground">
                  {msg.content}
                </p>
              </div>
            );
          }

          const fileParsed = msg.type === 'file' ? parseFileMessage(msg.content) : null;
          const imageParsed = msg.type === 'image' ? parseImageMessage(msg.content) : null;
          // PR workspace-storage-3c follow-up: server-resolved signed
          // GET URLs from `getWorkspaceMessagesPaginated` take
          // precedence over parsing `content` directly. The legacy
          // fallback only fires when `content` actually looks like a
          // URL — pre-PR-3c rows stored the URL itself, but
          // post-PR-3c rows store either a `b2Key` (image) or
          // `${encodedFileName}|${b2Key}` (file). Treating a
          // non-URL `content` as a URL would render the storage key
          // straight into `<Image src=…>` / `<a href=…>`.
          const fileMessage = fileParsed
            ? (msg.fileUrl
              ? { fileName: fileParsed.fileName, url: msg.fileUrl }
              : isLegacyUrlContent(msg.content)
                ? fileParsed
                : null)
            : null;
          const imageMessage = imageParsed
            ? (msg.imageUrl
              ? { fileName: imageParsed.fileName, url: msg.imageUrl }
              : isLegacyUrlContent(msg.content)
                ? imageParsed
                : null)
            : null;
          const hasInlineImageFailed = failedInlineImages.has(msg._id);
          const fileImageMessage = fileMessage && imageMessageIds.has(msg._id) && !hasInlineImageFailed ? fileMessage : null;
          const displayImageMessage = imageMessage ?? fileImageMessage;
          const isFileImageDownloading = fileImageMessage ? downloadingFiles.has(fileImageMessage.url) : false;
          const isTaggedToActiveCall =
            !!activeSessionId && msg.sessionId === activeSessionId;

          return (
            <div
              key={msg._id}
              className={clsx(
                'flex',
                msg.userId === currentUserId ? 'justify-end' : 'justify-start'
              )}
            >
              <div className={clsx(
                "max-w-[80%] rounded-lg px-3 py-2 relative",
                msg.userId === currentUserId
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted"
              )}>
                {/* PR #4b: subtle dot on messages tagged to the
                 * active call. Top-right corner. */}
                {isTaggedToActiveCall && (
                  <span
                    className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-primary ring-2 ring-background"
                    title="Sent during current call"
                  />
                )}
                {displayImageMessage?.url ? (
                  <div className="space-y-1">
                    <button
                      type="button"
                      className="block overflow-hidden rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => onOpenLightbox(msg._id)}
                    >
                      <Image
                        src={displayImageMessage.url}
                        alt={displayImageMessage.fileName}
                        width={400}
                        height={300}
                        unoptimized
                        loading="lazy"
                        className="max-w-full h-auto rounded-md transition-opacity hover:opacity-90"
                        onError={() => {
                          if (fileImageMessage) {
                            setFailedInlineImages((prev) => new Set(prev).add(msg._id));
                          }
                        }}
                      />
                    </button>
                    {displayImageMessage.fileName !== 'Shared image' && (
                      <div className="flex items-center gap-2">
                        <p className="min-w-0 flex-1 truncate text-xs opacity-80">{displayImageMessage.fileName}</p>
                        {fileImageMessage && (
                          <>
                            <Button
                              type="button"
                              size="icon"
                              variant={msg.userId === currentUserId ? 'secondary' : 'outline'}
                              className="h-6 w-6 shrink-0"
                              onClick={() => {
                                // `downloadFile` now throws on hard
                                // failure (network error, non-200,
                                // timeout, abort, fallback) and
                                // surfaces the failure via toast
                                // before throwing. The dialog needs
                                // the rejection so it can skip the
                                // delete; the inline download button
                                // only needs the toast, so swallow
                                // the rejection here to avoid an
                                // unhandled promise rejection in the
                                // console.
                                onDownloadFile(fileImageMessage.url, fileImageMessage.fileName).catch(() => {});
                              }}
                              disabled={isFileImageDownloading}
                              aria-label={`Download ${fileImageMessage.fileName}`}
                            >
                              {isFileImageDownloading ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Download className="h-3 w-3" />
                              )}
                            </Button>
                            {canDeleteMessage(msg) && (
                              <Button
                                type="button"
                                size="icon"
                                variant={msg.userId === currentUserId ? 'secondary' : 'outline'}
                                className="h-6 w-6 shrink-0"
                                onClick={() => setPendingDelete({
                                  messageId: msg._id,
                                  fileName: fileImageMessage.fileName,
                                  fileUrl: fileImageMessage.url,
                                })}
                                aria-label={`Delete ${fileImageMessage.fileName}`}
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            )}
                          </>
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
                    {canDeleteMessage(msg) && (
                      <Button
                        type="button"
                        size="icon"
                        variant={msg.userId === currentUserId ? 'secondary' : 'outline'}
                        className="h-8 w-8 shrink-0"
                        onClick={() => setPendingDelete({
                          messageId: msg._id,
                          fileName: fileMessage.fileName,
                          fileUrl: fileMessage.url,
                        })}
                        aria-label={`Delete ${fileMessage.fileName}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ) : (msg.type === 'image' || msg.type === 'file') ? (
                  // PR workspace-storage-3c follow-up: image/file
                  // message with no usable URL (server did not
                  // resolve a signed URL AND the legacy
                  // `content`-as-URL fallback was unsafe). Surface
                  // a muted placeholder so we don't render the raw
                  // `b2Key` text from `content` (which would
                  // either look like a broken image link or
                  // expose the storage key in the DOM).
                  <p className={clsx(
                    'italic text-xs',
                    msg.userId === currentUserId ? 'text-primary-foreground/70' : 'text-muted-foreground'
                  )}>
                    Attachment unavailable
                  </p>
                ) : (
                  <>
                    <p className="whitespace-pre-wrap">{renderMessageWithLinks(msg.content)}</p>
                    {msg.type === 'text' && (
                      <ShareLinkButton
                        urls={extractUrls(msg.content)}
                        workspaceId={workspaceId}
                        activeSessionId={activeSessionId}
                      />
                    )}
                  </>
                )}
                <p className={clsx(
                  'text-xs mt-1',
                  msg.userId === currentUserId
                    ? 'text-primary-foreground/70'
                    : 'text-muted-foreground'
                )}>
                  {msg.userId === currentUserId ? 'You' : msg.authorDisplayName}
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
      <div ref={endRef} />
      {pendingDelete && (
        <DeleteChatFileDialog
          open={!!pendingDelete}
          onOpenChange={(open) => {
            if (!open) setPendingDelete(null);
          }}
          messageId={pendingDelete.messageId}
          fileName={pendingDelete.fileName}
          fileUrl={pendingDelete.fileUrl}
          onDownloadFile={onDownloadFile}
        />
      )}
    </div>
  );
}
