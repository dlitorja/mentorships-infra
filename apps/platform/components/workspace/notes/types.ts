'use client';

import { Id } from '@/convex/_generated/dataModel';

export interface WorkspaceNotesProps {
  workspaceId: Id<'workspaces'>;
  currentUserId: string;
  // PR #4b: id of the active video-call session, or null when no
  // call is active. New notes default to being tagged to this
  // session (toggleable), and the live session note (if any) is
  // pinned at the top of the Notes list while the call is active.
  activeSessionId: Id<'sessions'> | null;
}

export interface AutosaveEntry {
  timeout?: ReturnType<typeof setTimeout>;
  content: string;
  sequence: number;
  inFlight: boolean;
}

export type TitleEditSurface = 'list' | 'header' | null;

export type NoteSummary = {
  _id: Id<'workspaceNotes'>;
  title: string;
  updatedAt: number;
  createdBy: string;
  sessionId?: Id<'sessions'>;
  isLiveSessionNote?: boolean;
  deletedAt?: number;
};
