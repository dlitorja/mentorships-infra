'use client';

import { Button } from '@/components/ui/button';
import { Plus, Loader2, FileText, Pin } from 'lucide-react';
import { Id, type Doc } from '@/convex/_generated/dataModel';
import type { NoteSummary } from '../types';
import { NoteListItem } from './NoteListItem';
import { NoteCreateForm } from './NoteCreateForm';

interface NoteListProps {
  notes: NoteSummary[] | undefined;
  liveSessionNote: NoteSummary | Doc<'workspaceNotes'> | undefined | null;
  selectedNoteId: Id<'workspaceNotes'> | null;
  onSelectNote: (id: Id<'workspaceNotes'>) => void;
  isCreating: boolean;
  onSetIsCreating: (value: boolean) => void;
  newTitle: string;
  onNewTitleChange: (value: string) => void;
  tagNewNoteToCall: boolean;
  onTagNewNoteToCallChange: (value: boolean) => void;
  activeSessionId: Id<'sessions'> | null;
  onCreateNote: () => void;
  onDeleteNote: (id: Id<'workspaceNotes'>) => void;
  onTagToCall: (id: Id<'workspaceNotes'>) => void;
  onUntagFromCall: (id: Id<'workspaceNotes'>) => void;
  editingNoteId: Id<'workspaceNotes'> | null;
  editingTitleSurface: 'list' | 'header' | null;
  editingTitleValue: string;
  onTitleUpdate: (id: Id<'workspaceNotes'>) => void;
  onStartEditTitle: (note: NoteSummary | Doc<'workspaceNotes'>, surface: 'list' | 'header') => void;
  onCancelEditTitle: () => void;
  onEditingTitleValueChange: (value: string) => void;
  clearedSessionIdByNote: Set<Id<'workspaceNotes'>>;
  isLoadingMoreNotes: boolean;
  canLoadMoreNotes: boolean;
  onLoadMore: () => void;
  titleInputRef: React.RefObject<HTMLInputElement | null>;
  titleEditGuardRef: React.MutableRefObject<boolean>;
  editingNoteIdRef: React.MutableRefObject<Id<'workspaceNotes'> | null>;
  editingTitleSurfaceRef: React.MutableRefObject<'list' | 'header' | null>;
  isLoading: boolean;
}

export function NoteList({
  notes,
  liveSessionNote,
  selectedNoteId,
  onSelectNote,
  isCreating,
  onSetIsCreating,
  newTitle,
  onNewTitleChange,
  tagNewNoteToCall,
  onTagNewNoteToCallChange,
  activeSessionId,
  onCreateNote,
  onDeleteNote,
  onTagToCall,
  onUntagFromCall,
  editingNoteId,
  editingTitleSurface,
  editingTitleValue,
  onTitleUpdate,
  onStartEditTitle,
  onCancelEditTitle,
  onEditingTitleValueChange,
  clearedSessionIdByNote,
  isLoadingMoreNotes,
  canLoadMoreNotes,
  onLoadMore,
  titleInputRef,
  titleEditGuardRef,
  editingNoteIdRef,
  editingTitleSurfaceRef,
  isLoading,
}: NoteListProps) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="w-64 shrink-0 flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold">Notes</h3>
        <Button 
          size="sm" 
          variant="outline" 
          onClick={() => onSetIsCreating(true)}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <NoteCreateForm
        newTitle={newTitle}
        onNewTitleChange={onNewTitleChange}
        tagNewNoteToCall={tagNewNoteToCall}
        onTagNewNoteToCallChange={onTagNewNoteToCallChange}
        activeSessionId={activeSessionId}
        isCreating={isCreating}
        onCancel={onCancelEditTitle}
        onCreate={onCreateNote}
      />

      <div className="flex-1 overflow-y-auto space-y-1">
        {/* PR #4b: pinned live-session note. While a call is active,
         * `markCallStarted` has fired `createLiveSessionNote` and
         * the row exists with `isLiveSessionNote: true`. We render
         * it at the top with a Live badge so the call's
         * shared scratchpad is always one click away. */}
        {liveSessionNote && activeSessionId && (
          <div
            className={
              "group flex items-center justify-between p-2 rounded-md cursor-pointer transition-colors ring-1 ring-primary/40 " +
              (selectedNoteId === liveSessionNote._id
                ? "bg-primary text-primary-foreground"
                : "bg-primary/5 hover:bg-primary/10")
            }
            onClick={() => onSelectNote(liveSessionNote._id)}
          >
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <Pin className="h-4 w-4 shrink-0 text-primary" />
              <span className="truncate text-sm font-medium">
                {liveSessionNote.title}
              </span>
              <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-primary/20 text-primary">
                Live
              </span>
            </div>
          </div>
        )}

        {notes && notes.length > 0 ? (
          <>
            {notes
              .filter((n) => n._id !== liveSessionNote?._id)
              .map((note) => (
                <NoteListItem
                  key={note._id}
                  note={note}
                  isSelected={selectedNoteId === note._id}
                  isTaggedToCall={
                    !!activeSessionId &&
                    note.sessionId === activeSessionId &&
                    !clearedSessionIdByNote.has(note._id)
                  }
                  isLiveSessionNote={note.isLiveSessionNote}
                  activeSessionId={activeSessionId}
                  isEditing={editingNoteId === note._id && editingTitleSurface === 'list'}
                  editingTitleValue={editingTitleValue}
                  onSelect={() => onSelectNote(note._id)}
                  onStartEdit={() => onStartEditTitle(note, 'list')}
                  onTitleUpdate={() => onTitleUpdate(note._id)}
                  onCancelEdit={onCancelEditTitle}
                  onTitleChange={onEditingTitleValueChange}
                  onTagToCall={() => onTagToCall(note._id)}
                  onUntagFromCall={() => onUntagFromCall(note._id)}
                  onDelete={() => onDeleteNote(note._id)}
                  titleInputRef={titleInputRef}
                  titleEditGuardRef={titleEditGuardRef}
                  editingNoteIdRef={editingNoteIdRef}
                  editingTitleSurfaceRef={editingTitleSurfaceRef}
                />
              ))}
            {canLoadMoreNotes && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-muted-foreground"
                onClick={onLoadMore}
                disabled={isLoadingMoreNotes}
              >
                {isLoadingMoreNotes ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : null}
                Load more notes
              </Button>
            )}
          </>
        ) : (
          !liveSessionNote && (
            <div className="text-center py-8 text-muted-foreground">
              <FileText className="h-10 w-10 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No notes yet</p>
              <Button
                size="sm"
                variant="link"
                onClick={() => onSetIsCreating(true)}
                className="mt-2"
              >
                Create your first note
              </Button>
            </div>
          )
        )}
      </div>
    </div>
  );
}
