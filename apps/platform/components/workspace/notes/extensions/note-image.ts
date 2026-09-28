'use client';

import Image from '@tiptap/extension-image';

/**
 * PR workspace-storage-3c (Greptile P1 "Saved note images expire"):
 * custom Tiptap Image extension that carries a `b2Key` attribute
 * alongside the legacy `src`. The note's autosaved HTML stores
 * `<img data-b2-key="...">` (the `src` may be stale or empty); on
 * load the editor hook `useNoteEditor` walks the doc, resolves
 * every `b2Key` via `getWorkspaceDownloadUrl`, and updates the
 * `src` attribute. Pre-PR-3c notes that persisted a 1-hour signed
 * URL directly in `src` continue to render the expired URL on
 * reload — those are remediated on the next autosave once the
 * editor rewrites `src` to a fresh value.
 *
 * The `src` attribute is still required by Tiptap Image (it
 * renders through `<img src=…>`), so the load-time hook also
 * populates `src` for any node that has `b2Key` but missing
 * `src`. Once `src` is populated, the autosave will overwrite
 * it on the next edit (or never — the schema is "b2Key is the
 * source of truth, src is a derived cache"). Follow-up work:
 * prune the legacy `src` field from autosaved HTML so we don't
 * store ephemeral URLs in the database at all.
 */
export const NoteImage = Image.extend({
  name: 'image',

  addAttributes() {
    return {
      // Standard Image attrs (Tiptap Image defines `src`,
      // `alt`, `title`).
      ...this.parent?.(),
      // PR workspace-storage-3c: the B2 key for this image.
      // Set when the image was inserted via the dotted-line
      // upload path (`handleDottedLineDrop` in
      // `useNoteEditor`). `null` for legacy Convex-storage
      // images that pre-date PR 3c.
      b2Key: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-b2-key'),
        renderHTML: (attributes) => {
          if (!attributes.b2Key) return {};
          return { 'data-b2-key': attributes.b2Key };
        },
      },
    };
  },
});
