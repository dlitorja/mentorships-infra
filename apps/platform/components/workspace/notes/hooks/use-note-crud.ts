'use client';

import { toast } from 'sonner';
import { Id } from '@/convex/_generated/dataModel';
import type { NoteSummary } from '../types';

type UseCreateWorkspaceNote = {
  mutateAsync: (args: { workspaceId: Id<'workspaces'>; title: string; content: string; sessionId?: Id<'sessions'> }) => Promise<Id<'workspaceNotes'>>;
};

type UseUpdateWorkspaceNote = {
  mutateAsync: (args: { id: Id<'workspaceNotes'>; title?: string; content?: string; sessionId?: Id<'sessions'>; clearSessionId?: boolean }) => Promise<unknown>;
};

type UseDeleteWorkspaceNote = {
  mutateAsync: (args: { id: Id<'workspaceNotes'> }) => Promise<unknown>;
};

interface UseNoteCrudOptions {
  workspaceId: Id<'workspaces'>;
  activeSessionId: Id<'sessions'> | null;
  selectedNoteId: Id<'workspaceNotes'> | null;
  newTitle: string;
  tagNewNoteToCall: boolean;
  editingTitleValue: string;
  createNote: UseCreateWorkspaceNote;
  updateNote: UseUpdateWorkspaceNote;
  deleteNote: UseDeleteWorkspaceNote;
  clearAutosave: (noteId: Id<'workspaceNotes'>) => void;
  setNewTitle: (value: string) => void;
  setIsCreating: (value: boolean) => void;
  setTagNewNoteToCall: (value: boolean) => void;
  setSelectedNoteId: (id: Id<'workspaceNotes'> | null) => void;
  setPendingDeletedNoteId: (id: Id<'workspaceNotes'> | null) => void;
  setEditingNoteId: (id: Id<'workspaceNotes'> | null) => void;
  setEditingTitleSurface: (surface: 'list' | 'header' | null) => void;
  setEditingTitleValue: (value: string) => void;
  setClearedSessionIdByNote: React.Dispatch<React.SetStateAction<Set<Id<'workspaceNotes'>>>>;
  titleEditGuardRef: React.MutableRefObject<boolean>;
}

export function useNoteCrud({
  workspaceId,
  activeSessionId,
  selectedNoteId,
  newTitle,
  tagNewNoteToCall,
  editingTitleValue,
  createNote,
  updateNote,
  deleteNote,
  clearAutosave,
  setNewTitle,
  setIsCreating,
  setTagNewNoteToCall,
  setSelectedNoteId,
  setPendingDeletedNoteId,
  setEditingNoteId,
  setEditingTitleSurface,
  setEditingTitleValue,
  setClearedSessionIdByNote,
  titleEditGuardRef,
}: UseNoteCrudOptions) {
  const handleCreateNote = async () => {
    if (!newTitle.trim() || !workspaceId) return;

    try {
      const noteId = await createNote.mutateAsync({
        workspaceId,
        title: newTitle.trim(),
        content: '',
        // PR #4b: forward the active sessionId when the user keeps
        // the "Tag to current call" toggle ON (default).
        sessionId:
          tagNewNoteToCall && activeSessionId ? activeSessionId : undefined,
      });

      setNewTitle('');
      setIsCreating(false);
      setTagNewNoteToCall(activeSessionId !== null);
      // Reset the confirmed-ID ref before selecting the newly created
      // note so the deletion-detection effect does not treat it as
      // externally deleted while it is still propagating into the
      // paginated list.
      setSelectedNoteId(noteId);
    } catch (error) {
      console.error('Failed to create note:', error);
      toast.error('Failed to create note');
    }
  };

  const handleDeleteNote = async (noteId: Id<'workspaceNotes'>) => {
    try {
      clearAutosave(noteId);
      setPendingDeletedNoteId(noteId);
      await deleteNote.mutateAsync({ id: noteId });
      if (selectedNoteId === noteId) {
        setSelectedNoteId(null);
      }
    } catch (error) {
      console.error('Failed to delete note:', error);
      toast.error('Failed to delete note');
      setPendingDeletedNoteId(null);
    }
  };

  const handleTitleUpdate = async (noteId: Id<'workspaceNotes'>) => {
    if (!editingTitleValue?.trim()) {
      setEditingNoteId(null);
      setEditingTitleSurface(null);
      return;
    }

    try {
      await updateNote.mutateAsync({
        id: noteId,
        title: editingTitleValue.trim(),
      });
      setEditingNoteId(null);
      setEditingTitleSurface(null);
    } catch (error) {
      console.error('Failed to update title:', error);
      toast.error('Failed to update note title');
    }
  };

  // PR #4b: tag an existing note to the active call. Uses the
  // update mutation with `sessionId` directly (not clearSessionId).
  const handleTagToCall = async (noteId: Id<'workspaceNotes'>) => {
    if (!activeSessionId) return;
    try {
      await updateNote.mutateAsync({
        id: noteId,
        sessionId: activeSessionId,
      });
      setClearedSessionIdByNote((prev) => {
        if (!prev.has(noteId)) return prev;
        const next = new Set(prev);
        next.delete(noteId);
        return next;
      });
    } catch (error) {
      console.error('Failed to tag note to call', error);
      toast.error('Failed to tag note');
    }
  };

  // PR #4b: untag an existing note from the active call. We
  // optimistically update the local override set so the "Tagged"
  // badge disappears before the query refetches.
  const handleUntagFromCall = async (noteId: Id<'workspaceNotes'>) => {
    try {
      await updateNote.mutateAsync({
        id: noteId,
        clearSessionId: true,
      });
      setClearedSessionIdByNote((prev) => new Set(prev).add(noteId));
    } catch (error) {
      console.error('Failed to untag note', error);
      toast.error('Failed to untag note');
    }
  };

  const handleStartEditTitle = (note: NoteSummary | { _id: Id<'workspaceNotes'>; title: string }, surface: 'list' | 'header') => {
    titleEditGuardRef.current = false;
    setEditingTitleSurface(surface);
    setEditingNoteId(note._id);
    setEditingTitleValue(note.title);
  };

  const handleCancelEditTitle = () => {
    setEditingNoteId(null);
    setEditingTitleSurface(null);
  };

  return {
    handleCreateNote,
    handleDeleteNote,
    handleTitleUpdate,
    handleTagToCall,
    handleUntagFromCall,
    handleStartEditTitle,
    handleCancelEditTitle,
  };
}
