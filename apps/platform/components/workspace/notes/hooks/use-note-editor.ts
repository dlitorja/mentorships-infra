'use client';

import { useRef, useEffect } from 'react';
import { useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Underline from '@tiptap/extension-underline';
import { toast } from 'sonner';
import { Id, type Doc } from '@/convex/_generated/dataModel';
import { uploadFileToB2 } from '@/lib/b2-workspace-upload';
import { MAX_IMAGE_BYTES, LARGE_CHAT_FILE_BYTES } from '@/lib/workspace-constants';
import { NoteImage } from '../extensions/note-image';

type UseEmbedImageInNote = {
  mutateAsync: (args: { noteId: Id<'workspaceNotes'>; b2Key: string }) => Promise<string | undefined>;
};

interface UseNoteEditorOptions {
  selectedNote: Doc<'workspaceNotes'> | null | undefined;
  selectedNoteId: Id<'workspaceNotes'> | null;
  workspaceId: Id<'workspaces'>;
  embedImageInNote: UseEmbedImageInNote;
  // PR workspace-storage-3c: was a Convex storage upload-URL
  // action returning a string URL; now a B2 mint action returning
  // { uploadUrl, b2Key, fileId }.
  generateUploadUrl: (args: {
    workspaceId: Id<'workspaces'>;
    fileId: string;
    fileName: string;
    contentType: string;
    size: number;
  }) => Promise<{ uploadUrl: string; b2Key: string; fileId: string }>;
  recordB2FileUpload: (args: { workspaceId: Id<'workspaces'>; b2Key: string }) => Promise<unknown>;
  // Resolves a `b2Key` to a signed GET URL for Tiptap Image
  // rendering after the upload completes. Mirrors
  // `useGetWorkspaceDownloadUrl` from use-workspaces.
  resolveDownloadUrl: {
    mutateAsync: (args: {
      workspaceId: Id<'workspaces'>;
      b2Key: string;
      expiresInSeconds?: number;
    }) => Promise<{ url: string; expiresAt: number }>;
  };
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
  recordB2FileUpload,
  resolveDownloadUrl,
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
      // PR workspace-storage-3c (Greptile P1 "Saved note images
      // expire"): use the custom NoteImage extension that carries
      // a `b2Key` attribute. Pre-3c persisted a 1-hour signed
      // URL directly into `src`, so reloads on a long-lived note
      // showed broken images. The b2Key stays valid for the
      // 18-month retention window — resolve on load.
      NoteImage.configure({
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
      // PR workspace-storage-3c: resolve any `b2Key` attributes
      // that the just-loaded content may carry. Pre-PR-3c notes
      // have no `b2Key` and fall through to render whatever's in
      // `src` (which may be expired).
      void resolveB2KeyImageSrcs(editor, selectedNoteIdRef.current);
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
        // PR workspace-storage-3c: re-resolve any `b2Key`
        // attributes on the newly-loaded note (the previous
        // note's URLs may have been resolved already, but the
        // new note may carry pre-PR-3c `data-b2-key` attributes
        // waiting for a signed URL).
        void resolveB2KeyImageSrcs(editor, selectedNote._id);
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
      toast.error('Image is too large. Maximum size is 8MB.');
      return;
    }
    if (file.size > LARGE_CHAT_FILE_BYTES) {
      toast.warning('Large file detected. This image will count toward your image limit.');
    }

    const toastId = toast.loading('Uploading image...');

    try {
      const uploadResult = await uploadFileToB2(
        workspaceId,
        file,
        generateUploadUrl,
        recordB2FileUpload
      );

      if (!uploadResult.success) {
        toast.error(uploadResult.error || 'Upload failed', { id: toastId });
        return;
      }

      const b2Key = await embedImageInNote.mutateAsync({
        noteId: noteIdForUpload,
        b2Key: uploadResult.b2Key,
      });

      // PR workspace-storage-3c (Greptile P1 "Saved note images
      // expire"): the `src` attribute stays ephemeral (1-hour
      // signed URL); the `b2Key` attribute is the source of truth
      // and survives the 18-month retention window. On load the
      // editor's `resolveB2KeyImageSrcs` re-mints the signed URL
      // from `b2Key`. The image node carries both attrs, so the
      // Tiptap HTML serializer persists `data-b2-key` in the
      // autosaved content.
      let imageUrl = '';
      if (b2Key) {
        try {
          const { url } = await resolveDownloadUrl.mutateAsync({
            workspaceId,
            b2Key,
            expiresInSeconds: 3600,
          });
          imageUrl = url;
        } catch {
          // Leave `src` empty; the renderer shows a broken-image
          // placeholder until the next reload resolves the
          // b2Key. This is preferable to embedding a b2Key
          // literal as the src, which the browser can't fetch.
          imageUrl = '';
        }
      }

      toast.success('Image inserted', { id: toastId });

      if (currentEditor && selectedNoteIdRef.current === noteIdForUpload) {
        // Set the `src` first via `setImage`, then patch the
        // `b2Key` attribute via `updateAttributes`. Tiptap's
        // built-in `setImage` command only accepts `src` /
        // `alt` / `title`; the custom `b2Key` attribute lives
        // on the same Image node and is the long-lived handle
        // that survives the 1-hour signed-URL expiry. On load
        // the editor's `resolveB2KeyImageSrcs` re-mints a
        // fresh `src` from `b2Key`.
        currentEditor
          .chain()
          .focus()
          .setImage({ src: imageUrl })
          .updateAttributes('image', { b2Key })
          .run();
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

  // PR workspace-storage-3c (Greptile P1 "Saved note images
  // expire"): walks the editor's doc, finds every image node
  // with a non-null `b2Key` attribute, resolves it to a fresh
  // signed GET URL via `getWorkspaceDownloadUrl`, and patches
  // the node's `src`. Called from `onCreate` (initial editor
  // mount) and the note-switch effect. Per-image errors
  // (cancelled / never-completed ledger) are swallowed so one
  // bad row doesn't blank the whole note.
  //
  // Greptile P1 round 4 #13 ("Image loading moves the cursor"):
  // the earlier implementation called `setNodeSelection(pos)`
  // BEFORE `updateAttributes("image", { src: url })`, which
  // jumped the user's caret to the image node. If the user
  // started editing elsewhere while the download was in
  // flight, their caret moved mid-keystroke. Use a raw
  // `tr.setNodeMarkup(pos, undefined, attrs)` transaction
  // instead — `setNodeMarkup` mutates only the node attrs,
  // NOT the selection, so the caret stays put. Also guard the
  // whole pass with `selectedNoteIdRef.current` so if the user
  // switched notes during the await, we don't write into a
  // stale editor document.
  const resolveB2KeyImageSrcs = async (
    editorInstance: NonNullable<ReturnType<typeof useEditor>>,
    noteIdAtCall: Id<'workspaceNotes'> | null
  ): Promise<void> => {
    const pending: Array<{ b2Key: string; pos: number }> = [];
    editorInstance.state.doc.descendants((node, pos) => {
      if (node.type.name !== "image") return;
      const b2Key = node.attrs.b2Key as string | null | undefined;
      if (typeof b2Key === "string" && b2Key.length > 0) {
        pending.push({ b2Key, pos });
      }
    });
    if (pending.length === 0) return;

    const resolved = await Promise.all(
      pending.map(async ({ b2Key }) => {
        try {
          const { url } = await resolveDownloadUrl.mutateAsync({
            workspaceId,
            b2Key,
            expiresInSeconds: 3600,
          });
          return { b2Key, url };
        } catch {
          return { b2Key, url: null };
        }
      })
    );

    // Same-note guard: bail out if the user switched notes
    // while the awaits were in flight. Without this, we'd
    // mutate the new note's doc with the old note's image
    // URLs (Greptile P1 #13 — "pending request also has no
    // check that the same note is still open").
    if (selectedNoteIdRef.current !== noteIdAtCall) return;
    if (editorRef.current !== editorInstance) return;

    // Group updates into a single transaction so the editor
    // emits exactly one render cycle, instead of one per
    // image (which would flash the caret). `setNodeMarkup`
    // on `tr` does NOT change the selection — the caret
    // stays where the user left it.
    const tr = editorInstance.state.tr;
    let changed = false;
    for (const { b2Key, url } of resolved) {
      if (!url) continue;
      for (const { pos } of pending) {
        const node = editorInstance.state.doc.nodeAt(pos);
        if (
          node &&
          node.type.name === "image" &&
          node.attrs.b2Key === b2Key &&
          node.attrs.src !== url
        ) {
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, src: url });
          changed = true;
          break;
        }
      }
    }
    if (changed) {
      editorInstance.view.dispatch(tr);
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
