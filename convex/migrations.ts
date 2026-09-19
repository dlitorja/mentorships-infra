import { Migrations } from "@convex-dev/migrations";
import { MutationCtx, internalMutation } from "./_generated/server";
import { components, internal } from "./_generated/api";
import { resolveSessionWorkspace } from "./lib/sessionWorkspace";

// Central migrations controller. Define individual migrations under `internal.migrations.*`
// and invoke them via the runner below. See @convex-dev/migrations docs for patterns
// like widen-migrate-narrow and resumable batch processing.
export const migrations = new Migrations(components.migrations, {
  internalMutation,
  defaultBatchSize: 50,
  migrationsLocationPrefix: "migrations:",
});

// Generic runner: accepts a migration name at call-time.
// Usage examples:
// - npx convex run migrations:run '{"fn":"migrations:backfillLegacyInstructorRef"}'
// - npx convex run migrations:run '{"fn":"migrations:someOtherMigration"}'
export const run = migrations.runner();

// Backfill legacyInstructorRef from legacyId where missing (widen/migrate step)
export const backfillLegacyInstructorRef = migrations.define({
  table: "instructors",
  migrateOne: async (_ctx, inst: { legacyInstructorRef?: string; legacyId?: string }) => {
    if (inst.legacyInstructorRef === undefined && inst.legacyId !== undefined) {
      return { legacyInstructorRef: inst.legacyId } as Partial<typeof inst>;
    }
  },
});

// Convenient runner bound to the backfill
export const runBackfillLegacyInstructorRef = migrations.runner(internal.migrations.backfillLegacyInstructorRef);

export const backfillSessionWorkspaceLinks = migrations.define({
  table: "sessions",
  migrateOne: async (ctx, session) => {
    const patch: {
      workspaceId?: typeof session.workspaceId;
      hasRecordingArtifact?: boolean;
    } = {};

    if (
      session.hasRecordingArtifact === undefined &&
      (session.recordingUrl !== undefined ||
        session.recordingTransferStatus !== undefined)
    ) {
      patch.hasRecordingArtifact = true;
    }

    if (session.workspaceId === undefined) {
      const workspace = await resolveSessionWorkspace(ctx, session);
      if (workspace) patch.workspaceId = workspace._id;
    }

    return Object.keys(patch).length > 0 ? patch : undefined;
  },
});

export const runBackfillSessionWorkspaceLinks = migrations.runner(
  internal.migrations.backfillSessionWorkspaceLinks
);

/**
 * Lowercase + trim every instructor row's `email` field.
 *
 * Greptile P2 round 2 ("Fallback Scan Can Miss") + P1 round 3
 * ("Migration Cannot Scale Safely"): legacy mixed-case emails
 * remain until a one-off migration runs. Write paths
 * (`createInstructorInternal`, `internalAtomicFullUpdateInstructor`)
 * now lowercase on insert/update, so this migration is the
 * backfill for rows written before that change. The previous
 * single-mutation implementation collected the whole table in one
 * read and could exceed Convex's 8192 per-transaction document
 * limit if the table grew large. This version uses the project's
 * batched, resumable migration framework (`@convex-dev/migrations`)
 * which processes rows in chunks (default batch size 50, see
 * `Migrations` config above) and is idempotent — re-running after a
 * partial pass is safe.
 *
 * The comparison is against the FULLY normalized form
 * (`raw.trim().toLowerCase()`), so both mixed-case AND whitespace-
 * only drift are patched. The earlier case-only comparison wrongly
 * reported whitespace-only drift as `alreadyNormalized` and left
 * such rows unpatched.
 *
 * Usage (after PR #846 merges):
 *   npx convex run --prod migrations:run '{"fn":"migrations:runNormalizeAllInstructorEmails"}'
 *
 * Once this completes, the case-insensitive fallback scan in
 * `getInstructorLinkingStatusForCurrentUser` finds zero mixed-case
 * rows in steady state — the `by_email` index alone is sufficient.
 */
export const normalizeAllInstructorEmails = migrations.define({
  table: "instructors",
  migrateOne: async (
    _ctx,
    inst: { email?: string; updatedAt?: number },
  ): Promise<Partial<typeof inst> | undefined> => {
    const raw = inst.email;
    if (raw === undefined) {
      return undefined;
    }
    const normalized = raw.trim().toLowerCase();
    if (raw === normalized) {
      return undefined;
    }
    return { email: normalized, updatedAt: Date.now() };
  },
});

export const runNormalizeAllInstructorEmails = migrations.runner(
  internal.migrations.normalizeAllInstructorEmails
);

/**
 * PR #4: backfill `notificationPreferences.recordingReadyEmail = true`
 * on existing student users so the recording-ready email pipeline
 * (PR #2) sends to them by default.
 *
 * Only touches students: instructors/admins/etc. don't have a
 * per-user inbox on the recordings surface, so opting them in or
 * out has no meaning. A student whose preference blob already
 * contains `recordingReadyEmail` (whether true OR false — the
 * student may have already opted out via a future UI) is left
 * alone, so this migration is safe to re-run and respects prior
 * choice.
 *
 * Students whose preference blob is missing OR malformed (not a
 * plain object, or `recordingReadyEmail` is set to a non-boolean
 * value) get a fresh blob with `recordingReadyEmail: true` and
 * any other well-known keys preserved.
 *
 * Why `@convex-dev/migrations` instead of a hand-rolled cursor
 * batch (`backfillRecordingExpiry` style): this table is small
 * (a few thousand students at most) but we still want resumable
 * + idempotent behavior for free, and the framework's
 * `migrateOne` shape is easier to reason about than the cursor
 * loop. The other migrations on this file use the same framework,
 * so this is the precedent.
 *
 * Usage (after PR #4 merges):
 *   npx convex run --prod migrations:run '{"fn":"migrations:runBackfillNotificationPreferences"}'
 */
export const backfillNotificationPreferences = migrations.define({
  table: "users",
  migrateOne: async (
    _ctx,
    user: {
      role?:
        | "student"
        | "instructor"
        | "admin"
        | "video_editor"
        | "support";
      notificationPreferences?: unknown;
    }
  ): Promise<Partial<typeof user> | undefined> => {
    if (user.role !== "student") return undefined;

    const existing = user.notificationPreferences;
    const existingIsObject =
      existing !== null &&
      typeof existing === "object" &&
      !Array.isArray(existing);

    if (existingIsObject) {
      const obj = existing as Record<string, unknown>;
      if (typeof obj.recordingReadyEmail === "boolean") {
        return undefined;
      }
    }

    const merged: Record<string, unknown> = existingIsObject
      ? { ...(existing as Record<string, unknown>) }
      : {};
    merged.recordingReadyEmail = true;

    return { notificationPreferences: merged };
  },
});

export const runBackfillNotificationPreferences = migrations.runner(
  internal.migrations.backfillNotificationPreferences
);
