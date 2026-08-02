'use client';

import { Button } from '@/components/ui/button';
import { Bold, Italic, Underline as UnderlineIcon, List, ListOrdered } from 'lucide-react';
import { clsx } from 'clsx';
import { type Editor } from '@tiptap/react';

interface NoteToolbarProps {
  editor: Editor | null;
}

export function NoteToolbar({ editor }: NoteToolbarProps) {
  if (!editor) return null;

  return (
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
    </div>
  );
}
