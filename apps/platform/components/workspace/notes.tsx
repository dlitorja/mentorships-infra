'use client';

import { useState, useEffect, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { Id } from '../../../../convex/_generated/dataModel';
import { 
  useWorkspaceNotes, 
  useUpdateWorkspaceNote, 
  useDeleteWorkspaceNote 
} from '@/lib/queries/convex/use-workspaces';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, Plus, Trash2, Edit2, Save, X, FileText } from 'lucide-react';
import { clsx } from 'clsx';
import { toast } from 'sonner';

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
  const autosaveTimeoutsRef = useRef(new Map<Id<'workspaceNotes'>, ReturnType<typeof setTimeout>>());
  const loadedNoteIdRef = useRef<Id<'workspaceNotes'> | null>(null);
  const selectedNoteIdRef = useRef<Id<'workspaceNotes'> | null>(null);

  const { data: notes, isLoading, refetch } = useWorkspaceNotes(workspaceId);
  const updateNote = useUpdateWorkspaceNote();
  const deleteNote = useDeleteWorkspaceNote();

  const selectedNote = notes?.find(n => n._id === selectedNoteId);

  useEffect(() => {
    selectedNoteIdRef.current = selectedNoteId;
  }, [selectedNoteId]);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({
        placeholder: 'Start writing your note...',
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
        const existingTimeout = autosaveTimeoutsRef.current.get(noteId);
        if (existingTimeout) {
          clearTimeout(existingTimeout);
        }

        const content = editor.getHTML();
        const timeout = setTimeout(async () => {
          try {
            await updateNote.mutateAsync({
              id: noteId,
              content,
            });
          } catch (error) {
            console.error('Failed to auto-save note:', error);
          } finally {
            if (autosaveTimeoutsRef.current.get(noteId) === timeout) {
              autosaveTimeoutsRef.current.delete(noteId);
            }
          }
        }, 1000);
        autosaveTimeoutsRef.current.set(noteId, timeout);
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
    } else {
      editor.commands.setContent('', { emitUpdate: false });
      loadedNoteIdRef.current = null;
    }
  }, [editor, selectedNote]);

  useEffect(() => {
    return () => {
      autosaveTimeoutsRef.current.forEach((timeout) => clearTimeout(timeout));
      autosaveTimeoutsRef.current.clear();
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
              <div className="p-3 border-b shrink-0">
                <h2 className="text-lg font-semibold">{selectedNote.title}</h2>
                <p className="text-xs text-muted-foreground">
                  Last updated: {new Date(selectedNote.updatedAt).toLocaleString()}
                </p>
              </div>
              <div className="flex-1 overflow-y-auto">
                <EditorContent editor={editor} />
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
