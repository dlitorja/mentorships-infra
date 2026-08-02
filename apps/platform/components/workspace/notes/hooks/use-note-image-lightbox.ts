'use client';

import { useState } from 'react';
import { useEditor, type Editor } from '@tiptap/react';

/**
 * Walk the editor's doc and collect `src` attributes for every
 * image node, in document order. Used by `onUpdate`, `onCreate`,
 * and the note-switch effect so the lightbox image list stays in
 * sync with whichever note is currently selected. Hoisted out of
 * the component so it has a stable identity — keeping it inline
 * would force every effect that references it to re-run on every
 * render (eslint react-hooks/exhaustive-deps) without changing
 * behavior.
 */
function collectNoteImageUrls(
  editorInstance: NonNullable<ReturnType<typeof useEditor>>
): string[] {
  const urls: string[] = [];
  editorInstance.state.doc.descendants((node) => {
    const src = node.attrs.src;
    if (node.type.name === "image" && typeof src === "string" && src.length > 0) {
      urls.push(src);
    }
  });
  return urls;
}

export function useNoteImageLightbox() {
  const [noteImageLightboxOpen, setNoteImageLightboxOpen] = useState(false);
  const [noteImageLightboxIndex, setNoteImageLightboxIndex] = useState(0);
  const [noteImageUrls, setNoteImageUrls] = useState<string[]>([]);

  /**
   * Push `urls` into `noteImageUrls` only when the contents actually
   * differ from the previous value. Keeps the array reference stable
   * across keystroke-level `onUpdate` callbacks that don't touch any
   * image, which avoids re-rendering consumers (notably
   * `ChatImageLightbox`) on every character typed in the editor.
   */
  const setNoteImageUrlsIfChanged = (urls: string[]): void => {
    setNoteImageUrls((prev) => {
      if (
        prev.length === urls.length &&
        prev.every((src, i) => src === urls[i])
      ) {
        return prev;
      }
      return urls;
    });
  };

  const updateNoteImageUrls = (editor: Editor | null) => {
    if (editor) {
      setNoteImageUrlsIfChanged(collectNoteImageUrls(editor as NonNullable<ReturnType<typeof useEditor>>));
    }
  };

  /**
   * Open the note-image lightbox at the index of `target` within the
   * current `noteImageUrls` list. Returns false if `target` isn't a
   * recognized note image (e.g. a comment avatar). Both the click
   * and keyboard handlers delegate to this so the lightbox-opening
   * path stays in one place.
   */
  const openLightboxForImage = (target: HTMLImageElement): boolean => {
    if (!target.classList.contains('note-image')) return false;
    const src = target.getAttribute('src');
    if (!src) return false;
    const index = noteImageUrls.indexOf(src);
    if (index === -1) return false;
    setNoteImageLightboxIndex(index);
    setNoteImageLightboxOpen(true);
    return true;
  };

  const handleNoteEditorClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    const target = event.target;
    if (!(target instanceof HTMLImageElement)) return;
    openLightboxForImage(target);
  };

  const handleNoteEditorKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const target = event.target;
    if (!(target instanceof HTMLImageElement)) return;
    if (!openLightboxForImage(target)) return;
    event.preventDefault();
    event.stopPropagation();
  };

  return {
    noteImageUrls,
    setNoteImageUrls,
    setNoteImageUrlsIfChanged,
    updateNoteImageUrls,
    noteImageLightboxOpen,
    setNoteImageLightboxOpen,
    noteImageLightboxIndex,
    setNoteImageLightboxIndex,
    openLightboxForImage,
    handleNoteEditorClick,
    handleNoteEditorKeyDown,
  };
}
