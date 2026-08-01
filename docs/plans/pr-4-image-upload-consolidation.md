# PR 4 Plan: Image Upload Consolidation & Next.js Image Migration

**Status:** Planning  
**Target branch:** `main` (branch name: `pr-4-image-upload-consolidation`)  
**Apps affected:** `apps/platform`, `apps/web`  
**Estimated scope:** ~15 files, 3 component deletions, 2 config updates

---

## 1. Goals

1. Replace the three duplicate image-upload components in each app with a single configurable `ImageUploadField`.
2. Swap plain `<img>` tags for Next.js `Image` (with `unoptimized` where images are dynamic/external) for layout stability, lazy loading, and optimization.
3. Remove committed backup files (`*.tsx.bak`).
4. Configure `apps/web/next.config.ts` to allow Convex Storage remote images (already done in `apps/platform`).

---

## 2. Current State

### 2.1 Duplicated upload components

| App | Component | File | Notes |
|-----|-----------|------|-------|
| `apps/platform` | `AdminImageUpload` | `components/admin/admin-image-upload.tsx` | Multi-file support, no crop, default endpoint `/api/admin/upload`. |
| `apps/platform` | `InstructorImageUpload` | `components/admin/instructor-image-upload.tsx` | Single file, returns `(url, path)` on complete, endpoint `/api/instructor/student-results/upload`. |
| `apps/platform` | `ImageUploadField` | `components/admin/image-upload-field.tsx` | Single file, crop dialog, `instructorId` + `type` (`profile`/`portfolio`/`result`), endpoint `/api/admin/instructors/upload`. |
| `apps/web` | `AdminImageUpload` | `components/admin/admin-image-upload.tsx` | Same as platform; multi-file support. |
| `apps/web` | `InstructorImageUpload` | `components/admin/instructor-image-upload.tsx` | Same as platform; no crop. |
| `apps/web` | `ImageUploadField` | `components/admin/image-upload-field.tsx` | Same as platform minus crop dialog. |

All three share: dropzone, URL input, preview, error UI, accepted types, and styling. Differences are minor: endpoint, multi-file, crop, and `onUploadComplete` shape.

### 2.2 Remaining `<img>` tags

| App | File | Line | Context |
|-----|------|------|---------|
| `apps/platform` | `components/admin/admin-image-upload.tsx` | 199 | Upload preview. |
| `apps/platform` | `components/admin/instructor-image-upload.tsx` | 190 | Upload preview. |
| `apps/platform` | `components/admin/image-upload-field.tsx` | 241 | Upload preview. |
| `apps/platform` | `components/workspace/notes.tsx` | 1196 | Comment attachment preview (data URL). |
| `apps/platform` | `app/instructor/onboarding/page.tsx` | 219 | Onboarding signed-url gallery. |
| `apps/web` | `components/admin/admin-image-upload.tsx` | 186 | Upload preview. |
| `apps/web` | `components/admin/instructor-image-upload.tsx` | 177 | Upload preview. |
| `apps/web` | `components/admin/image-upload-field.tsx` | 183 | Upload preview. |
| `apps/web` | `app/admin/instructors/[id]/edit/page.tsx` | 678 | Portfolio grid preview. |
| `apps/web` | `app/admin/instructors/[id]/edit/page.tsx` | 879 | Student result grid preview. |
| `apps/web` | `app/admin/instructors/create/page.tsx` | 417 | Portfolio grid preview. |
| `apps/web` | `app/instructor/profile/profile-form.tsx` | 596 | Student result grid preview. |

### 2.3 Backup files

- `apps/platform/components/landing/instructor-carousel.tsx.bak`
- `apps/web/components/landing/instructor-carousel.tsx.bak`

### 2.4 Image config

- `apps/platform/next.config.ts` already has `images.remotePatterns` for `**.convex.cloud`.
- `apps/web/next.config.ts` does **not** have any remotePatterns. Because both apps store uploaded images in Convex Storage, web needs the same pattern.

---

## 3. Proposed `ImageUploadField` API

A single component in each app under `components/admin/image-upload-field.tsx` that covers all current use cases.

```ts
interface ImageUploadFieldProps {
  label?: string;
  value?: string;
  onChange: (url: string) => void;
  uploadEndpoint?: string;
  placeholder?: string;

  // Multiple uploads (admin generic, product form, portfolio bulk)
  multiple?: boolean;
  maxFiles?: number;
  onMultipleUpload?: (urls: string[]) => void;

  // Instructor-specific path returned after upload
  onUploadComplete?: (url: string, path: string) => void;

  // Instructor admin crop/upload route
  instructorId?: string;
  type?: "profile" | "portfolio" | "result";

  // Crop feature (platform only; react-image-crop is present there)
  enableCrop?: boolean;
  cropAspectRatio?: number;

  // Preview sizing
  previewSize?: number; // default 128 (w-32 h-32)
  previewClassName?: string;
}
```

