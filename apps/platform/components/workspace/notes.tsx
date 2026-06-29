'use client';

import { useState, useEffect, useRef } from 'react';
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
  type NoteComment,
} from '@/lib/queries/convex/use-workspaces';
import { uploadImageForChat, MAX_CHAT_FILE_BYTES, LARGE_CHAT_FILE_BYTES } from '@/lib/workspace-image-upload';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, Plus, Trash2, Edit2, Save, X, FileText, ImageIcon, Bold, Italic, Underline as UnderlineIcon, List, ListOrdered, Code, Quote, MessageCircle } from 'lucide-react';
import { clsx } from 'clsx';
import { toast } from 'sonner';
import { api } from '@/convex/_generated/api';
import { useConvexAction } from '@convex-dev/react-query';

interface Note {
  _id: Id<'workspaceNotes'>;
  workspaceId: Id<'workspaces'>;
  title: string;
  content: string;
  createdBy: string;
  updatedAt: number;
}

interface WorkspaceNotesProps {
  workspaceId: Id<'workspaces'>;
  currentUserId: string;
}

interface AutosaveEntry {
  timeout?: ReturnType<typeof setTimeout>;
  content: string;
  sequence: number;
  inFlight: boolean;
}

/**
 * Rich text note-taking component for a workspace.
 * Uses TipTap editor with auto-save on content changes.
 * Supports creating, editing titles, and deleting notes.
 *
 * @param workspaceId - Convex workspace ID
 * @param currentUserId - Current authenticated user's ID
 */
