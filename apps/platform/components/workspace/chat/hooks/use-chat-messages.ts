'use client';

import { useState, useEffect, useRef } from 'react';
import { useChatData, type ChatPaginationStatus } from '@/components/workspace/chat-data-context';
import { useWorkspaceMessagesPaginated } from '@/lib/queries/convex/use-workspaces';
import { Id } from '@/convex/_generated/dataModel';
import type { MessageList } from '../types';

export function useChatMessages(workspaceId: Id<'workspaces'>) {
  const [messages, setMessages] = useState<MessageList>([]);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const lastMessageIdRef = useRef<string | null>(null);
  const scrollBeforeLoadRef = useRef<{ scrollTop: number; scrollHeight: number } | null>(null);

  // PR #convex-egress-1: reset the first-load scroll anchor when the
  // workspace changes so the new workspace's messages are scrolled to
  // the bottom on first load. Without this, the ref persists across
  // workspace switches and the new workspace can bypass first-load
  // positioning.
  useEffect(() => {
    lastMessageIdRef.current = null;
    setMessages([]);
  }, [workspaceId]);

  // PR #4c-4: read the chat subscription from the hoisted
  // <ChatDataProvider> when it's available. The provider lives
  // outside the `{!isInCall && <WorkspaceTabs />}` gate, so its
  // observer stays alive during an active call — incoming messages
  // flow into the call overlay's chat panel without a manual
  // refresh. Fall back to a local `useWorkspaceMessagesPaginated`
  // only when the provider is missing (e.g., chat rendered outside
  // <WorkspaceContent> during unit tests or future embeds).
  //
  // PR #convex-egress-1: the provider now holds a paginated
  // subscription instead of the full unbounded list. The server
  // returns newest-first; the display array is reversed below so
  // messages render oldest-first.
  const chatData = useChatData();
  const messagesFromProvider = chatData?.messages;
  const messagesFromProviderMatch =
    !!chatData?.workspaceId &&
    chatData.workspaceId === workspaceId;
  const localMessagesQuery = useWorkspaceMessagesPaginated(
    messagesFromProviderMatch ? null : workspaceId
  );
  const messagesRaw: MessageList | undefined =
    messagesFromProviderMatch
      ? messagesFromProvider
      : (localMessagesQuery.results as MessageList | undefined);
  const isLoading = messagesFromProviderMatch
    ? chatData?.isLoading ?? false
    : localMessagesQuery.isLoading;
  const loadMore = messagesFromProviderMatch
    ? chatData?.loadMore
    : localMessagesQuery.loadMore;
  const paginationStatus: ChatPaginationStatus | undefined =
    messagesFromProviderMatch
      ? chatData?.status
      : localMessagesQuery.status;

  // The paginated query returns newest-first. Merge it into a stable
  // chronological array (oldest at the top, newest at the bottom) without
  // reversing the entire list on every render.
  useEffect(() => {
    if (!messagesRaw) return;

    setMessages((prev) => {
      if (messagesRaw.length === 0) {
        return [];
      }

      if (prev.length === 0) {
        return [...messagesRaw].reverse();
      }

      const prevIds = new Set(prev.map((m) => m._id));
      const rawIds = new Set(messagesRaw.map((m) => m._id));
      const firstExistingIndex = messagesRaw.findIndex((m) =>
        prevIds.has(m._id)
      );

      if (firstExistingIndex === -1) {
        return [...messagesRaw].reverse();
      }

      const lastExistingIndex = messagesRaw.findLastIndex((m) =>
        prevIds.has(m._id)
      );
      const newerMessages = messagesRaw.slice(0, firstExistingIndex);
      const olderMessages = messagesRaw.slice(lastExistingIndex + 1);
      const existingMessages = prev.filter((m) => rawIds.has(m._id));

      return [
        ...olderMessages.reverse(),
        ...existingMessages,
        ...newerMessages.reverse(),
      ];
    });
  }, [messagesRaw]);

  // Scroll to the bottom on the first load and when a new message
  // arrives while the user is already near the bottom. Do NOT jump
  // to the bottom when older messages are loaded via pagination,
  // because that would yank the user away from the history they were
  // reading.
  useEffect(() => {
    if (!messages || messages.length === 0) return;

    const newestMessageId = messages[messages.length - 1]?._id;
    if (!newestMessageId) return;

    if (lastMessageIdRef.current === null) {
      // First render with messages: scroll to the bottom.
      lastMessageIdRef.current = newestMessageId;
      const timeout = setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ block: "end" });
      }, 100);
      return () => clearTimeout(timeout);
    }

    if (lastMessageIdRef.current !== newestMessageId) {
      // A new message arrived. Auto-scroll only if the user is near
      // the bottom (within 100px), so reading old history is not
      // interrupted.
      const container = messagesContainerRef.current;
      const isNearBottom = container
        ? container.scrollHeight - container.scrollTop - container.clientHeight < 100
        : true;
      lastMessageIdRef.current = newestMessageId;
      if (isNearBottom) {
        const timeout = setTimeout(() => {
          messagesEndRef.current?.scrollIntoView({ block: "end" });
        }, 100);
        return () => clearTimeout(timeout);
      }
    }
  }, [messages]);

  // Preserve the visible scroll anchor when older messages are loaded.
  // After the pagination status leaves LoadingMore, adjust scrollTop by
  // the height of the newly prepended content so the same message remains
  // in view.
  useEffect(() => {
    if (paginationStatus !== "LoadingMore") {
      const before = scrollBeforeLoadRef.current;
      const container = messagesContainerRef.current;
      if (before && container) {
        const newScrollTop = before.scrollTop + (container.scrollHeight - before.scrollHeight);
        container.scrollTop = newScrollTop;
      }
      scrollBeforeLoadRef.current = null;
    }
  }, [paginationStatus]);

  const handleLoadMore = () => {
    const container = messagesContainerRef.current;
    if (container) {
      scrollBeforeLoadRef.current = {
        scrollTop: container.scrollTop,
        scrollHeight: container.scrollHeight,
      };
    }
    loadMore?.(50);
  };

  return {
    messages,
    isLoading,
    loadMore,
    paginationStatus,
    messagesContainerRef,
    messagesEndRef,
    handleLoadMore,
  };
}