### 3.1 Consolidation rules

- `AdminImageUpload` callers migrate to `ImageUploadField` with:
  - `multiple={true}` + `maxFiles={...}` + `onMultipleUpload={...}` where needed.
  - `uploadEndpoint` set to the previous default if different.
- `InstructorImageUpload` callers migrate to `ImageUploadField` with:
  - `uploadEndpoint` set to the previous endpoint.
  - `onUploadComplete` for the `(url, path)` callback.
- `ImageUploadField` callers keep the same props; only the import path stays the same.

### 3.2 Implementation notes

- Keep the component in each app (do **not** move to `@mentorships/ui` in this PR). The two apps share identical base logic, but the platform version uses `react-image-crop`, which is not installed in `apps/web`. Moving to a shared package would require adding peer dependencies and cropping behavior decisions. This is flagged as a follow-up for PR 8 or a later hardening PR.
- Use `Image` from `next/image` for the preview, with `unoptimized` when the source is a dynamic Convex Storage URL.
- For the data URL in `notes.tsx`, use `Image` with `unoptimized` and a fixed `width`/`height`.
- For the onboarding gallery, use `Image` with `unoptimized` and a fill container or explicit width/height.
- Preserve all existing behavior: drag-and-drop, URL input, clear button, loading state, error display, accepted types, and a11y labels.

---

## 4. File-by-File Changes

### 4.1 `apps/platform`

| Action | File | Details |
|--------|------|---------|
| Delete | `components/admin/admin-image-upload.tsx` | Logic merged into `ImageUploadField`. |
| Delete | `components/admin/instructor-image-upload.tsx` | Logic merged into `ImageUploadField`. |
| Rewrite | `components/admin/image-upload-field.tsx` | New single component; supports crop, multi-file, `onUploadComplete`, and Next.js `Image`. |
| Update | `components/admin/crop-dialog.tsx` | Keep as-is; import it from the new `ImageUploadField` when `enableCrop` is true. |
| Update | `app/admin/products/_components/product-form.tsx` | Import `ImageUploadField` instead of `AdminImageUpload`; pass `multiple`, `maxFiles`, `onMultipleUpload`. |
| Update | `app/admin/instructors/[id]/edit/page.tsx` | Import `ImageUploadField` (already used); verify portfolio/student-result grids use Next.js `Image`. |
| Update | `app/instructor/profile/profile-form.tsx` | Import `ImageUploadField` instead of `InstructorImageUpload`; pass `uploadEndpoint` and `onUploadComplete`. |
| Update | `components/workspace/notes.tsx` | Replace `<img>` comment preview with Next.js `Image` (data URL, unoptimized). |
| Update | `app/instructor/onboarding/page.tsx` | Replace onboarding gallery `<img>` with Next.js `Image` (unoptimized). |
| Delete | `components/landing/instructor-carousel.tsx.bak` | Committed backup. |

### 4.2 `apps/web`

| Action | File | Details |
|--------|------|---------|
| Delete | `components/admin/admin-image-upload.tsx` | Logic merged into `ImageUploadField`. |
| Delete | `components/admin/instructor-image-upload.tsx` | Logic merged into `ImageUploadField`. |
| Rewrite | `components/admin/image-upload-field.tsx` | New single component; **no crop** (react-image-crop absent). Supports multi-file, `onUploadComplete`, and Next.js `Image`. |
| Update | `app/admin/instructors/[id]/edit/page.tsx` | Import `ImageUploadField` (already used); migrate portfolio/student-result `<img>` to Next.js `Image`. |
| Update | `app/admin/instructors/create/page.tsx` | Import `ImageUploadField` instead of `AdminImageUpload`; pass `multiple`/`maxFiles`/`onMultipleUpload`; migrate portfolio `<img>` to Next.js `Image`. |
| Update | `app/instructor/profile/profile-form.tsx` | Import `ImageUploadField` instead of `InstructorImageUpload`; pass `uploadEndpoint` and `onUploadComplete`; migrate student-result `<img>` to Next.js `Image`. |
| Update | `next.config.ts` | Add `images.remotePatterns` for `**.convex.cloud` (match platform). |
| Delete | `components/landing/instructor-carousel.tsx.bak` | Committed backup. |

---

