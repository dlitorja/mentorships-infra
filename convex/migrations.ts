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
