'use client';

import { useState, useRef, useEffect } from 'react';
import { Id, type Doc } from '@/convex/_generated/dataModel';
import type { NoteSummary } from '../types';

export function useNoteSelection(
  notes: NoteSummary[] | undefined,
  liveSessionNote: NoteSummary | Doc<'workspaceNotes'> | undefined | null,
  workspaceId: Id<'workspaces'>
) {
  const [selectedNoteId, setSelectedNoteId] = useState<Id<'workspaceNotes'> | null>(null);
  const [pendingDeletedNoteId, setPendingDeletedNoteId] = useState<Id<'workspaceNotes'> | null>(null);
  const confirmedSelectedNoteIdRef = useRef<Id<'workspaceNotes'> | null>(null);

  // Reset selection state when the workspace changes so a stale note
  // from a previous workspace does not leak into the new one.
  useEffect(() => {
    setSelectedNoteId(null);
    setPendingDeletedNoteId(null);
    confirmedSelectedNoteIdRef.current = null;
  }, [workspaceId]);

  // Auto-select a surviving note when the list is loaded and no note
  // is selected. Skip the note that is currently being deleted so it
  // is not re-selected while the reactive subscription is still
  // removing it.
  useEffect(() => {
    if (notes && notes.length > 0 && !selectedNoteId) {
      const firstSurvivingNote = notes.find(
        (note) => note._id !== pendingDeletedNoteId
      );
      if (firstSurvivingNote) {
        setSelectedNoteId(firstSurvivingNote._id);
      }
    }
  }, [notes, selectedNoteId, pendingDeletedNoteId]);

  // If the selected note was previously visible and now disappears,
  // clear it so the auto-selection effect above can pick a survivor.
  // Newly created notes that have not yet appeared in the list are not
  // treated as deleted. The ref is scoped to the note ID so it does not
  // leak state from a previously selected note when the user switches
  // selection or creates a new note.
  useEffect(() => {
    if (!selectedNoteId) {
      confirmedSelectedNoteIdRef.current = null;
      return;
    }

    const isInList = notes?.some((note) => note._id === selectedNoteId) ?? false;
    if (isInList) {
      confirmedSelectedNoteIdRef.current = selectedNoteId;
    } else if (
      confirmedSelectedNoteIdRef.current === selectedNoteId &&
      selectedNoteId !== pendingDeletedNoteId
    ) {
      setSelectedNoteId(null);
      confirmedSelectedNoteIdRef.current = null;
    }
  }, [notes, selectedNoteId, pendingDeletedNoteId]);

  // Clear the pending deletion marker once the deleted note has
  // disappeared from the reactive paginated list, so subsequent empty
  // states or auto-selection do not keep skipping survivors.
  useEffect(() => {
    if (
      pendingDeletedNoteId &&
      notes &&
      !notes.some((note) => note._id === pendingDeletedNoteId)
    ) {
      setPendingDeletedNoteId(null);
    }
  }, [notes, pendingDeletedNoteId]);

  return {
    selectedNoteId,
    setSelectedNoteId,
    pendingDeletedNoteId,
    setPendingDeletedNoteId,
    confirmedSelectedNoteIdRef,
  };
}
