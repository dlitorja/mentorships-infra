"use client";

import { createContext, useContext } from "react";

import type { Id } from "@/convex/_generated/dataModel";

export interface ChatMessageRow {
  _id: Id<"workspaceMessages">;
  workspaceId: Id<"workspaces">;
  userId: string;
  content: string;
  type: "text" | "image" | "file";
  senderRole?: "student" | "instructor" | "admin";
  sessionId?: Id<"sessions">;
}

export interface ChatDataContextValue {
  workspaceId: Id<"workspaces"> | null;
  messages: ChatMessageRow[] | undefined;
  isLoading: boolean;
}

const ChatDataContext = createContext<ChatDataContextValue | null>(null);

export const ChatDataProvider = ChatDataContext.Provider;

export function useChatData(): ChatDataContextValue | null {
  return useContext(ChatDataContext);
}