## 5. Next.js Image Migration Rules

1. **Upload preview inside `ImageUploadField`**
   - Container: `relative w-32 h-32` (or configurable).
   - Use `<Image src={urlInput} alt="Preview" fill unoptimized sizes="128px" className="object-cover" />`.
   - Handle broken URLs with `onError` to show a placeholder fallback.

2. **Portfolio / result grids in page components**
   - Replace `<img className="w-full h-24 object-cover rounded" />` with a fill container + `<Image fill unoptimized sizes="..." className="object-cover rounded" />`.
   - Keep existing `alt` text.

3. **Onboarding gallery (`apps/platform/app/instructor/onboarding/page.tsx`)**
   - Each image is a signed Convex URL. Use a fixed container with `Image fill unoptimized`.

4. **Comment attachment preview (`apps/platform/components/workspace/notes.tsx`)**
   - `commentAttachmentPreview` is a `data:` URL from `FileReader`. Use `<Image src={...} alt="Attachment preview" width={40} height={40} unoptimized />`.

5. **Web remotePatterns config**
   ```ts
   images: {
     remotePatterns: [
       {
         protocol: "https",
         hostname: "**.convex.cloud",
         port: "",
         pathname: "/**",
       },
     ],
   },
   ```

---

## 6. Testing & Verification

### 6.1 Local build

```bash
cd apps/platform
npm run typecheck
npm run lint
npm run build

cd apps/web
npm run typecheck
npm run lint
npm run build
```

### 6.2 Manual functional checks

- **Platform:**
  - Admin creates product with multiple product images.
  - Admin edits instructor profile image (crop should still work).
  - Instructor uploads profile image and portfolio images.
  - Instructor views onboarding submissions and images load.
  - Workspace notes with image attachment show preview.
- **Web:**
  - Admin creates instructor with portfolio images.
  - Admin edits instructor portfolio / student results.
  - Instructor uploads profile image and portfolio images.
  - Instructor adds student results.

### 6.3 Greptile review

Run `npx greptile@latest review` before creating the PR.

### 6.4 PR checklist

- [ ] `apps/platform` builds, lints, and typechecks.
- [ ] `apps/web` builds, lints, and typechecks.
- [ ] No `*.tsx.bak` files remain.
- [ ] No plain `<img>` tags remain in the touched files (workspace preview, onboarding, admin/instructor forms).
- [ ] All upload flows still produce valid URLs.
- [ ] Crop dialog still works in `apps/platform`.
- [ ] Web `next.config.ts` has Convex remotePatterns.

---

## 7. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Data URL preview breaks with Next.js Image | Use `unoptimized` and explicit width/height. |
| Crop dialog import path changes | Keep `crop-dialog.tsx` in `apps/platform/components/admin` and import it inside the new component. |
| Multi-file upload behavior regresses | Preserve sequential `uploadFile` loop and `onMultipleUpload` callback. |
| Web missing `react-image-crop` | Do not enable crop in `apps/web` in this PR. |
| External image URLs blocked by Next.js | Add `**.convex.cloud` to web config; use `unoptimized` for all dynamic uploads. |

---

## 8. Follow-up PR: Extract `ImageUploadField` to `@mentorships/ui`

After PR 4 lands, the two apps will each have a single, near-identical `ImageUploadField`. The next step is to extract it into the shared UI package.

**Proposed PR scope:**
- Move `ImageUploadField` and `CropDialog` from `apps/platform/components/admin/` into `packages/ui/src/components/`.
- Add `react-dropzone`, `lucide-react`, and `react-image-crop` as `dependencies` or `peerDependencies` of `@mentorships/ui`.
- Install `react-image-crop` in `apps/web` so both apps share the same dependency set.
- Make cropping optional via `enableCrop` / `cropAspectRatio` so `apps/web` can keep its current behavior if desired, or enable cropping uniformly.
- Re-export `ImageUploadField` from both apps and delete the per-app copies.
- Update `apps/web` and `apps/platform` to consume the shared component.
- Verify both apps still build, lint, and typecheck.

**Why this is a separate PR:**
- PR 4 should remain a refactor that stays within each app.
- Cross-package component extraction changes dependency graphs and public API boundaries, which warrants its own review and rollout.

## 9. Other follow-up opportunities

- **Remove console.logs from upload routes:** API routes like `/api/admin/upload/route.ts` have debug `console.log` calls. These are out of scope for PR 4 but fit PR 8.
- **Add component tests:** RTL tests for `ImageUploadField` (drop, URL input, preview, error) are planned for PR 6.

---

*Last updated: 2026-07-31*
