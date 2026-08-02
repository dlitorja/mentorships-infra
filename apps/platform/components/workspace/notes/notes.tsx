'use client';

import { useState, useEffect, useRef } from 'react';
import { Id } from '@/convex/_generated/dataModel';
import { Loader2 } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import { useConvexAction } from '@convex-dev/react-query';
import {
  useWorkspaceNotesPaginated,
  useWorkspaceNoteById,
  useCreateWorkspaceNote,
  useUpdateWorkspaceNote,
  useDeleteWorkspaceNote,
  useEmbedImageInNote,
  useNoteComments,
  useCreateNoteComment,
  useDeleteNoteComment,
  useLiveSessionNote,
} from '@/lib/queries/convex/use-workspaces';
import { useNoteAutosave } from './hooks/use-note-autosave';
import { useNoteAutosaveBackup } from './hooks/use-note-autosave-backup';
import { useNoteSelection } from './hooks/use-note-selection';
import { useNoteImageLightbox } from './hooks/use-note-image-lightbox';
import { useNoteEditor } from './hooks/use-note-editor';
import { useNoteComments as useNoteCommentsState } from './hooks/use-note-comments';
import { useNoteCrud } from './hooks/use-note-crud';
import { NoteList } from './components/NoteList';
import { NoteEditor } from './components/NoteEditor';
import type { WorkspaceNotesProps } from './types';

