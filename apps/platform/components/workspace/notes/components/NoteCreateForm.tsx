'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Save, X, Tag } from 'lucide-react';
import { Id } from '@/convex/_generated/dataModel';

interface NoteCreateFormProps {
  newTitle: string;
  onNewTitleChange: (value: string) => void;
  tagNewNoteToCall: boolean;
  onTagNewNoteToCallChange: (value: boolean) => void;
  activeSessionId: Id<'sessions'> | null;
  isCreating: boolean;
  onCancel: () => void;
  onCreate: () => void;
}

export function NoteCreateForm({
  newTitle,
  onNewTitleChange,
  tagNewNoteToCall,
  onTagNewNoteToCallChange,
  activeSessionId,
  isCreating,
  onCancel,
  onCreate,
}: NoteCreateFormProps) {
  if (!isCreating) return null;

  return (
    <div className="mb-3 p-3 border rounded-lg space-y-2">
      <Input
        placeholder="Note title"
        value={newTitle}
        onChange={(e) => onNewTitleChange(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && onCreate()}
        autoFocus
      />
      {activeSessionId && (
        <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
          <input
            type="checkbox"
            className="h-3.5 w-3.5"
            checked={tagNewNoteToCall}
            onChange={(e) => onTagNewNoteToCallChange(e.target.checked)}
          />
          <Tag className="h-3 w-3" />
          Tag to current call
        </label>
      )}
      <div className="flex gap-2">
        <Button size="sm" onClick={onCreate} disabled={!newTitle.trim()}>
          <Save className="h-4 w-4 mr-1" />
          Create
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel}>
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
