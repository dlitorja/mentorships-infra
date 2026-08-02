'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FileText, Edit2, Trash2, Tag, XCircle, Save, X } from 'lucide-react';
import { clsx } from 'clsx';
import { Id } from '@/convex/_generated/dataModel';
import type { NoteSummary } from '../types';

interface NoteListItemProps {
  note: NoteSummary;
  isSelected: boolean;
  isTaggedToCall: boolean;
  isLiveSessionNote: boolean | undefined;
  activeSessionId: Id<'sessions'> | null;
  isEditing: boolean;
  editingTitleValue: string;
  onSelect: () => void;
  onStartEdit: () => void;
  onTitleUpdate: () => void;
  onCancelEdit: () => void;
  onTitleChange: (value: string) => void;
  onTagToCall: () => void;
  onUntagFromCall: () => void;
  onDelete: () => void;
  titleInputRef: React.RefObject<HTMLInputElement | null>;
  titleEditGuardRef: React.MutableRefObject<boolean>;
  editingNoteIdRef: React.MutableRefObject<Id<'workspaceNotes'> | null>;
  editingTitleSurfaceRef: React.MutableRefObject<'list' | 'header' | null>;
}

export function NoteListItem({
  note,
  isSelected,
  isTaggedToCall,
  isLiveSessionNote,
  activeSessionId,
  isEditing,
  editingTitleValue,
  onSelect,
  onStartEdit,
  onTitleUpdate,
  onCancelEdit,
  onTitleChange,
  onTagToCall,
  onUntagFromCall,
  onDelete,
  titleInputRef,
  titleEditGuardRef,
  editingNoteIdRef,
  editingTitleSurfaceRef,
}: NoteListItemProps) {
  return (
    <div
      className={clsx(
        "group flex items-center justify-between p-2 rounded-md cursor-pointer transition-colors",
        isSelected
          ? "bg-primary text-primary-foreground"
          : "hover:bg-muted"
      )}
      onClick={onSelect}
    >
      {isEditing ? (
        <div className="flex-1 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <Input
            ref={titleInputRef}
            value={editingTitleValue}
            onChange={(e) => onTitleChange(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onTitleUpdate()}
            onBlur={() => {
              if (titleEditGuardRef.current) {
                titleEditGuardRef.current = false;
                return;
              }
              const blurredNoteId = note._id;
              setTimeout(() => {
                if (editingNoteIdRef.current !== blurredNoteId || editingTitleSurfaceRef.current !== 'list') return;
                if (editingTitleValue?.trim()) {
                  onTitleUpdate();
                } else {
                  onCancelEdit();
                }
              }, 50);
            }}
            className="h-6 text-sm"
          />
          <Button size="icon" variant="ghost" className="h-6 w-6" onMouseDown={(e) => { e.preventDefault(); titleEditGuardRef.current = true; }} onClick={() => { titleEditGuardRef.current = false; onTitleUpdate(); }}>
            <Save className="h-3 w-3" />
          </Button>
          <Button size="icon" variant="ghost" className="h-6 w-6" onMouseDown={(e) => { e.preventDefault(); titleEditGuardRef.current = true; }} onClick={() => { titleEditGuardRef.current = false; onCancelEdit(); }}>
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
            {activeSessionId && note.sessionId === activeSessionId && !isLiveSessionNote && (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-6 w-6"
                title="Untag from current call"
                onClick={(e) => {
                  e.stopPropagation();
                  onUntagFromCall();
                }}
              >
                <XCircle className="h-3 w-3" />
              </Button>
            )}
            {activeSessionId && !note.sessionId && !isLiveSessionNote && (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-6 w-6"
                title="Tag to current call"
                onClick={(e) => {
                  e.stopPropagation();
                  onTagToCall();
                }}
              >
                <Tag className="h-3 w-3" />
              </Button>
            )}
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6"
              onClick={(e) => { e.stopPropagation(); onStartEdit(); }}
            >
              <Edit2 className="h-3 w-3" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-6 w-6 text-destructive"
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
