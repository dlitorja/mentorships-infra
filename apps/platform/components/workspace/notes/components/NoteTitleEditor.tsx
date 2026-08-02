'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Save, X } from 'lucide-react';
import { Id } from '@/convex/_generated/dataModel';

interface NoteTitleEditorProps {
  title: string;
  value: string;
  onChange: (value: string) => void;
  onUpdate: (noteId: Id<'workspaceNotes'>) => void;
  onCancel: () => void;
  noteId: Id<'workspaceNotes'>;
  headerTitleInputRef: React.RefObject<HTMLInputElement | null>;
  titleEditGuardRef: React.MutableRefObject<boolean>;
  editingNoteIdRef: React.MutableRefObject<Id<'workspaceNotes'> | null>;
  editingTitleSurfaceRef: React.MutableRefObject<'list' | 'header' | null>;
}

export function NoteTitleEditor({
  title: _title,
  value,
  onChange,
  onUpdate,
  onCancel,
  noteId,
  headerTitleInputRef,
  titleEditGuardRef,
  editingNoteIdRef,
  editingTitleSurfaceRef,
}: NoteTitleEditorProps) {
  return (
    <div className="flex items-center gap-1">
      <Input
        ref={headerTitleInputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && onUpdate(noteId)}
        onBlur={() => {
          if (titleEditGuardRef.current) {
            titleEditGuardRef.current = false;
            return;
          }
          const blurredNoteId = noteId;
          setTimeout(() => {
            if (editingNoteIdRef.current !== blurredNoteId || editingTitleSurfaceRef.current !== 'header') return;
            if (value?.trim()) {
              onUpdate(blurredNoteId);
            } else {
              onCancel();
            }
          }, 50);
        }}
        className="h-8 text-sm"
      />
      <Button size="icon" variant="ghost" className="h-8 w-8" onMouseDown={(e) => { e.preventDefault(); titleEditGuardRef.current = true; }} onClick={() => { titleEditGuardRef.current = false; onUpdate(noteId); }}>
        <Save className="h-4 w-4" />
      </Button>
      <Button size="icon" variant="ghost" className="h-8 w-8" onMouseDown={(e) => { e.preventDefault(); titleEditGuardRef.current = true; }} onClick={() => { titleEditGuardRef.current = false; onCancel(); }}>
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
