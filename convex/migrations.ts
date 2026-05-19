import { Migrations } from "@convex-dev/migrations";
import { internalMutation } from "./_generated/server";
import { components, internal } from "./_generated/api";

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

// Rename admin_mentee -> admin_student and backfill studentImageCount from menteeImageCount
// Idempotent: safe to re-run. This is the migrate step between widen and narrow.
export const backfillWorkspaceStudentCountsAndType = migrations.define({
  table: "workspaces",
  // If you have a lot of workspaces, consider lowering batchSize here
  migrateOne: async (_ctx, ws: any) => {
    const patch: Record<string, any> = {};

    // Backfill studentImageCount from menteeImageCount if missing or out of sync
    const menteeCount = ws.menteeImageCount;
    const studentCount = ws.studentImageCount;
    // Only backfill when studentImageCount is absent; do not overwrite if it exists and differs
    if (typeof menteeCount === "number" && typeof studentCount !== "number") {
      patch.studentImageCount = menteeCount;
    }

    // Rename workspace type
    if (ws.type === "admin_mentee") {
      patch.type = "admin_student";
    }

    // Only return a patch if there is something to change
    if (Object.keys(patch).length > 0) {
      return patch;
    }
  },
});

// Runner alias for convenience
export const runBackfillWorkspaceStudentCountsAndType = migrations.runner(
  internal.migrations.backfillWorkspaceStudentCountsAndType,
);
