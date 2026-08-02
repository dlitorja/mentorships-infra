'use client';

import { useRef, useCallback } from 'react';
import { Id } from '@/convex/_generated/dataModel';
import type { AutosaveEntry } from '../types';

export function useNoteAutosave(
  updateNote: ReturnType<typeof import('@/lib/queries/convex/use-workspaces').useUpdateWorkspaceNote>
) {
  const autosavesRef = useRef(new Map<Id<'workspaceNotes'>, AutosaveEntry>());
  const updateNoteRef = useRef(updateNote);
  updateNoteRef.current = updateNote;

  const flushAutosave = useCallback(async (
    noteId: Id<'workspaceNotes'>,
    { retryOnFailure = true }: { retryOnFailure?: boolean } = {}
  ) => {
    const entry = autosavesRef.current.get(noteId);
    if (!entry || entry.inFlight) return;

    entry.inFlight = true;
    entry.timeout = undefined;
    const content = entry.content;
    const sequence = entry.sequence;
    let saveSucceeded = false;

    try {
      await updateNoteRef.current.mutateAsync({ id: noteId, content });
      saveSucceeded = true;
    } catch (error) {
      console.error('Failed to auto-save note:', error);
    } finally {
      const current = autosavesRef.current.get(noteId);
      if (current) {
        current.inFlight = false;
        if (current.sequence !== sequence) {
          void flushAutosave(noteId, { retryOnFailure });
        } else if (saveSucceeded) {
          autosavesRef.current.delete(noteId);
        } else if (retryOnFailure) {
          // Retain the failed entry and schedule a retry so the latest
          // content is not silently lost. Retries are skipped during
          // unmount because the component (and its autosave map) will be
          // discarded; a new editor instance will load the saved note.
          current.timeout = setTimeout(() => {
            void flushAutosave(noteId, { retryOnFailure });
          }, 3000);
        }
      }
    }
  }, []);

  const scheduleAutosave = useCallback((noteId: Id<'workspaceNotes'>, content: string) => {
    const existing = autosavesRef.current.get(noteId);
    if (existing?.timeout) {
      clearTimeout(existing.timeout);
    }

    const entry: AutosaveEntry = existing ?? {
      content,
      sequence: 0,
      inFlight: false,
    };
    entry.content = content;
    entry.sequence += 1;
    entry.timeout = setTimeout(() => {
      void flushAutosave(noteId);
    }, 1000);
    autosavesRef.current.set(noteId, entry);
  }, [flushAutosave]);

  const clearAutosave = useCallback((noteId: Id<'workspaceNotes'>) => {
    const entry = autosavesRef.current.get(noteId);
    if (entry?.timeout) {
      clearTimeout(entry.timeout);
    }
    autosavesRef.current.delete(noteId);
  }, []);

  const flushAllAutosaves = useCallback(() => {
    autosavesRef.current.forEach((entry, noteId) => {
      if (entry.timeout) {
        clearTimeout(entry.timeout);
        entry.timeout = undefined;
      }
      if (!entry.inFlight) {
        // Final flush during unmount; do not schedule retries because the
        // component (and its autosave map) will be discarded.
        void flushAutosave(noteId, { retryOnFailure: false });
      }
    });
  }, [flushAutosave]);

  return {
    autosavesRef,
    scheduleAutosave,
    clearAutosave,
    flushAllAutosaves,
  };
}
