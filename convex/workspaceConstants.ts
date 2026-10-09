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

/**
 * Workspace retention deadline (matches the 18-month window used
 * by `convex/queries/http.ts:getWorkspacesNeedingDeletion` and
 * the retention-notification query). After this many milliseconds
 * past `endedAt`, downloads of workspace files must be refused
 * regardless of whether the underlying B2 object still exists.
 * PR 1 enforces this on the download path; PR 3 adds the
 * lifecycle rule that hard-deletes the B2 objects.
 */
export const WORKSPACE_RETENTION_MS = 18 * 30 * 24 * 60 * 60 * 1000;

/**
 * PR workspace-storage-2 (migrate): the 7-day grace period the
 * backfill sweep skips. Rows newer than this may still be in
 * flight (a user uploaded a chat image 6 days ago and is still
 * active in the workspace); migrating them now would race a
 * possible future `ctx.storage.delete` from the chatFileRetention
 * cron and lose the row's metadata. Once the row is 7 days old
 * the upload is either confirmed-and-stable or already soft-
 * deleted; either way migrating is safe.
 *
 * Picked 7 days to align with the B2 PUT URL's 1-hour expiry plus
 * slack for slow connections + the 30-day chat-file retention
 * boundary. Anything shorter risks racing a freshly uploaded
 * blob; anything longer accumulates orphans on the Convex side.
 */
export const BACKFILL_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * PR workspace-storage-2 (Greptile round 27 P1 fix): re-entrancy
 * guard window, RETIRED. The sweep used to short-circuit when a
 * recent stamp was found within this window, but the underlying
 * query was an unindexed table-scan that exceeded Convex's read
 * budget. The cron now relies on Trigger.dev's own schedule
 * guarantees + the per-row `migrateConvexStorageRowToB2`
 * idempotency, so the dedup is unnecessary. Constant retained
 * (deprecated) so PR 3 imports do not break — the value is
 * otherwise unused.
 */
export const SCHEDULE_BACKFILL_DEDUP_MS = 6 * 60 * 60 * 1000;

/**
 * PR workspace-storage-2 (Greptile round 28 P1 fix): staleness
 * window for `acquireMigrationLock`. A `fileUploads` row whose
 * `migratedAt` is older than this threshold is treated as an
 * abandoned lock (the previous action crashed or restarted
 * between lock acquisition and B2 finalize), and the next
 * migration attempt takes it over. Picked 1 h — longer than the
 * 1 h B2 PUT URL binding window so a transient Convex-node
 * restart mid-PUT can finish on its own, but short enough that
 * a stuck row is retried inside a single cron tick.
 */
export const STALE_MIGRATION_LOCK_MS = 60 * 60 * 1000;

/**
 * PR workspace-storage-2: page size for the backfill candidate
 * query. Mirrors `chatFileRetention.BATCH_SIZE` so a single
 * sweep tick drains a similar volume. Bounded to keep the
 * internal query read budget under Convex's 8KB doc limit.
 */
export const BACKFILL_BATCH_SIZE = 50;

/**
 * PR workspace-storage-3c (server-side resolution): default TTL
 * for B2 signed GET URLs minted by the read-side
 * `resolveWorkspaceB2FileUploadsForKeys` query. Picked 1 hour
 * to balance round-trip churn (every page render) against
 * expiry risk (a long-lived browser tab). Long enough for a
 * gallery / chat / notes scroll session; short enough that a
 * leaked URL is only useful for an hour. Action callers
 * (`getWorkspaceDownloadUrl`, ZIP exports) can request longer
 * TTLs and they are clamped by
 * `clampWorkspaceDownloadExpiresInSeconds`.
 */
export const WORKSPACE_B2_URL_TTL_SECONDS = 60 * 60;

// PR 12 PR 4 — onboarding questionnaire constants.
// Source of truth lives here on the Convex side; mirror in
// `apps/platform/lib/workspace-constants.ts` so client-side
// validation matches server-side rejection (Greptile finding on
// previous mismatched caps).

/** Max bytes for a single work-example image upload. Matches
 *  MAX_IMAGE_BYTES (8 MB); reuses the existing B2 PUT pipeline. */
export const MAX_WORK_EXAMPLE_BYTES = 8 * 1024 * 1024;

/** Hard cap on active work-example rows per onboarding. The plan
 *  accepts 4–6 per submission; the cap is 6 so a stale "preparing
 *  next example" frame cannot push past the visible limit. */
export const MAX_WORK_EXAMPLES_PER_ONBOARDING = 6;

/** Allowed mime types for work-example uploads. Mirrors the
 *  workspace image allow-list so a shared validator can be
 *  re-used if we ever migrate them to the same constant. */
export const WORK_EXAMPLE_ALLOWED_MIME = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;

/** Inspirations-field length bounds (v1: 3–4 entries). Enforced
 *  in `submitQuestionnaire`; mirrored client-side for UI gating. */
export const MIN_INSPIRATIONS = 3;
export const MAX_INSPIRATIONS = 4;

/** B2 key prefix used by `generateWorkExampleUploadUrl`. Mirrored
 *  in the lifecycle rule that purges this prefix when an
 *  onboarding reaches a terminal status. */
export const ONBOARDING_WORK_EXAMPLES_B2_PREFIX = "onboarding";

/** Auto-save cadence target (milliseconds). The form component
 *  debounces draft saves to this interval; faster than this risks
 *  per-keystroke mutation storms. */
export const ONBOARDING_AUTOSAVE_DEBOUNCE_MS = 500;

/** How long a draft can sit untouched before the abandonment
 *  cron considers it stale. 1 hour — short enough that the cron
 *  sends the first reminder within ~1.5h of the student
 *  walking away; long enough that active typing does not
 *  trigger a reminder. */
export const ONBOARDING_REMINDER_STALE_MS = 60 * 60 * 1000;

/** Hard cap on reminders per draft. The 4th reminder is
 *  suppressed — admin has to intervene. */
export const ONBOARDING_REMINDER_MAX_COUNT = 3;

/** Minimum interval between reminders for the SAME draft, even
 *  if the cap is not yet reached. Prevents the cron from
 *  firing twice in one tick if `lastReminderSentAt` is
 *  unusually recent (e.g. a clock skew). */
export const ONBOARDING_REMINDER_MIN_INTERVAL_MS = 30 * 60 * 1000;