export default function WorkspaceNotes({ workspaceId, currentUserId, activeSessionId }: WorkspaceNotesProps) {
  const [isCreating, setIsCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  // PR #4b: per-create-form "Tag to current call" toggle. Defaults
  // to ON whenever a call is active so users get auto-tagging out of
  // the box, but they can untag individual notes per posting.
  const [tagNewNoteToCall, setTagNewNoteToCall] = useState(
    activeSessionId !== null
  );
  // PR #4b: the toggle is seeded from activeSessionId at mount time
  // but synced when it changes at runtime (e.g., a new call starts
  // while the Notes tab is already mounted and the create form is
  // already open). Mirrors the pattern from links.tsx.
  useEffect(() => {
    setTagNewNoteToCall(activeSessionId !== null);
  }, [activeSessionId]);

  const [editingNoteId, setEditingNoteId] = useState<Id<'workspaceNotes'> | null>(null);
  const [editingTitleSurface, setEditingTitleSurface] = useState<'list' | 'header' | null>(null);
  const [editingTitleValue, setEditingTitleValue] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const [clearedSessionIdByNote, setClearedSessionIdByNote] = useState<
    Set<Id<'workspaceNotes'>>
  >(new Set());

  const titleInputRef = useRef<HTMLInputElement>(null);
  const headerTitleInputRef = useRef<HTMLInputElement>(null);
  const dottedLineFileInputRef = useRef<HTMLInputElement>(null);
  const titleEditGuardRef = useRef(false);
  const editingNoteIdRef = useRef<Id<'workspaceNotes'> | null>(null);
  const editingTitleSurfaceRef = useRef<'list' | 'header' | null>(null);
  const newCommentRef = useRef<HTMLInputElement>(null);
  const commentAttachmentInputRef = useRef<HTMLInputElement>(null);

  const notesQuery = useWorkspaceNotesPaginated(workspaceId);
  const notes = notesQuery.results;
  const notesStatus = notesQuery.status;
  const canLoadMoreNotes =
    notesStatus === "CanLoadMore" || notesStatus === "LoadingMore";
  const isLoadingMoreNotes = notesStatus === "LoadingMore";

  const { data: liveSessionNote } = useLiveSessionNote(activeSessionId);

  const createNote = useCreateWorkspaceNote();
  const updateNote = useUpdateWorkspaceNote();
  const deleteNote = useDeleteWorkspaceNote();
  const embedImageInNote = useEmbedImageInNote();
  const generateUploadUrl = useConvexAction(api.workspaceActions.generateWorkspaceImageUploadUrl);

  const { autosavesRef, scheduleAutosave, clearAutosave, flushAllAutosaves } = useNoteAutosave(updateNote);
  const {
    selectedNoteId,
    setSelectedNoteId,
    setPendingDeletedNoteId,
  } = useNoteSelection(notes, liveSessionNote, workspaceId);

  const { data: selectedNote, isLoading: selectedNoteLoading } = useWorkspaceNoteById(selectedNoteId);
  const { data: comments } = useNoteComments(selectedNoteId ?? null);
  const createComment = useCreateNoteComment();
  const deleteComment = useDeleteNoteComment();

  const {
    noteImageUrls,
    updateNoteImageUrls,
    noteImageLightboxOpen,
    setNoteImageLightboxOpen,
    noteImageLightboxIndex,
    handleNoteEditorClick,
    handleNoteEditorKeyDown,
  } = useNoteImageLightbox();

  const {
    editor,
    handleDottedLineClick,
    handleDottedLineFileSelect,
    handleDottedLineDrop,
  } = useNoteEditor({
    selectedNote,
    selectedNoteId,
    workspaceId,
    embedImageInNote,
    generateUploadUrl,
    updateNoteImageUrls,
    scheduleAutosave,
    setIsDragOver,
    dottedLineFileInputRef,
  });

  useNoteAutosaveBackup({
    editor,
    selectedNote,
    autosavesRef,
    selectedNoteId,
    scheduleAutosave,
  });

  const {
    newComment,
    setNewComment,
    commentAttachment,
    commentAttachmentPreview,
    isUploadingCommentAttachment,
    createCommentIsPending,
    handleCreateComment,
    handleCommentAttachmentSelect,
    clearCommentAttachment,
    handleDeleteComment,
  } = useNoteCommentsState({
    workspaceId,
    selectedNoteId,
    createComment,
    deleteComment,
    generateUploadUrl,
  });

  const {
    handleCreateNote,
    handleDeleteNote,
    handleTitleUpdate,
    handleTagToCall,
    handleUntagFromCall,
    handleStartEditTitle,
    handleCancelEditTitle,
  } = useNoteCrud({
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
  });

  useEffect(() => {
    editingNoteIdRef.current = editingNoteId;
  }, [editingNoteId]);

  useEffect(() => {
    editingTitleSurfaceRef.current = editingTitleSurface;
  }, [editingTitleSurface]);

  useEffect(() => {
    return () => {
      flushAllAutosaves();
    };
  }, [flushAllAutosaves]);

  useEffect(() => {
    if (editingNoteId && titleInputRef.current) {
      setTimeout(() => titleInputRef.current?.focus(), 0);
    }
    if (editingNoteId && headerTitleInputRef.current) {
      setTimeout(() => headerTitleInputRef.current?.focus(), 0);
    }
  }, [editingNoteId]);

  if (notesQuery.isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="h-full flex gap-4">
      <NoteList
        notes={notes}
        liveSessionNote={liveSessionNote}
        selectedNoteId={selectedNoteId}
        onSelectNote={setSelectedNoteId}
        isCreating={isCreating}
        onSetIsCreating={setIsCreating}
        newTitle={newTitle}
        onNewTitleChange={setNewTitle}
        tagNewNoteToCall={tagNewNoteToCall}
        onTagNewNoteToCallChange={setTagNewNoteToCall}
        activeSessionId={activeSessionId}
        onCreateNote={handleCreateNote}
        onDeleteNote={handleDeleteNote}
        onTagToCall={handleTagToCall}
        onUntagFromCall={handleUntagFromCall}
        editingNoteId={editingNoteId}
        editingTitleSurface={editingTitleSurface}
        editingTitleValue={editingTitleValue}
        onTitleUpdate={handleTitleUpdate}
        onStartEditTitle={handleStartEditTitle}
        onCancelEditTitle={handleCancelEditTitle}
        onEditingTitleValueChange={setEditingTitleValue}
        clearedSessionIdByNote={clearedSessionIdByNote}
        isLoadingMoreNotes={isLoadingMoreNotes}
        canLoadMoreNotes={canLoadMoreNotes}
        onLoadMore={() => notesQuery.loadMore(50)}
        workspaceId={workspaceId}
        titleInputRef={titleInputRef}
        titleEditGuardRef={titleEditGuardRef}
        editingNoteIdRef={editingNoteIdRef}
        editingTitleSurfaceRef={editingTitleSurfaceRef}
        isLoading={false}
      />
      <div className="flex-1 min-w-0">
        <NoteEditor
          selectedNote={selectedNote}
          selectedNoteLoading={selectedNoteLoading}
          selectedNoteId={selectedNoteId}
          editor={editor}
          isDragOver={isDragOver}
          setIsDragOver={setIsDragOver}
          noteImageUrls={noteImageUrls}
          noteImageLightboxOpen={noteImageLightboxOpen}
          setNoteImageLightboxOpen={setNoteImageLightboxOpen}
          noteImageLightboxIndex={noteImageLightboxIndex}
          handleNoteEditorClick={handleNoteEditorClick}
          handleNoteEditorKeyDown={handleNoteEditorKeyDown}
          handleDottedLineClick={handleDottedLineClick}
          handleDottedLineFileSelect={handleDottedLineFileSelect}
          handleDottedLineDrop={handleDottedLineDrop}
          dottedLineFileInputRef={dottedLineFileInputRef}
          editingNoteId={editingNoteId}
          editingTitleSurface={editingTitleSurface}
          editingTitleValue={editingTitleValue}
          onEditingTitleValueChange={setEditingTitleValue}
          onTitleUpdate={handleTitleUpdate}
          onCancelEditTitle={handleCancelEditTitle}
          onStartEditTitle={handleStartEditTitle}
          headerTitleInputRef={headerTitleInputRef}
          titleEditGuardRef={titleEditGuardRef}
          editingNoteIdRef={editingNoteIdRef}
          editingTitleSurfaceRef={editingTitleSurfaceRef}
          comments={comments}
          currentUserId={currentUserId}
          newComment={newComment}
          onNewCommentChange={setNewComment}
          onCreateComment={handleCreateComment}
          onDeleteComment={handleDeleteComment}
          commentAttachment={commentAttachment}
          commentAttachmentPreview={commentAttachmentPreview}
          isUploadingCommentAttachment={isUploadingCommentAttachment}
          createCommentIsPending={createCommentIsPending}
          onAttachmentSelect={handleCommentAttachmentSelect}
          onClearAttachment={clearCommentAttachment}
          commentAttachmentInputRef={commentAttachmentInputRef}
          newCommentRef={newCommentRef}
        />
      </div>
    </div>
  );
}
