'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Id } from '@/convex/_generated/dataModel';
import { uploadFileToB2 } from '@/lib/b2-workspace-upload';
import { MAX_CHAT_FILE_BYTES } from '@/lib/workspace-constants';

type UseCreateNoteComment = {
  // PR workspace-storage-3c: B2 rows pass `b2Key` instead of
  // `storageId`. Apps/web is not in scope for notes (apps/platform
  // only — see AGENTS.md naming).
  mutateAsync: (args: { noteId: Id<'workspaceNotes'>; content: string; b2Key?: string }) => Promise<unknown>;
  isPending: boolean;
};

type UseDeleteNoteComment = {
  mutateAsync: (args: { id: Id<'workspaceNoteComments'> }) => Promise<unknown>;
};

interface UseNoteCommentsOptions {
  workspaceId: Id<'workspaces'>;
  selectedNoteId: Id<'workspaceNotes'> | null;
  createComment: UseCreateNoteComment;
  deleteComment: UseDeleteNoteComment;
  // PR workspace-storage-3c: B2 mint + record actions.
  generateUploadUrl: (args: {
    workspaceId: Id<'workspaces'>;
    fileId: string;
    fileName: string;
    contentType: string;
    size: number;
  }) => Promise<{ uploadUrl: string; b2Key: string; fileId: string }>;
  recordB2FileUpload: (args: { workspaceId: Id<'workspaces'>; b2Key: string }) => Promise<unknown>;
}

export function useNoteComments({
  workspaceId,
  selectedNoteId,
  createComment,
  deleteComment,
  generateUploadUrl,
  recordB2FileUpload,
}: UseNoteCommentsOptions) {
  const [newComment, setNewComment] = useState('');
  const [commentAttachment, setCommentAttachment] = useState<File | null>(null);
  const [commentAttachmentPreview, setCommentAttachmentPreview] = useState<string | null>(null);
  const [isUploadingCommentAttachment, setIsUploadingCommentAttachment] = useState(false);

  const handleCreateComment = async () => {
    if (!newComment.trim() && !commentAttachment || !selectedNoteId) return;

    try {
      let b2Key: string | undefined;

      if (commentAttachment) {
        setIsUploadingCommentAttachment(true);
        const uploadResult = await uploadFileToB2(
          workspaceId,
          commentAttachment,
          generateUploadUrl,
          recordB2FileUpload
        );
        setIsUploadingCommentAttachment(false);

        if (!uploadResult.success) {
          toast.error(uploadResult.error || 'Upload failed');
          return;
        }
        b2Key = uploadResult.b2Key;
      }

      await createComment.mutateAsync({
        noteId: selectedNoteId,
        content: newComment.trim(),
        b2Key,
      });
      setNewComment('');
      setCommentAttachment(null);
      setCommentAttachmentPreview(null);
    } catch (error) {
      console.error('Failed to create comment:', error);
      toast.error('Failed to add comment');
    }
  };

  const handleCommentAttachmentSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_CHAT_FILE_BYTES) {
      toast.error('File is too large. Maximum size is 500MB.');
      return;
    }

    setCommentAttachment(file);

    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (ev) => setCommentAttachmentPreview(ev.target?.result as string);
      reader.readAsDataURL(file);
    } else {
      setCommentAttachmentPreview(null);
    }
    e.target.value = '';
  };

  const clearCommentAttachment = () => {
    setCommentAttachment(null);
    setCommentAttachmentPreview(null);
  };

  const handleDeleteComment = async (commentId: Id<'workspaceNoteComments'>) => {
    try {
      await deleteComment.mutateAsync({ id: commentId });
    } catch (error) {
      console.error('Failed to delete comment:', error);
      toast.error('Failed to delete comment');
    }
  };

  return {
    newComment,
    setNewComment,
    commentAttachment,
    commentAttachmentPreview,
    isUploadingCommentAttachment,
    createCommentIsPending: createComment.isPending,
    handleCreateComment,
    handleCommentAttachmentSelect,
    clearCommentAttachment,
    handleDeleteComment,
  };
}
