'use client';

import { Card, CardContent } from '@/components/ui/card';
import { EditorContent } from '@tiptap/react';
import { Loader2, FileText, ImageIcon } from 'lucide-react';
import { clsx } from 'clsx';
import { toast } from 'sonner';
import { Id, type Doc } from '@/convex/_generated/dataModel';
import { ChatImageLightbox } from '../../chat-lightbox';
import { NoteToolbar } from './NoteToolbar';
import { NoteTitleEditor } from './NoteTitleEditor';
import { NoteComments } from './NoteComments';
import type { NoteComment } from '@/lib/queries/convex/use-workspaces';

interface NoteEditorProps {
  selectedNote: Doc<'workspaceNotes'> | undefined | null;
  selectedNoteLoading: boolean;
  selectedNoteId: Id<'workspaceNotes'> | null;
  editor: import('@tiptap/react').Editor | null;
  isDragOver: boolean;
  setIsDragOver: (value: boolean) => void;
  noteImageUrls: string[];
  noteImageLightboxOpen: boolean;
  setNoteImageLightboxOpen: (value: boolean) => void;
  noteImageLightboxIndex: number;
  handleNoteEditorClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  handleNoteEditorKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  handleDottedLineClick: () => void;
  handleDottedLineFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleDottedLineDrop: (file: File) => Promise<void>;
  dottedLineFileInputRef: React.RefObject<HTMLInputElement | null>;
  editingNoteId: Id<'workspaceNotes'> | null;
  editingTitleSurface: 'list' | 'header' | null;
  editingTitleValue: string;
  onEditingTitleValueChange: (value: string) => void;
  onTitleUpdate: (id: Id<'workspaceNotes'>) => void;
  onCancelEditTitle: () => void;
  onStartEditTitle: (note: Doc<'workspaceNotes'>, surface: 'list' | 'header') => void;
  headerTitleInputRef: React.RefObject<HTMLInputElement | null>;
  titleEditGuardRef: React.MutableRefObject<boolean>;
  editingNoteIdRef: React.MutableRefObject<Id<'workspaceNotes'> | null>;
  editingTitleSurfaceRef: React.MutableRefObject<'list' | 'header' | null>;
  comments: NoteComment[] | undefined;
  currentUserId: string;
  newComment: string;
  onNewCommentChange: (value: string) => void;
  onCreateComment: () => void;
  onDeleteComment: (commentId: Id<'workspaceNoteComments'>) => void;
  commentAttachment: File | null;
  commentAttachmentPreview: string | null;
  isUploadingCommentAttachment: boolean;
  createCommentIsPending: boolean;
  onAttachmentSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onClearAttachment: () => void;
  commentAttachmentInputRef: React.RefObject<HTMLInputElement | null>;
  newCommentRef: React.RefObject<HTMLInputElement | null>;
}

