'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Plus, MessageCircle, Trash2, File, X, Paperclip } from 'lucide-react';
import NextImage from 'next/image';
import { Id } from '@/convex/_generated/dataModel';
import type { NoteComment } from '@/lib/queries/convex/use-workspaces';

interface NoteCommentsProps {
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

export function NoteComments({
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
}: NoteCommentsProps) {
  return (
    <div className="border-t shrink-0 bg-muted/30">
      <div className="px-3 py-2 flex items-center justify-between">
        <h4 className="text-sm font-medium flex items-center gap-1">
          <MessageCircle className="h-4 w-4" />
          Comments {comments && comments.length > 0 && `(${comments.length})`}
        </h4>
      </div>
      <div className="px-3 pb-2 space-y-2 max-h-48 overflow-y-auto">
        {comments && comments.length > 0 ? (
          comments.map((comment: NoteComment) => (
            <div key={comment._id} className="text-sm bg-background rounded p-2">
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  {comment.createdBy === currentUserId ? 'You' : comment.authorDisplayName}
                  {' · '}
                  {new Date(comment.createdAt).toLocaleDateString()}
                </p>
                {comment.createdBy === currentUserId && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-5 w-5"
                    onClick={() => onDeleteComment(comment._id)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                )}
              </div>
              {comment.content && <p className="mt-1">{comment.content}</p>}
              {comment.storageId && (
                <div className="mt-2">
                  <a
                    href={`${process.env.NEXT_PUBLIC_CONVEX_URL}/api/storage/${comment.storageId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-xs text-primary bg-muted/50 rounded p-1.5 hover:underline"
                  >
                    <File className="h-4 w-4" />
                    <span>Download attachment</span>
                  </a>
                </div>
              )}
            </div>
          ))
        ) : (
          <p className="text-xs text-muted-foreground text-center py-2">No comments yet</p>
        )}
      </div>
      <div className="px-3 pb-3 flex flex-col gap-2">
        {commentAttachment && (
          <div className="flex items-center gap-2 bg-muted/50 rounded p-2">
            {commentAttachmentPreview ? (
              <div className="relative w-10 h-10 rounded overflow-hidden">
                <NextImage
                  src={commentAttachmentPreview}
                  alt="Preview"
                  fill
                  unoptimized
                  sizes="40px"
                  className="object-cover"
                />
              </div>
            ) : (
              <File className="h-4 w-4 text-muted-foreground" />
            )}
            <span className="text-xs truncate flex-1">{commentAttachment.name}</span>
            <Button size="icon" variant="ghost" className="h-5 w-5" onClick={onClearAttachment}>
              <X className="h-3 w-3" />
            </Button>
          </div>
        )}
        <div className="flex gap-2">
          <input
            type="file"
            ref={commentAttachmentInputRef}
            onChange={onAttachmentSelect}
            className="hidden"
            accept="image/*,application/pdf,text/*"
          />
          <Button
            size="sm"
            variant="ghost"
            className="h-8 px-2"
            onClick={() => commentAttachmentInputRef.current?.click()}
            disabled={isUploadingCommentAttachment}
          >
            <Paperclip className="h-4 w-4" />
          </Button>
          <Input
            ref={newCommentRef}
            placeholder="Add a comment..."
            value={newComment}
            onChange={(e) => onNewCommentChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                onCreateComment();
              }
            }}
            className="h-8 text-sm"
          />
          <Button
            size="sm"
            onClick={onCreateComment}
            disabled={(!newComment.trim() && !commentAttachment) || createCommentIsPending || isUploadingCommentAttachment}
          >
            {createCommentIsPending || isUploadingCommentAttachment ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
