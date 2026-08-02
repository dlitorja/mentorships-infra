'use client';

import { useEffect, useRef } from 'react';
import { Id, type Doc } from '@/convex/_generated/dataModel';
import type { AutosaveEntry } from '../types';

const STORAGE_KEY = 'mentorships_workspace_notes_backup';

type NoteBackup = {
  content: string;
  timestamp: number;
};

function readBackups(): Record<string, NoteBackup> {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, NoteBackup>) : {};
  } catch {
    return {};
  }
}

function writeBackups(backups: Record<string, NoteBackup>) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(backups));
  } catch {
    // Ignore storage errors (e.g., private mode, quota exceeded).
  }
}

interface UseNoteAutosaveBackupOptions {
  editor: import('@tiptap/react').Editor | null;
  selectedNote: Doc<'workspaceNotes'> | null | undefined;
  autosavesRef: React.RefObject<Map<Id<'workspaceNotes'>, AutosaveEntry>>;
  selectedNoteId: Id<'workspaceNotes'> | null;
}

/**
 * Guards against losing pending note autosaves during tab close or navigation.
 *
 * - Warns the user before unloading the tab when there are pending autosaves.
 * - Backs up all pending autosave content to sessionStorage on unmount so the
 *   latest edits can be restored when the workspace is reopened.
 * - Restores backed-up content when the corresponding note is selected again.
 */
export function useNoteAutosaveBackup({
  editor,
  selectedNote,
  autosavesRef,
  selectedNoteId,
}: UseNoteAutosaveBackupOptions) {
  const editorRef = useRef(editor);
  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  const selectedNoteIdRef = useRef(selectedNoteId);
  useEffect(() => {
    selectedNoteIdRef.current = selectedNoteId;
  }, [selectedNoteId]);

  // Restore backed-up content when a note with a pending backup is selected.
  useEffect(() => {
    if (!editor || !selectedNote?._id) return;

    const backups = readBackups();
    const backup = backups[selectedNote._id];
    if (!backup) return;

    editor.commands.setContent(backup.content, { emitUpdate: false });
    delete backups[selectedNote._id];
    writeBackups(backups);
  }, [editor, selectedNote]);

  // Warn before leaving the page with pending autosaves, and back up all
  // pending autosave content to sessionStorage when this component unmounts.
  useEffect(() => {
    const autosaves = autosavesRef.current;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (autosaves && autosaves.size > 0) {
        e.preventDefault();
        e.returnValue = '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);

      if (!autosaves || autosaves.size === 0) return;

      const currentEditor = editorRef.current;
      const activeNoteId = selectedNoteIdRef.current;
      const backups = readBackups();

      autosaves.forEach((entry, noteId) => {
        const content =
          noteId === activeNoteId && currentEditor
            ? currentEditor.getHTML()
            : entry.content;
        backups[noteId] = { content, timestamp: Date.now() };
      });

      writeBackups(backups);
    };
  }, [autosavesRef]);
}