export function NoteEditor({
  selectedNote,
  selectedNoteLoading,
  selectedNoteId,
  editor,
  isDragOver,
  setIsDragOver,
  noteImageUrls,
  noteImageLightboxOpen,
  setNoteImageLightboxOpen,
  noteImageLightboxIndex,
  handleNoteEditorClick,
  handleNoteEditorKeyDown,
  handleDottedLineClick,
  handleDottedLineFileSelect,
  handleDottedLineDrop,
  dottedLineFileInputRef,
  editingNoteId,
  editingTitleSurface,
  editingTitleValue,
  onEditingTitleValueChange,
  onTitleUpdate,
  onCancelEditTitle,
  onStartEditTitle,
  headerTitleInputRef,
  titleEditGuardRef,
  editingNoteIdRef,
  editingTitleSurfaceRef,
  comments,
  currentUserId,
  newComment,
  onNewCommentChange,
  onCreateComment,
  onDeleteComment,
  commentAttachment,
  commentAttachmentPreview,
  isUploadingCommentAttachment,
  createCommentIsPending,
  onAttachmentSelect,
  onClearAttachment,
  commentAttachmentInputRef,
  newCommentRef,
}: NoteEditorProps) {
  if (!selectedNoteId) {
    return (
      <Card className="h-full flex items-center justify-center">
        <div className="text-center text-muted-foreground">
          <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>Select a note to edit</p>
          <p className="text-sm">or create a new one</p>
        </div>
      </Card>
    );
  }

  if (selectedNoteLoading) {
    return (
      <Card className="h-full flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </Card>
    );
  }

  if (!selectedNote) {
    return (
      <Card className="h-full flex items-center justify-center">
        <div className="text-center text-muted-foreground">
          <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>Select a note to edit</p>
          <p className="text-sm">or create a new one</p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="h-auto min-h-0">
      <CardContent className="p-0 flex flex-col">
        <div className="p-3 border-b shrink-0 flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            {editingNoteId === selectedNote._id && editingTitleSurface === 'header' ? (
              <NoteTitleEditor
                title={selectedNote.title}
                value={editingTitleValue}
                onChange={onEditingTitleValueChange}
                onUpdate={onTitleUpdate}
                onCancel={onCancelEditTitle}
                noteId={selectedNote._id}
                headerTitleInputRef={headerTitleInputRef}
                titleEditGuardRef={titleEditGuardRef}
                editingNoteIdRef={editingNoteIdRef}
                editingTitleSurfaceRef={editingTitleSurfaceRef}
              />
            ) : (
              <div
                className="cursor-pointer hover:text-primary transition-colors"
                onClick={() => {
                  titleEditGuardRef.current = false;
                  onStartEditTitle(selectedNote, 'header');
                }}
              >
                <h2 className="text-lg font-semibold truncate">{selectedNote.title}</h2>
                <p className="text-xs text-muted-foreground">
                  Last updated: {new Date(selectedNote.updatedAt).toLocaleString()}
                </p>
              </div>
            )}
          </div>
        </div>
        <NoteToolbar editor={editor} />
        <div
          className={clsx(
            "flex-1 flex flex-col transition-colors min-h-0",
            isDragOver && "bg-primary/5 ring-2 ring-primary ring-inset"
          )}
        >
          <input
            ref={dottedLineFileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleDottedLineFileSelect}
          />
          <div
            className={clsx(
              "m-3 border-2 border-dashed rounded-lg transition-colors flex items-center justify-center cursor-pointer",
              isDragOver ? "border-primary bg-primary/10" : "border-muted-foreground/25 bg-muted/20"
            )}
            role="button"
            tabIndex={0}
            style={{ minHeight: '120px' }}
            onClick={handleDottedLineClick}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleDottedLineClick();
              }
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (e.dataTransfer.types.includes('Files')) {
                setIsDragOver(true);
              }
            }}
            onDragLeave={(e) => {
              e.stopPropagation();
              const related = e.relatedTarget;
              if (!related || (related instanceof Node && !e.currentTarget.contains(related))) {
                setIsDragOver(false);
              }
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsDragOver(false);

              const files = e.dataTransfer?.files;
              if (!files || files.length === 0) return;

              const file = files[0];
              if (!file.type.startsWith('image/')) {
                toast.error('Only image files are supported');
                return;
              }

              void handleDottedLineDrop(file);
            }}
          >
            <div className="text-center">
              <ImageIcon className={clsx("h-8 w-8 mx-auto mb-2", isDragOver ? "text-primary" : "text-muted-foreground")} />
              <p className="text-sm font-medium">
                {isDragOver ? "Drop image here" : "Drag and drop an image"}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Drop an image here or click to browse
              </p>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto px-3">
            <EditorContent editor={editor} onClick={handleNoteEditorClick} onKeyDown={handleNoteEditorKeyDown} />
          </div>
          <NoteComments
            comments={comments}
            currentUserId={currentUserId}
            newComment={newComment}
            onNewCommentChange={onNewCommentChange}
            onCreateComment={onCreateComment}
            onDeleteComment={onDeleteComment}
            commentAttachment={commentAttachment}
            commentAttachmentPreview={commentAttachmentPreview}
            isUploadingCommentAttachment={isUploadingCommentAttachment}
            createCommentIsPending={createCommentIsPending}
            onAttachmentSelect={onAttachmentSelect}
            onClearAttachment={onClearAttachment}
            commentAttachmentInputRef={commentAttachmentInputRef}
            newCommentRef={newCommentRef}
          />
        </div>
        <ChatImageLightbox
          images={noteImageUrls}
          initialIndex={noteImageLightboxIndex}
          open={noteImageLightboxOpen}
          onOpenChange={setNoteImageLightboxOpen}
        />
      </CardContent>
    </Card>
  );
}
