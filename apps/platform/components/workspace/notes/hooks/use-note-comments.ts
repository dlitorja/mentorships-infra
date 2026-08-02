'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Id } from '@/convex/_generated/dataModel';
import { uploadFileForChat } from '@/lib/workspace-image-upload';
import { MAX_CHAT_FILE_BYTES } from '@/lib/workspace-constants';

type UseCreateNoteComment = {
  mutateAsync: (args: { noteId: Id<'workspaceNotes'>; content: string; storageId?: string }) => Promise<unknown>;
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
  generateUploadUrl: (...args: any[]) => Promise<string>;
}

export function useNoteComments({
  workspaceId,
  selectedNoteId,
  createComment,
  deleteComment,
  generateUploadUrl,
}: UseNoteCommentsOptions) {
  const [newComment, setNewComment] = useState('');
  const [commentAttachment, setCommentAttachment] = useState<File | null>(null);
  const [commentAttachmentPreview, setCommentAttachmentPreview] = useState<string | null>(null);
  const [isUploadingCommentAttachment, setIsUploadingCommentAttachment] = useState(false);

  const handleCreateComment = async () => {
    if (!newComment.trim() && !commentAttachment || !selectedNoteId) return;

    try {
      let storageId: string | undefined;

      if (commentAttachment) {
        setIsUploadingCommentAttachment(true);
        const uploadResult = await uploadFileForChat(workspaceId, commentAttachment, generateUploadUrl);
        setIsUploadingCommentAttachment(false);

        if (!uploadResult.success) {
          toast.error(uploadResult.error || 'Upload failed');
          return;
        }
        storageId = uploadResult.storageId;
      }

      await createComment.mutateAsync({
        noteId: selectedNoteId,
        content: newComment.trim(),
        storageId,
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
      toast.error('File is too large. Maximum size is 50MB.');
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
