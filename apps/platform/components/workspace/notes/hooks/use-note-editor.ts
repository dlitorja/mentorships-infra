'use client';

import { useRef, useEffect } from 'react';
import { useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Image from '@tiptap/extension-image';
import Underline from '@tiptap/extension-underline';
import { toast } from 'sonner';
import { Id, type Doc } from '@/convex/_generated/dataModel';
import { uploadImageForChat } from '@/lib/workspace-image-upload';
import { MAX_IMAGE_BYTES, LARGE_CHAT_FILE_BYTES } from '@/lib/workspace-constants';

type UseEmbedImageInNote = {
  mutateAsync: (args: { noteId: Id<'workspaceNotes'>; storageId: Id<'_storage'> }) => Promise<string | undefined>;
};

interface UseNoteEditorOptions {
  selectedNote: Doc<'workspaceNotes'> | null | undefined;
  selectedNoteId: Id<'workspaceNotes'> | null;
  workspaceId: Id<'workspaces'>;
  embedImageInNote: UseEmbedImageInNote;
  generateUploadUrl: (...args: any[]) => Promise<string>;
  updateNoteImageUrls: (editor: import('@tiptap/react').Editor) => void;
  scheduleAutosave: (noteId: Id<'workspaceNotes'>, content: string) => void;
  setIsDragOver: (value: boolean) => void;
  dottedLineFileInputRef: React.RefObject<HTMLInputElement | null>;
}

export function useNoteEditor({
  selectedNote,
  selectedNoteId,
  workspaceId,
  embedImageInNote,
  generateUploadUrl,
  updateNoteImageUrls,
  scheduleAutosave,
  setIsDragOver,
  dottedLineFileInputRef,
}: UseNoteEditorOptions) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Placeholder.configure({
        placeholder: 'Start writing your note...',
      }),
      Image.configure({
        inline: false,
        allowBase64: false,
        HTMLAttributes: {
          class: 'note-image cursor-zoom-in',
          // Lazy-load every embedded note image so a long note with
          // many large references doesn't pull them all in on mount.
          loading: 'lazy',
        },
      }),
    ],
    content: selectedNote?.content || '',
    editorProps: {
      attributes: {
        class: 'prose prose-sm sm:prose-base max-w-none dark:prose-invert focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 min-h-[200px] p-4',
      },
    },
    onUpdate: ({ editor }) => {
      const noteId = selectedNoteIdRef.current;
      if (noteId) {
        scheduleAutosave(noteId, editor.getHTML());
      }
      updateNoteImageUrls(editor);
    },
    onCreate: ({ editor }) => {
      updateNoteImageUrls(editor);
    },
  });

  const editorRef = useRef(editor);
  const selectedNoteIdRef = useRef(selectedNoteId);
  const loadedNoteIdRef = useRef<Id<'workspaceNotes'> | null>(null);

  useEffect(() => {
    selectedNoteIdRef.current = selectedNoteId;
  }, [selectedNoteId]);

  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  useEffect(() => {
    if (!editor) return;

    if (selectedNote) {
      if (loadedNoteIdRef.current !== selectedNote._id) {
        editor.commands.setContent(selectedNote.content || '', { emitUpdate: false });
        loadedNoteIdRef.current = selectedNote._id;
        // `setContent` is called with `emitUpdate: false` so
        // `onUpdate` doesn't fire — rescan image URLs explicitly so
        // the lightbox list reflects the newly-selected note.
        updateNoteImageUrls(editor);
      }
    } else if (!selectedNoteId) {
      editor.commands.setContent('', { emitUpdate: false });
      loadedNoteIdRef.current = null;
      updateNoteImageUrls(editor);
    }
  }, [editor, selectedNote, selectedNoteId, updateNoteImageUrls]);

  const handleDottedLineClick = () => {
    dottedLineFileInputRef.current?.click();
  };

  const handleDottedLineFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('Only image files are supported');
      return;
    }

    void handleDottedLineDrop(file);
    e.target.value = '';
  };

  const handleDottedLineDrop = async (file: File): Promise<void> => {
    const noteIdForUpload = selectedNoteIdRef.current;
    const currentEditor = editorRef.current;
    if (!noteIdForUpload || !currentEditor) return;

    if (file.size > MAX_IMAGE_BYTES) {
      toast.error('Image is too large. Maximum size is 5MB.');
      return;
    }
    if (file.size > LARGE_CHAT_FILE_BYTES) {
      toast.warning('Large file detected. This image will count toward your image limit.');
    }

    const toastId = toast.loading('Uploading image...');

    try {
      const uploadResult = await uploadImageForChat(
        workspaceId,
        file,
        generateUploadUrl
      );

      if (!uploadResult.success) {
        toast.error(uploadResult.error || 'Upload failed', { id: toastId });
        return;
      }

      const imageUrl = await embedImageInNote.mutateAsync({
        noteId: noteIdForUpload,
        storageId: uploadResult.storageId as Id<'_storage'>,
      });

      toast.success('Image inserted', { id: toastId });

      if (imageUrl && currentEditor && selectedNoteIdRef.current === noteIdForUpload) {
        currentEditor.chain().focus().setImage({ src: imageUrl }).run();
      }
    } catch (error) {
      console.error('Failed to embed image:', error);
      toast.error('Failed to embed image', { id: toastId });
    }
  };

  const handleEditorDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleEditorDragLeave = () => {
    setIsDragOver(false);
  };

  const handleEditorDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      void handleDottedLineDrop(file);
    }
  };

  return {
    editor,
    editorRef,
    selectedNoteIdRef,
    loadedNoteIdRef,
    handleDottedLineClick,
    handleDottedLineFileSelect,
    handleDottedLineDrop,
    handleEditorDragOver,
    handleEditorDragLeave,
    handleEditorDrop,
  };
}
