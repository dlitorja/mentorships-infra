/**
 * Client-side workspace upload/resource limits. These values must stay
 * in sync with the backend source of truth in
 * convex/workspaceConstants.ts.
 */

export const WORKSPACE_IMAGE_CAPS = {
  student: 75,
  instructor: 150,
  admin: 9999,
} as const;

export const WORKSPACE_FILE_CAPS = {
  student: 25,
  instructor: 50,
} as const;

export const MAX_WORKSPACE_FILE_BYTES = 50 * 1024 * 1024;

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const PER_UPLOAD_CAP = 5;

// UI-specific alias for chat multi-image uploads.
export const MAX_CHAT_IMAGES_PER_UPLOAD = PER_UPLOAD_CAP;

export const MAX_CHAT_FILE_BYTES = 50 * 1024 * 1024;
export const LARGE_CHAT_FILE_BYTES = 10 * 1024 * 1024;

// PR #convex-egress-3: cap on call recordings returned by
// getCallRecordingsForWorkspace. Keep in sync with the backend
// take(N) in convex/sessions.ts.
export const CALL_RECORDINGS_CAP = 50;