export default function WorkspaceNotes({ workspaceId, currentUserId }: WorkspaceNotesProps) {
  const [selectedNoteId, setSelectedNoteId] = useState<Id<'workspaceNotes'> | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [editingTitle, setEditingTitle] = useState<string | null>(null);
  const autosavesRef = useRef(new Map<Id<'workspaceNotes'>, AutosaveEntry>());
  const loadedNoteIdRef = useRef<Id<'workspaceNotes'> | null>(null);
  const selectedNoteIdRef = useRef<Id<'workspaceNotes'> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [newComment, setNewComment] = useState('');
  const newCommentRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const { data: notes, isLoading, refetch } = useWorkspaceNotes(workspaceId);
  const updateNote = useUpdateWorkspaceNote();
  const deleteNote = useDeleteWorkspaceNote();
  const embedImageInNote = useEmbedImageInNote();
  const generateUploadUrl = useConvexAction(api.workspaceActions.generateWorkspaceImageUploadUrl);
  const updateNoteRef = useRef(updateNote);

  const { data: comments } = useNoteComments(selectedNoteId || '');
  const createComment = useCreateNoteComment();
  const deleteComment = useDeleteNoteComment();

  const selectedNote = notes?.find(n => n._id === selectedNoteId);

  useEffect(() => {
    updateNoteRef.current = updateNote;
  }, [updateNote]);

  useEffect(() => {
    selectedNoteIdRef.current = selectedNoteId;
  }, [selectedNoteId]);

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
        resize: {
          enabled: true,
          minWidth: 50,
          minHeight: 50,
        },
      }),
    ],
    content: selectedNote?.content || '',
    editorProps: {
      attributes: {
        class: 'prose prose-sm sm:prose-base max-w-none focus:outline-none min-h-[200px] p-4',
      },
      handleDrop: (view, event, slice, moved) => {
        if (moved) return false;
        const files = event.dataTransfer?.files;
        if (!files || files.length === 0) return false;
        
        const file = files[0];
        if (!file.type.startsWith('image/')) return false;
        
        event.preventDefault();
        
        const pos = view.posAtCoords({
          left: event.clientX,
          top: event.clientY,
        });
        
        if (pos) {
          void handleDroppedImage(file, pos.pos);
        }
        
        return true;
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
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create note');
      }

      const { noteId } = await response.json();
      setNewTitle('');
      setIsCreating(false);
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
    if (!editingTitle?.trim()) return;
    
    try {
      await updateNote.mutateAsync({
        id: noteId,
        title: editingTitle.trim(),
      });
      setEditingTitle(null);
    } catch (error) {
      console.error('Failed to update title:', error);
      toast.error('Failed to update note title');
    }
  };

  const handleImageEmbed = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedNoteId) return;

    const imageUrl = await uploadImageForNote(file);
    if (imageUrl && editor) {
      editor.chain().focus().setImage({ src: imageUrl }).run();
    }
    e.target.value = '';
  };

  const uploadImageForNote = async (file: File): Promise<string | null> => {
    const noteIdForUpload = selectedNoteId;
    if (!noteIdForUpload) {
      toast.error('No note selected');
      return null;
    }

    if (file.size > MAX_CHAT_FILE_BYTES) {
      toast.error('Image is too large. Maximum size is 50MB.');
      return null;
    }
    if (file.size > LARGE_CHAT_FILE_BYTES) {
      toast.warning('Large file detected. This image will count toward your image limit.');
    }

    const toastId = toast.loading('Uploading image...');

    try {
      const uploadResult = await uploadImageForChat(
        workspaceId as Id<'workspaces'>,
        file,
        (args) => (generateUploadUrl as (args: { workspaceId: Id<'workspaces'> }) => Promise<string>)(args)
      );

      if (!uploadResult.success) {
        toast.error(uploadResult.error || 'Upload failed', { id: toastId });
        return null;
      }

      const imageUrl = await embedImageInNote.mutateAsync({
        noteId: noteIdForUpload,
        storageId: uploadResult.storageId as Id<"_storage">,
      });

      toast.success('Image inserted', { id: toastId });
      return imageUrl;
    } catch (error) {
      console.error('Failed to embed image:', error);
      toast.error('Failed to embed image', { id: toastId });
      return null;
    }
  };

  const handleDroppedImage = async (file: File, pos: number) => {
    const noteIdForUpload = selectedNoteId;
    if (!noteIdForUpload || !editor) return;

    const imageUrl = await uploadImageForNote(file);
    if (imageUrl && editor) {
      editor.chain().focus().insertContentAt(pos, {
        type: 'image',
        attrs: { src: imageUrl },
      }).run();
    }
  };

  const handleCreateComment = async () => {
    if (!newComment.trim() || !selectedNoteId) return;

    try {
      await createComment.mutateAsync({
        noteId: selectedNoteId,
        content: newComment.trim(),
      });
      setNewComment('');
    } catch (error) {
      console.error('Failed to create comment:', error);
      toast.error('Failed to add comment');
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
            <div className="flex gap-2">
              <Button size="sm" onClick={handleCreateNote} disabled={!newTitle.trim()}>
                <Save className="h-4 w-4 mr-1" />
                Create
              </Button>
              <Button size="sm" variant="outline" onClick={() => { setIsCreating(false); setNewTitle(''); }}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto space-y-1">
          {notes && notes.length > 0 ? (
            notes.map((note: Note) => (
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
                {editingTitle === note._id ? (
                  <div className="flex-1 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    <Input
                      value={editingTitle}
                      onChange={(e) => setEditingTitle(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleTitleUpdate(note._id)}
                      className="h-6 text-sm"
                      autoFocus
                    />
                    <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => handleTitleUpdate(note._id)}>
                      <Save className="h-3 w-3" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setEditingTitle(null)}>
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <FileText className="h-4 w-4 shrink-0" />
                      <span className="truncate text-sm">{note.title}</span>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6"
                        onClick={(e) => { e.stopPropagation(); setEditingTitle(note.title); }}
                      >
                        <Edit2 className="h-3 w-3" />
                      </Button>
                      <Button
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
            ))
          ) : (
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
          )}
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 min-w-0">
        {selectedNote ? (
          <Card className="h-full">
            <CardContent className="p-0 h-full overflow-hidden flex flex-col">
              <div className="p-3 border-b shrink-0 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold truncate">{selectedNote.title}</h2>
                  <p className="text-xs text-muted-foreground">
                    Last updated: {new Date(selectedNote.updatedAt).toLocaleString()}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleImageEmbed}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={embedImageInNote.isPending}
                    title="Embed image in note"
                  >
                    {embedImageInNote.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <ImageIcon className="h-4 w-4" />
                    )}
                    <span className="ml-1 text-xs">Embed image</span>
                  </Button>
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
                    "flex-1 overflow-y-auto flex flex-col transition-colors",
                    isDragOver && "bg-primary/5 ring-2 ring-primary ring-inset"
                  )}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (e.dataTransfer.types.includes('Files')) {
                      setIsDragOver(true);
                    }
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                      setIsDragOver(false);
                    }
                  }}
                  onDrop={(e) => {
                    const files = e.dataTransfer?.files;
                    if (!files || files.length === 0) {
                      setIsDragOver(false);
                      return;
                    }

                    const file = files[0];
                    if (!file.type.startsWith('image/')) {
                      setIsDragOver(false);
                      return;
                    }

                    const editorRect = editor.view.dom.getBoundingClientRect();
                    const isInsideEditor = 
                      e.clientX >= editorRect.left &&
                      e.clientX <= editorRect.right &&
                      e.clientY >= editorRect.top &&
                      e.clientY <= editorRect.bottom;

                    if (!isInsideEditor) {
                      e.preventDefault();
                      toast.error('Drop image inside the editor area');
                    }

                    setIsDragOver(false);
                  }}
                >
                  <div className="flex-1 overflow-y-auto">
                    <EditorContent editor={editor} />
                  </div>
                <div className="border-t shrink-0 max-h-48 overflow-y-auto bg-muted/30">
                  <div className="px-3 py-2 flex items-center justify-between">
                    <h4 className="text-sm font-medium flex items-center gap-1">
                      <MessageCircle className="h-4 w-4" />
                      Comments {comments && comments.length > 0 && `(${comments.length})`}
                    </h4>
                  </div>
                  <div className="px-3 pb-2 space-y-2">
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
                          <p className="mt-1">{comment.content}</p>
                        </div>
                      ))
                    ) : (
                      <p className="text-xs text-muted-foreground text-center py-2">No comments yet</p>
                    )}
                  </div>
                  <div className="px-3 pb-3 flex gap-2">
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
                    <Button size="sm" onClick={handleCreateComment} disabled={!newComment.trim() || createComment.isPending}>
                      {createComment.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Plus className="h-4 w-4" />
                      )}
                    </Button>
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
