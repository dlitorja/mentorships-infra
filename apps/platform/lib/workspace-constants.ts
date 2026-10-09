/**
 * Client-side workspace upload/resource limits. These values must stay
 * in sync with the backend source of truth in
 * convex/workspaceConstants.ts.
 */

export const WORKSPACE_IMAGE_CAPS = {
  student: 100,
  instructor: 250,
  admin: 9999,
} as const;

export const WORKSPACE_FILE_CAPS = {
  student: 40,
  instructor: 75,
} as const;

export const MAX_WORKSPACE_FILE_BYTES = 500 * 1024 * 1024;

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const PER_UPLOAD_CAP = 5;

// UI-specific alias for chat multi-image uploads.
export const MAX_CHAT_IMAGES_PER_UPLOAD = PER_UPLOAD_CAP;

export const MAX_CHAT_FILE_BYTES = 500 * 1024 * 1024;
export const LARGE_CHAT_FILE_BYTES = 100 * 1024 * 1024;

// PR #convex-egress-3: cap on call recordings returned by
// getCallRecordingsForWorkspace. Keep in sync with the backend
// take(N) in convex/sessions.ts.
export const CALL_RECORDINGS_CAP = 50;

// PR 12 PR 4 — onboarding questionnaire constants.
// MIRROR of `convex/workspaceConstants.ts`. Keep both files in
// sync; the server-side mutation is the authoritative gate.

export const MAX_WORK_EXAMPLE_BYTES = 8 * 1024 * 1024;
export const MAX_WORK_EXAMPLES_PER_ONBOARDING = 6;
export const WORK_EXAMPLE_ALLOWED_MIME = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;

export const MIN_INSPIRATIONS = 3;
export const MAX_INSPIRATIONS = 4;
export const ONBOARDING_WORK_EXAMPLES_B2_PREFIX = "onboarding";

export const ONBOARDING_AUTOSAVE_DEBOUNCE_MS = 500;
export const ONBOARDING_REMINDER_STALE_MS = 60 * 60 * 1000;
export const ONBOARDING_REMINDER_MAX_COUNT = 3;
export const ONBOARDING_REMINDER_MIN_INTERVAL_MS = 30 * 60 * 1000;

export const ONBOARDING_REQUIRED_QUESTION_IDS = [
  "how_did_you_hear",
  "goals",
  "inspirations",
] as const;
export const ONBOARDING_QUESTIONNAIRE_VERSION = 1;
export const MIN_WORK_EXAMPLES_PER_SUBMISSION = 4;
