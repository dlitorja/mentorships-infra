/**
 * Central workspace upload/resource limits. These are the source of truth
 * for the Convex backend; keep them in sync with the frontend copy in
 * apps/platform/lib/workspace-constants.ts (and apps/web if it grows a
 * workspace UI).
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
export const MAX_WORKSPACE_FILE_MB = MAX_WORKSPACE_FILE_BYTES / (1024 * 1024);

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const PER_UPLOAD_CAP = 5;

export const MAX_CHAT_FILE_BYTES = 500 * 1024 * 1024;
export const LARGE_CHAT_FILE_BYTES = 100 * 1024 * 1024;

/**
 * Days to retain soft-deleted chat file/image messages before the
 * retention cron (`hardDeleteExpiredChatFiles` in
 * `convex/cleanup/chatFileRetention.ts`) hard-deletes the underlying
 * Convex storage blob and the message row. Matches the workspace
 * retention-warning banner cadence (PR #convex-egress-2).
 */
export const CHAT_FILE_RETENTION_DAYS = 30;
export const CHAT_FILE_RETENTION_MS = CHAT_FILE_RETENTION_DAYS * 24 * 60 * 60 * 1000;
/**
 * PR #B upload-binding freshness window. `recordFileUpload` rejects
 * storage ids whose underlying blob was uploaded more than this many
 * milliseconds ago. Convex does not track the uploader in storage
 * metadata, so without this window a participant could pass an
 * unrelated storage id they discovered through a chat URL and bind
 * it to themselves via `recordFileUpload`, then have the retention
 * cron delete the unrelated blob (Greptile Security P1).
 *
 * 5 minutes is a generous window for the legitimate client flow
 * (upload -> response -> recordFileUpload); anything longer means
 * the storage id was created in a previous session and the binding
 * is suspicious.
 */
export const MAX_BINDING_AGE_MS = 5 * 60 * 1000;

/**
 * PR workspace-storage-1 (round 7): B2 binding freshness window.
 * Longer than `MAX_BINDING_AGE_MS` because presigned PUT URLs are
 * valid for 1 hour and a 500MB upload on a slow connection can
 * exceed the legacy 5-minute window. The cap exists to prevent
 * replay of an old key (a freshly-minted key by another caller in
 * the same workspace could otherwise be replayed), not to bound
 * upload duration.
 */
export const B2_BINDING_AGE_MS = 60 * 60 * 1000;
