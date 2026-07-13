'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Image from '@tiptap/extension-image';
import Underline from '@tiptap/extension-underline';
import { Id } from '../../../../convex/_generated/dataModel';
import {
  useWorkspaceNotes,
  useUpdateWorkspaceNote,
  useDeleteWorkspaceNote,
  useEmbedImageInNote,
  useNoteComments,
  useCreateNoteComment,
  useDeleteNoteComment,
  useLiveSessionNote,
  type NoteComment,
} from '@/lib/queries/convex/use-workspaces';
import { uploadImageForChat, uploadFileForChat, MAX_CHAT_FILE_BYTES, LARGE_CHAT_FILE_BYTES } from '@/lib/workspace-image-upload';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, Plus, Trash2, Edit2, Save, X, FileText, ImageIcon, Bold, Italic, Underline as UnderlineIcon, List, ListOrdered, Code, Quote, MessageCircle, Paperclip, File, Pin, Tag, XCircle } from 'lucide-react';
import { clsx } from 'clsx';
import { toast } from 'sonner';
import { api } from '@/convex/_generated/api';
import { useConvexAction } from '@convex-dev/react-query';
import CallsSection from './calls-section';

interface Note {
  _id: Id<'workspaceNotes'>;
  workspaceId: Id<'workspaces'>;
  title: string;
  content: string;
  createdBy: string;
  updatedAt: number;
  sessionId?: Id<'sessions'>;
  isLiveSessionNote?: boolean;
}

interface WorkspaceNotesProps {
  workspaceId: Id<'workspaces'>;
  currentUserId: string;
  // PR #4b: id of the active video-call session, or null when no
  // call is active. New notes default to being tagged to this
  // session (toggleable), and the live session note (if any) is
  // pinned at the top of the Notes list while the call is active.
  activeSessionId: Id<'sessions'> | null;
}

interface AutosaveEntry {
  timeout?: ReturnType<typeof setTimeout>;
  content: string;
  sequence: number;
  inFlight: boolean;
}

type TitleEditSurface = 'list' | 'header' | null;

/**
 * Rich text note-taking component for a workspace.
 * Uses TipTap editor with auto-save on content changes.
 * Supports creating, editing titles, and deleting notes.
 *
 * @param workspaceId - Convex workspace ID
 * @param currentUserId - Current authenticated user's ID
 */
