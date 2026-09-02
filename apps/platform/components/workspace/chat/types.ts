'use client';

import { Id } from '@/convex/_generated/dataModel';
import type { UserRole } from '@/lib/auth-helpers';

export interface Message {
  _id: Id<'workspaceMessages'>;
  workspaceId: Id<'workspaces'>;
  userId: string;
  content: string;
  type: 'text' | 'image' | 'file';
  senderRole?: 'student' | 'instructor' | 'admin';
  authorDisplayName: string;
  sessionId?: Id<'sessions'>;
}

export type MessageList = Message[];

export interface ParsedFileMessage {
  fileName: string;
  url: string;
}

export interface ImageMessageEntry {
  msg: Message;
  parsed: ParsedFileMessage;
}

export interface PendingAttachment {
  file: File;
  isImage: boolean;
  preview?: string;
  error?: string;
}

export interface WorkspaceChatProps {
  workspaceId: Id<'workspaces'>;
  currentUserId: string;
  role?: UserRole;
  // PR #4b: id of the active video-call session, or null when no
  // call is active. New messages, images, and files posted during
  // the call are auto-tagged with this sessionId, and tagged
  // messages get a small dot indicator in the message list.
  activeSessionId: Id<'sessions'> | null;
}

export interface ShareLinkButtonProps {
  urls: string[];
  workspaceId: Id<'workspaces'>;
  // PR #4b: forwarded so the share-to-Links path also tags to the
  // active session when a call is in progress.
  activeSessionId: Id<'sessions'> | null;
}

export interface DownloadError extends Error {
  skipFallback?: boolean;
}

export interface ChatMessageListProps {
  messages: MessageList;
  currentUserId: string;
  activeSessionId: Id<'sessions'> | null;
  workspaceId: Id<'workspaces'>;
  paginationStatus: import('@/components/workspace/chat-data-context').ChatPaginationStatus | undefined;
  onLoadMore: () => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
  endRef: React.RefObject<HTMLDivElement | null>;
  imageMessageIds: Set<Id<'workspaceMessages'>>;
  downloadingFiles: Set<string>;
  failedInlineImages: Set<Id<'workspaceMessages'>>;
  setFailedInlineImages: React.Dispatch<React.SetStateAction<Set<Id<'workspaceMessages'>>>>;
  onOpenLightbox: (messageId: Id<'workspaceMessages'>) => void;
  onDownloadFile: (url: string, fileName: string) => void;
}

export interface ChatInputBarProps {
  message: string;
  onChangeMessage: (value: string) => void;
  onSendMessage: () => void;
  onAttachClick: () => void;
  isUploading: boolean;
  isSending: boolean;
}

export interface AttachmentPreviewsProps {
  attachments: PendingAttachment[];
  isUploading: boolean;
  onSend: () => void;
  onRetryAll: () => void;
  onCancel: () => void;
  onRemove: (index: number) => void;
  onRetry: (attachment: PendingAttachment, index: number) => void;
}

export interface ChatImageDownloadItem {
  url: string;
  fileName: string;
  isDownloading: boolean;
}
