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
 * Eligibility:
 *   - `role === "student"` — explicit students.
 *   - `role === undefined` AND the user owns at least one
 *     workspace whose `type` is anything other than
 *     `"admin_instructor"` (i.e. `mentorship`, `admin_student`,
 *     or untyped) AND is NOT the linked instructor of ANY such
 *     workspace — "implicit" students. The UI surfaces the
 *     toggle to them (Clerk-derived workspace role says student),
 *     but `syncUser` can preserve an undefined Convex role on
 *     legacy records (Greptile R3 P1). Without this branch,
 *     those users would see the switch and have every save
 *     rejected by `setNotificationPreference`.
 *   - Anything else (instructor / admin / video_editor / support /
 *     undefined-without-workspace / undefined-owner-of-an-
 *     `admin_instructor`-workspace / undefined-owner-and-
 *     linked-instructor-of-a-`mentorship`/untyped-workspace) —
 *     skipped. They don't have a per-user inbox on the
 *     recordings surface.
 *
 * The "exclude only `admin_instructor`" filter matches the
 * existing workspace role resolver in
 * `convex/workspaces.ts:39-67`:
 *   - `admin_student` + owner → "student" (line 40).
 *   - `admin_instructor` + owner → not a student (lines 43-54,
 *     ownership is admin, not student).
 *   - Everything else (`mentorship` or untyped — both fall
 *     through the type branches) AND the user is the linked
 *     instructor (lines 56-64) → "instructor".
 *   - Everything else (`mentorship` or untyped) + owner who is
 *     NOT the linked instructor → "student" (lines 65-67).
 *
 * So the migration must mirror that: exclude ONLY
 * `admin_instructor` ownership (R4 P1), exclude legacy
 * workspace owners who are also the linked instructor of any
 * such workspace (R6 P1), AND aggregate the classification
 * across ALL qualifying workspaces (R7 P1) — not just the
 * first one returned by the index. A user who owns both a
 * student-classifying workspace AND an instructor-classifying
 * one is an instructor (the linked-instructor relationship
 * is a stronger signal than mere ownership), so they must
 * not be promoted to `"student"`.
 *
 * Aggregation rule: a user is treated as an implicit student
 * only if at least one qualifying workspace classifies them
 * as a student AND NONE classifies them as an instructor.
 * If any qualifying workspace links them as the
 * instructor, they're treated as an instructor (the more
 * specific signal wins over the broader "owner" signal).
 *
 * A student whose preference blob already contains
 * `recordingReadyEmail` (whether true OR false — the student may
 * have already opted out via the UI) is left alone, so this
 * migration is safe to re-run and respects prior choice.
 *
 * Students whose preference blob is missing OR malformed (not a
 * plain object, or `recordingReadyEmail` is set to a non-boolean
 * value) get a fresh blob with `recordingReadyEmail: true` and
 * any other well-known keys preserved.
 *
 * Implicit students also get `role` stamped to `"student"` so
 * the row converges with the rest of the table — without that
 * stamp, the mutation's role gate would still be lenient for
 * them indefinitely.
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
 *   npx convex run --prod migrations:run '{"fn":"migrations:backfillNotificationPreferences"}'
 *
 * The `fn` argument names the migration returned by
 * `migrations.define(...)` — the generic `migrations:run` runner
 * then dispatches to it. The bound runner
 * (`migrations:runBackfillNotificationPreferences`) is for code
 * that wants to invoke the migration without going through the
 * generic runner; the CLI prefers the migration-name form so
 * the call site matches the schema source-of-truth.
 */
export const backfillNotificationPreferences = migrations.define({
  table: "users",
  migrateOne: async (
    ctx,
    user: {
      userId?: string;
      role?:
        | "student"
        | "instructor"
        | "admin"
        | "video_editor"
        | "support";
      notificationPreferences?: unknown;
    }
  ): Promise<Partial<typeof user> | undefined> => {
    let isImplicitStudent = false;
    if (user.role === undefined) {
      const ownerId = user.userId;
      if (typeof ownerId !== "string") return undefined;

      // Mirror `getWorkspaceRole` in `convex/workspaces.ts:39-67`
      // across ALL qualifying workspaces, not just the first
      // one (R7 P1). `.first()` was wrong: a user who owns both
      // a student-classifying workspace AND an
      // instructor-classifying one would have their role
      // decided by the order of the index, which is
      // non-deterministic and unsafe.
      const qualifyingWorkspaces = await ctx.db
        .query("workspaces")
        .withIndex("by_ownerId", (q) => q.eq("ownerId", ownerId))
        .filter((q) =>
          q.or(
            q.eq(q.field("type"), "mentorship"),
            q.eq(q.field("type"), "admin_student"),
            q.eq(q.field("type"), undefined)
          )
        )
        .collect();

      if (qualifyingWorkspaces.length === 0) {
        isImplicitStudent = false;
      } else {
        // Look up the user's instructor record ONCE (linked-
        // instructor check uses `_id` comparison, R6 P1). Same
        // record applies to all their workspaces — fetching
        // per-workspace would be redundant.
        const instructor = await ctx.db
          .query("instructors")
          .withIndex("by_userId", (q) => q.eq("userId", ownerId))
          .first();

        let anyClassifiesAsInstructor = false;
        let anyClassifiesAsStudent = false;
        for (const ws of qualifyingWorkspaces) {
          if (
            instructor !== null &&
            ws.instructorId !== undefined &&
            instructor._id === ws.instructorId
          ) {
            anyClassifiesAsInstructor = true;
          } else {
            anyClassifiesAsStudent = true;
          }
        }
        // Instructor signal wins: if ANY qualifying workspace
        // classifies them as an instructor, treat them as an
        // instructor (don't promote).
        isImplicitStudent =
          anyClassifiesAsStudent && !anyClassifiesAsInstructor;
      }
    }

    const isEligibleStudent = user.role === "student" || isImplicitStudent;
    if (!isEligibleStudent) return undefined;

    const existing = user.notificationPreferences;
    const existingIsObject =
      existing !== null &&
      typeof existing === "object" &&
      !Array.isArray(existing);

    let shouldStampPreference = true;
    if (existingIsObject) {
      const obj = existing as Record<string, unknown>;
      if (typeof obj.recordingReadyEmail === "boolean") {
        shouldStampPreference = false;
      }
    }

    const patch: Partial<typeof user> = {};
    if (isImplicitStudent) {
      patch.role = "student";
    }
    if (shouldStampPreference) {
      const merged: Record<string, unknown> = existingIsObject
        ? { ...(existing as Record<string, unknown>) }
        : {};
      merged.recordingReadyEmail = true;
      patch.notificationPreferences = merged;
    }
    return Object.keys(patch).length > 0 ? patch : undefined;
  },
});

export const runBackfillNotificationPreferences = migrations.runner(
  internal.migrations.backfillNotificationPreferences
);