export default function WorkspaceNotes({ workspaceId, currentUserId, activeSessionId }: WorkspaceNotesProps) {
  const [selectedNoteId, setSelectedNoteId] = useState<Id<'workspaceNotes'> | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  // PR #4b: per-create-form "Tag to current call" toggle. Defaults
  // to ON whenever a call is active so users get auto-tagging out of
  // the box, but they can untag individual notes per posting.
  const [tagNewNoteToCall, setTagNewNoteToCall] = useState(
    activeSessionId !== null
  );
  // PR #4b (Greptile R2 P2): the toggle above is seeded from
  // activeSessionId at mount time but never synced when
  // activeSessionId changes at runtime (e.g., a new call starts
  // while the Notes tab is already mounted and the create form is
  // already open). Mirror the pattern from links.tsx so the
  // toggle defaults to ON whenever a call goes live, rather than
  // being stuck at whatever value it had on first render.
  useEffect(() => {
    setTagNewNoteToCall(activeSessionId !== null);
  }, [activeSessionId]);
  const [editingNoteId, setEditingNoteId] = useState<Id<'workspaceNotes'> | null>(null);
  const [editingTitleSurface, setEditingTitleSurface] = useState<TitleEditSurface>(null);
  const [editingTitleValue, setEditingTitleValue] = useState('');
  const autosavesRef = useRef(new Map<Id<'workspaceNotes'>, AutosaveEntry>());
  const loadedNoteIdRef = useRef<Id<'workspaceNotes'> | null>(null);
  const selectedNoteIdRef = useRef<Id<'workspaceNotes'> | null>(null);
  const editorRef = useRef<ReturnType<typeof useEditor>>(null);
  const [newComment, setNewComment] = useState('');
  const newCommentRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [commentAttachment, setCommentAttachment] = useState<File | null>(null);
  const [commentAttachmentPreview, setCommentAttachmentPreview] = useState<string | null>(null);
  const [isUploadingCommentAttachment, setIsUploadingCommentAttachment] = useState(false);
  const commentAttachmentInputRef = useRef<HTMLInputElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const headerTitleInputRef = useRef<HTMLInputElement>(null);
  const dottedLineFileInputRef = useRef<HTMLInputElement>(null);
  const titleEditGuardRef = useRef(false);
  const editingNoteIdRef = useRef<Id<'workspaceNotes'> | null>(null);
  const editingTitleSurfaceRef = useRef<TitleEditSurface>(null);

  const { data: notes, isLoading, refetch } = useWorkspaceNotes(workspaceId);
  const { data: liveSessionNote } = useLiveSessionNote(activeSessionId);
  // Local override so the toggle flips immediately even before the
  // Convex mutation round-trips back through the `notes` query.
  const [clearedSessionIdByNote, setClearedSessionIdByNote] = useState<
    Set<Id<'workspaceNotes'>>
  >(new Set());
  const updateNote = useUpdateWorkspaceNote();
  const deleteNote = useDeleteWorkspaceNote();
  const embedImageInNote = useEmbedImageInNote();
  const generateUploadUrl = useConvexAction(api.workspaceActions.generateWorkspaceImageUploadUrl);
  const updateNoteRef = useRef(updateNote);

  const { data: comments } = useNoteComments(selectedNoteId ?? null);
  const createComment = useCreateNoteComment();
  const deleteComment = useDeleteNoteComment();

  const selectedNote = notes?.find(n => n._id === selectedNoteId);

  useEffect(() => {
    updateNoteRef.current = updateNote;
  }, [updateNote]);

  useEffect(() => {
    selectedNoteIdRef.current = selectedNoteId;
  }, [selectedNoteId]);

  useEffect(() => {
    editingNoteIdRef.current = editingNoteId;
  }, [editingNoteId]);

  useEffect(() => {
    editingTitleSurfaceRef.current = editingTitleSurface;
  }, [editingTitleSurface]);

  async function flushAutosave(noteId: Id<'workspaceNotes'>) {
    const entry = autosavesRef.current.get(noteId);
    if (!entry || entry.inFlight) return;

    entry.inFlight = true;
    entry.timeout = undefined;
    const content = entry.content;
    const sequence = entry.sequence;

    try {
      await updateNoteRef.current.mutateAsync({ id: noteId, content });
    } catch (error) {
      console.error('Failed to auto-save note:', error);
    } finally {
      const current = autosavesRef.current.get(noteId);
      if (!current) return;

      current.inFlight = false;
      if (current.sequence !== sequence) {
        void flushAutosave(noteId);
      } else if (!current.timeout) {
        autosavesRef.current.delete(noteId);
      }
    }
  }

  function scheduleAutosave(noteId: Id<'workspaceNotes'>, content: string) {
    const existing = autosavesRef.current.get(noteId);
    if (existing?.timeout) {
      clearTimeout(existing.timeout);
    }

    const entry: AutosaveEntry = existing ?? {
      content,
      sequence: 0,
      inFlight: false,
    };
    entry.content = content;
    entry.sequence += 1;
    entry.timeout = setTimeout(() => {
      void flushAutosave(noteId);
    }, 1000);
    autosavesRef.current.set(noteId, entry);
  }

  function clearAutosave(noteId: Id<'workspaceNotes'>) {
    const entry = autosavesRef.current.get(noteId);
    if (entry?.timeout) {
      clearTimeout(entry.timeout);
    }
    autosavesRef.current.delete(noteId);
  }

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
          class: 'note-image',
        },
        resize: {
          enabled: true,
          minWidth: 50,
          minHeight: 50,
          alwaysPreserveAspectRatio: true,
        },
      }),
    ],
    content: selectedNote?.content || '',
    editorProps: {
      attributes: {
        class: 'prose prose-sm sm:prose-base max-w-none focus:outline-none min-h-[200px] p-4',
      },
    },
    onUpdate: ({ editor }) => {
      const noteId = selectedNoteIdRef.current;
      if (noteId) {
        scheduleAutosave(noteId, editor.getHTML());
      }
    },
  });

  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  useEffect(() => {
    if (!editor) return;

    if (selectedNote) {
      if (loadedNoteIdRef.current !== selectedNote._id) {
        editor.commands.setContent(selectedNote.content || '', { emitUpdate: false });
        loadedNoteIdRef.current = selectedNote._id;
      }
    } else if (!selectedNoteId) {
      editor.commands.setContent('', { emitUpdate: false });
      loadedNoteIdRef.current = null;
    }
  }, [editor, selectedNote, selectedNoteId]);

  useEffect(() => {
    return () => {
      autosavesRef.current.forEach((entry, noteId) => {
        if (entry.timeout) {
          clearTimeout(entry.timeout);
          entry.timeout = undefined;
        }
        if (!entry.inFlight) {
          void flushAutosave(noteId);
        }
      });
    };
  }, []);

  useEffect(() => {
    if (notes && notes.length > 0 && !selectedNoteId) {
      setSelectedNoteId(notes[0]._id);
    }
  }, [notes, selectedNoteId]);

  useEffect(() => {
    if (editingNoteId && titleInputRef.current) {
      setTimeout(() => titleInputRef.current?.focus(), 0);
    }
    if (editingNoteId && headerTitleInputRef.current) {
      setTimeout(() => headerTitleInputRef.current?.focus(), 0);
    }
  }, [editingNoteId]);

  const handleCreateNote = async () => {
    if (!newTitle.trim() || !workspaceId) return;

    try {
      const response = await fetch('/api/workspace/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId,
          title: newTitle.trim(),
          content: '',
          // PR #4b: forward the active sessionId when the user keeps
          // the "Tag to current call" toggle ON (default). Falls
          // through to the API route which forwards it to Convex.
          sessionId:
            tagNewNoteToCall && activeSessionId ? activeSessionId : undefined,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create note');
      }

      const { noteId } = await response.json();
      setNewTitle('');
      setIsCreating(false);
      setTagNewNoteToCall(activeSessionId !== null);
      setSelectedNoteId(noteId as Id<'workspaceNotes'>);
      await refetch();
    } catch (error) {
      console.error('Failed to create note:', error);
      toast.error('Failed to create note');
    }
  };

  const handleDeleteNote = async (noteId: Id<'workspaceNotes'>) => {
    try {
      clearAutosave(noteId);
      await deleteNote.mutateAsync({ id: noteId });
      if (selectedNoteId === noteId) {
        setSelectedNoteId(null);
      }
      await refetch();
    } catch (error) {
      console.error('Failed to delete note:', error);
      toast.error('Failed to delete note');
    }
  };

  const handleTitleUpdate = async (noteId: Id<'workspaceNotes'>) => {
    if (!editingTitleValue?.trim()) {
      setEditingNoteId(null);
      setEditingTitleSurface(null);
      return;
    }

    try {
      await updateNote.mutateAsync({
        id: noteId,
        title: editingTitleValue.trim(),
      });
      setEditingNoteId(null);
      setEditingTitleSurface(null);
    } catch (error) {
      console.error('Failed to update title:', error);
      toast.error('Failed to update note title');
    }
  };

  // PR #4b: tag an existing note to the active call. Uses the
  // update mutation with `sessionId` directly (not clearSessionId).
  const handleTagToCall = async (noteId: Id<'workspaceNotes'>) => {
    if (!activeSessionId) return;
    try {
      await updateNote.mutateAsync({
        id: noteId,
        sessionId: activeSessionId,
      });
      setClearedSessionIdByNote((prev) => {
        if (!prev.has(noteId)) return prev;
        const next = new Set(prev);
        next.delete(noteId);
        return next;
      });
      await refetch();
    } catch (error) {
      console.error('Failed to tag note to call', error);
      toast.error('Failed to tag note');
    }
  };

  // PR #4b: untag an existing note from the active call. We
  // optimistically update the local override set so the "Tagged"
  // badge disappears before the query refetches.
  const handleUntagFromCall = async (noteId: Id<'workspaceNotes'>) => {
    try {
      await updateNote.mutateAsync({
        id: noteId,
        clearSessionId: true,
      });
      setClearedSessionIdByNote((prev) => new Set(prev).add(noteId));
      await refetch();
    } catch (error) {
      console.error('Failed to untag note', error);
      toast.error('Failed to untag note');
    }
  };

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

  const handleDottedLineDrop = async (file: File) => {
    const noteIdForUpload = selectedNoteId;
    const currentEditor = editorRef.current;
    if (!noteIdForUpload || !currentEditor) return;

    if (file.size > MAX_CHAT_FILE_BYTES) {
      toast.error('Image is too large. Maximum size is 50MB.');
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
        storageId: uploadResult.storageId as Id<"_storage">,
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

  const handleDeleteComment = async (commentId: Id<'workspaceNoteComments'>) => {
    try {
      await deleteComment.mutateAsync({ id: commentId });
    } catch (error) {
      console.error('Failed to delete comment:', error);
      toast.error('Failed to delete comment');
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="h-full flex gap-4">
      {/* Notes List */}
      <div className="w-64 shrink-0 flex flex-col">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">Notes</h3>
          <Button 
            size="sm" 
            variant="outline" 
            onClick={() => setIsCreating(true)}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        {isCreating && (
          <div className="mb-3 p-3 border rounded-lg space-y-2">
            <Input
              placeholder="Note title"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateNote()}
              autoFocus
            />
            {activeSessionId && (
              <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5"
                  checked={tagNewNoteToCall}
                  onChange={(e) => setTagNewNoteToCall(e.target.checked)}
                />
                <Tag className="h-3 w-3" />
                Tag to current call
              </label>
            )}
            <div className="flex gap-2">
              <Button size="sm" onClick={handleCreateNote} disabled={!newTitle.trim()}>
                <Save className="h-4 w-4 mr-1" />
                Create
              </Button>
              <Button size="sm" variant="outline" onClick={() => { setIsCreating(false); setNewTitle(''); setTagNewNoteToCall(activeSessionId !== null); }}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto space-y-1">
          {/* PR #4c-1: Calls sub-section. Lists past call recordings
           * with Play (modal) + Download (signed B2 URL) actions.
           * Sits above the live-session note so users scrolling
           * the list see recordings first, then the live note
           * (which only renders while a call is active). */}
          <CallsSection workspaceId={workspaceId} />

          {/* PR #4b: pinned live-session note. While a call is active,
           * `markCallStarted` has fired `createLiveSessionNote` and
           * the row exists with `isLiveSessionNote: true`. We render
           * it at the top with a 🔴 Live badge so the call's
           * shared scratchpad is always one click away. */}
          {liveSessionNote && activeSessionId && (
            <div
              className={clsx(
                "group flex items-center justify-between p-2 rounded-md cursor-pointer transition-colors ring-1 ring-primary/40",
                selectedNoteId === liveSessionNote._id
                  ? "bg-primary text-primary-foreground"
                  : "bg-primary/5 hover:bg-primary/10"
              )}
              onClick={() => setSelectedNoteId(liveSessionNote._id)}
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
            notes
              .filter((n) => n._id !== liveSessionNote?._id)
              .map((note: Note) => {
                const isTaggedToCall =
                  !!activeSessionId &&
                  note.sessionId === activeSessionId &&
                  !clearedSessionIdByNote.has(note._id);
                return (
                  <div
                    key={note._id}
                    className={clsx(
                      "group flex items-center justify-between p-2 rounded-md cursor-pointer transition-colors",
                      selectedNoteId === note._id
                        ? "bg-primary text-primary-foreground"
                        : "hover:bg-muted"
                    )}
                    onClick={() => setSelectedNoteId(note._id)}
                  >
                    {editingNoteId === note._id && editingTitleSurface === 'list' ? (
                      <div className="flex-1 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        <Input
                          ref={titleInputRef}
                          value={editingTitleValue}
                          onChange={(e) => setEditingTitleValue(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleTitleUpdate(note._id)}
                          onBlur={() => {
                            if (titleEditGuardRef.current) {
                              titleEditGuardRef.current = false;
                              return;
                            }
                            const blurredNoteId = note._id;
                            setTimeout(() => {
                              if (editingNoteIdRef.current !== blurredNoteId || editingTitleSurfaceRef.current !== 'list') return;
                              if (editingTitleValue?.trim()) {
                                handleTitleUpdate(blurredNoteId);
                              } else {
                                setEditingNoteId(null);
                              }
                            }, 50);
                          }}
                          className="h-6 text-sm"
                        />
                        <Button size="icon" variant="ghost" className="h-6 w-6" onMouseDown={(e) => { e.preventDefault(); titleEditGuardRef.current = true; }} onClick={() => { titleEditGuardRef.current = false; handleTitleUpdate(note._id); }}>
                          <Save className="h-3 w-3" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-6 w-6" onMouseDown={(e) => { e.preventDefault(); titleEditGuardRef.current = true; }} onClick={() => { titleEditGuardRef.current = false; setEditingNoteId(null); setEditingTitleSurface(null); }}>
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <FileText className="h-4 w-4 shrink-0" />
                          <span className="truncate text-sm">{note.title}</span>
                          {isTaggedToCall && (
                            <span
                              className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-primary/20 text-primary"
                              title="Tagged to current call"
                            >
                              Tagged
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          {activeSessionId && note.sessionId === activeSessionId && !note.isLiveSessionNote && (
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="h-6 w-6"
                              title="Untag from current call"
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleUntagFromCall(note._id);
                              }}
                            >
                              <XCircle className="h-3 w-3" />
                            </Button>
                          )}
                          {activeSessionId && !note.sessionId && !clearedSessionIdByNote.has(note._id) && !note.isLiveSessionNote && (
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="h-6 w-6"
                              title="Tag to current call"
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleTagToCall(note._id);
                              }}
                            >
                              <Tag className="h-3 w-3" />
                            </Button>
                          )}
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6"
                            onClick={(e) => { e.stopPropagation(); titleEditGuardRef.current = false; setEditingTitleSurface('list'); setEditingNoteId(note._id); setEditingTitleValue(note.title); }}
                          >
                            <Edit2 className="h-3 w-3" />
                          </Button>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6 text-destructive"
                            onClick={(e) => { e.stopPropagation(); handleDeleteNote(note._id); }}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                );
              })
          ) : (
            !liveSessionNote && (
              <div className="text-center py-8 text-muted-foreground">
                <FileText className="h-10 w-10 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No notes yet</p>
                <Button
                  size="sm"
                  variant="link"
                  onClick={() => setIsCreating(true)}
                  className="mt-2"
                >
                  Create your first note
                </Button>
              </div>
            )
          )}
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 min-w-0">
        {selectedNote ? (
          <Card className="h-auto min-h-0">
            <CardContent className="p-0 flex flex-col">
              <div className="p-3 border-b shrink-0 flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  {editingNoteId === selectedNote._id && editingTitleSurface === 'header' ? (
                    <div className="flex items-center gap-1">
                      <Input
                        ref={headerTitleInputRef}
                        value={editingTitleValue}
                        onChange={(e) => setEditingTitleValue(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleTitleUpdate(selectedNote._id)}
                        onBlur={() => {
                          if (titleEditGuardRef.current) {
                            titleEditGuardRef.current = false;
                            return;
                          }
                          const blurredNoteId = selectedNote._id;
                          setTimeout(() => {
                            if (editingNoteIdRef.current !== blurredNoteId || editingTitleSurfaceRef.current !== 'header') return;
                            if (editingTitleValue?.trim()) {
                              handleTitleUpdate(blurredNoteId);
                            } else {
                              setEditingNoteId(null);
                            }
                          }, 50);
                        }}
                        className="h-8 text-sm"
                      />
                      <Button size="icon" variant="ghost" className="h-8 w-8" onMouseDown={(e) => { e.preventDefault(); titleEditGuardRef.current = true; }} onClick={() => { titleEditGuardRef.current = false; handleTitleUpdate(selectedNote._id); }}>
                        <Save className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8" onMouseDown={(e) => { e.preventDefault(); titleEditGuardRef.current = true; }} onClick={() => { titleEditGuardRef.current = false; setEditingNoteId(null); setEditingTitleSurface(null); }}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <div
                      className="cursor-pointer hover:text-primary transition-colors"
                      onClick={() => {
                        titleEditGuardRef.current = false;
                        setEditingTitleSurface('header');
                        setEditingNoteId(selectedNote._id);
                        setEditingTitleValue(selectedNote.title);
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
              {editor && (
                <div className="flex items-center gap-1 px-3 py-2 border-b bg-muted/30 shrink-0 flex-wrap">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={clsx('h-8 w-8 p-0', editor.isActive('bold') && 'bg-muted')}
                    onClick={() => editor.chain().focus().toggleBold().run()}
                    title="Bold (Ctrl+B)"
                  >
                    <Bold className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={clsx('h-8 w-8 p-0', editor.isActive('italic') && 'bg-muted')}
                    onClick={() => editor.chain().focus().toggleItalic().run()}
                    title="Italic (Ctrl+I)"
                  >
                    <Italic className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={clsx('h-8 w-8 p-0', editor.isActive('underline') && 'bg-muted')}
                    onClick={() => editor.chain().focus().toggleUnderline().run()}
                    title="Underline (Ctrl+U)"
                  >
                    <UnderlineIcon className="h-4 w-4" />
                  </Button>
                  <div className="w-px h-6 bg-border mx-1" />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={clsx('h-8 w-8 p-0', editor.isActive('heading', { level: 1 }) && 'bg-muted')}
                    onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
                    title="Heading 1"
                  >
                    <span className="text-xs font-bold">H1</span>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={clsx('h-8 w-8 p-0', editor.isActive('heading', { level: 2 }) && 'bg-muted')}
                    onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
                    title="Heading 2"
                  >
                    <span className="text-xs font-bold">H2</span>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={clsx('h-8 w-8 p-0', editor.isActive('heading', { level: 3 }) && 'bg-muted')}
                    onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
                    title="Heading 3"
                  >
                    <span className="text-xs font-bold">H3</span>
                  </Button>
                  <div className="w-px h-6 bg-border mx-1" />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={clsx('h-8 w-8 p-0', editor.isActive('bulletList') && 'bg-muted')}
                    onClick={() => editor.chain().focus().toggleBulletList().run()}
                    title="Bullet List"
                  >
                    <List className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={clsx('h-8 w-8 p-0', editor.isActive('orderedList') && 'bg-muted')}
                    onClick={() => editor.chain().focus().toggleOrderedList().run()}
                    title="Numbered List"
                  >
                    <ListOrdered className="h-4 w-4" />
                  </Button>
                  <div className="w-px h-6 bg-border mx-1" />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={clsx('h-8 w-8 p-0', editor.isActive('codeBlock') && 'bg-muted')}
                    onClick={() => editor.chain().focus().toggleCodeBlock().run()}
                    title="Code Block"
                  >
                    <Code className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={clsx('h-8 w-8 p-0', editor.isActive('blockquote') && 'bg-muted')}
                    onClick={() => editor.chain().focus().toggleBlockquote().run()}
                    title="Blockquote"
                  >
                    <Quote className="h-4 w-4" />
                  </Button>
                </div>
              )}
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
                  <div className={clsx(
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
                    <EditorContent editor={editor} />
                  </div>
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
                              {comment.createdBy === currentUserId ? 'You' : comment.createdBy.slice(0, 8)}
                              {' · '}
                              {new Date(comment.createdAt).toLocaleDateString()}
                            </p>
                            {comment.createdBy === currentUserId && (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-5 w-5"
                                onClick={() => handleDeleteComment(comment._id)}
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
                            <img src={commentAttachmentPreview} alt="Preview" className="w-full h-full object-cover" />
                          </div>
                        ) : (
                          <File className="h-4 w-4 text-muted-foreground" />
                        )}
                        <span className="text-xs truncate flex-1">{commentAttachment.name}</span>
                        <Button size="icon" variant="ghost" className="h-5 w-5" onClick={clearCommentAttachment}>
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    )}
                    <div className="flex gap-2">
                      <input
                        type="file"
                        ref={commentAttachmentInputRef}
                        onChange={handleCommentAttachmentSelect}
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
                        onChange={(e) => setNewComment(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleCreateComment();
                          }
                        }}
                        className="h-8 text-sm"
                      />
                      <Button
                        size="sm"
                        onClick={handleCreateComment}
                        disabled={(!newComment.trim() && !commentAttachment) || createComment.isPending || isUploadingCommentAttachment}
                      >
                        {createComment.isPending || isUploadingCommentAttachment ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Plus className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="h-full flex items-center justify-center">
            <div className="text-center text-muted-foreground">
              <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>Select a note to edit</p>
              <p className="text-sm">or create a new one</p>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
