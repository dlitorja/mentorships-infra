'use client';

import { Id } from '@/convex/_generated/dataModel';
import type { UserRole } from '@/lib/auth-helpers';

export interface Message {
  _id: Id<'workspaceMessages'>;
  workspaceId: Id<'workspaces'>;
  userId: string;
  content: string;
  type: 'text' | 'image' | 'file' | 'system';
  // PR platform-call-bugs: when `type === 'system'`, this identifies
  // the event that produced the notice (call participant joined /
  // left). Used by `ChatMessageList` to render the appropriate label
  // and to skip the avatar / bubble / ShareLink affordances that
  // apply to user-authored messages.
  systemEventKind?: 'joined' | 'left';
  senderRole?: 'student' | 'instructor' | 'admin';
  authorDisplayName: string;
  sessionId?: Id<'sessions'>;
  // PR workspace-storage-3c follow-up: server-resolved signed GET
  // URLs for B2-hosted attachments. Populated by
  // `getWorkspaceMessagesPaginated` (and the non-paginated
  // `getWorkspaceMessages`) via `resolveChatMessageUrl`. When set,
  // the chat renderer uses these instead of treating `content` as
  // a URL — pre-PR-3c `content` was the URL itself, so legacy rows
  // (no `imageUrl` / `fileUrl`) still render via the legacy
  // content-prefix fallback inside the renderer.
  imageUrl?: string | undefined;
  fileUrl?: string | undefined;
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
  /**
   * Caller's role in the workspace. Required (PR #B round 7
   * Greptile P1: make the prop required so the privileged
   * delete affordance cannot silently fall back to the uploader
   * comparison alone). Admin and instructor can delete any chat
   * file/image message; students can delete only their own.
   */
  role: UserRole;
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
  // PR #B: returns `Promise<void>` so `DeleteChatFileDialog`'s
  // "Download then delete" branch can detect hard failure
  // (network error, non-200, timeout, abort, fallback to
  // "open in new tab") and skip the deletion. `ChatMessageList`'s
  // inline download button swallows the rejection because
  // `downloadFile` already surfaces the failure via toast.
  onDownloadFile: (url: string, fileName: string) => Promise<void>;
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
