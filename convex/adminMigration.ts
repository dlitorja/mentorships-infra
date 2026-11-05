import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { writeAuditLog } from "./auditLog";

const FIXTURE_REPLAY_TOKEN = "replay-fixture-2026-10-12-niel-dup";

/**
 * One-off migration to clean up a duplicate-instructor account that was
 * accidentally created when an instructor invitation was re-sent for an
 * existing email (see `convex/hdInvitations.ts:markInvitationAccepted`,
 * which used to insert a new `instructors` row without checking `by_email`).
 *
 * Inputs are the IDs of the rows produced by that bug:
 *
 *   - `oldInstructorId`        - the duplicate `instructors` row
 *   - `oldUserId`              - the duplicate `users` row
 *   - `oldClerkUserId`         - the duplicate Clerk user (queued for deletion)
 *   - `newInstructorId`        - the canonical `instructors` row (already exists)
 *
 * The mutation is idempotent and re-runnable: each step checks for the
 * pre-fix state before applying its patch, so a partial run can be safely
 * resumed by calling the same arguments again. A dry-run mode (`dryRun=true`)
 * reports the plan without writing anything.
 *
 * Audit logs are written for every step under `actorId="system"` /
 * `actorRole="system"`, target the affected row's `targetType` + `targetId`.
 *
 * Run after merge + auto-deploy:
 *   npx convex run --deployment prod adminMigration:reassignInstructorFromDuplicate \
 *     '{"oldInstructorId":"<id>","oldUserId":"<id>","oldClerkUserId":"<id>","newInstructorId":"<id>"}'
 */
export const reassignInstructorFromDuplicate = internalMutation({
  args: {
    oldInstructorId: v.id("instructors"),
    oldUserId: v.id("users"),
    oldClerkUserId: v.string(),
    newInstructorId: v.id("instructors"),
    dryRun: v.optional(v.boolean()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const note = args.note ?? FIXTURE_REPLAY_TOKEN;
    const dryRun = args.dryRun === true;

    const oldInstructor = await ctx.db.get(args.oldInstructorId);
    if (!oldInstructor) {
      throw new Error(`reassignInstructorFromDuplicate: instructor ${args.oldInstructorId} not found`);
    }
    const newInstructor = await ctx.db.get(args.newInstructorId);
    if (!newInstructor) {
      throw new Error(`reassignInstructorFromDuplicate: instructor ${args.newInstructorId} not found`);
    }
    const oldUser = await ctx.db.get(args.oldUserId);
    if (!oldUser) {
      throw new Error(`reassignInstructorFromDuplicate: user ${args.oldUserId} not found`);
    }

    const oldInstructorAlreadyDeleted = oldInstructor.deletedAt !== undefined;

    if (!oldInstructorAlreadyDeleted && oldInstructor.userId !== args.oldClerkUserId) {
      throw new Error(
        `reassignInstructorFromDuplicate: instructor ${args.oldInstructorId}.userId=${oldInstructor.userId ?? "<null>"} does not match oldClerkUserId=${args.oldClerkUserId}; refusing to mutate (already-cleaned-up state with deletedAt=${oldInstructor.deletedAt} is treated as safe to rerun)`,
      );
    }
    if (oldUser.deletedAt === undefined && oldUser.clerkId !== args.oldClerkUserId) {
      throw new Error(
        `reassignInstructorFromDuplicate: user ${args.oldUserId}.clerkId=${oldUser.clerkId} does not match oldClerkUserId=${args.oldClerkUserId}; refusing to mutate`,
      );
    }
    if ((oldInstructor.email ?? "").toLowerCase() !== (newInstructor.email ?? "").toLowerCase()) {
      throw new Error(
        `reassignInstructorFromDuplicate: old instructor email=${oldInstructor.email ?? "<null>"} does not match new instructor email=${newInstructor.email ?? "<null>"}; refusing to mutate`,
      );
    }

    const workspacesToReassign = await ctx.db
      .query("workspaces")
      .withIndex("by_instructorId", (q) => q.eq("instructorId", args.oldInstructorId))
      .collect();
    const sessionPacksToReassign = await ctx.db
      .query("sessionPacks")
      .withIndex("by_instructorId", (q) => q.eq("instructorId", args.oldInstructorId))
      .collect();
    const seatReservationsToReassign = await ctx.db
      .query("seatReservations")
      .withIndex("by_instructorId", (q) => q.eq("instructorId", args.oldInstructorId))
      .collect();
    const sessionsToReassign = await ctx.db
      .query("sessions")
      .withIndex("by_instructorId", (q) => q.eq("instructorId", args.oldInstructorId))
      .collect();

    const plan = {
      note,
      dryRun,
      oldInstructor: {
        _id: args.oldInstructorId,
        name: oldInstructor.name ?? null,
        email: oldInstructor.email ?? null,
        userId: oldInstructor.userId ?? null,
        alreadyDeleted: oldInstructorAlreadyDeleted,
      },
      newInstructor: {
        _id: args.newInstructorId,
        name: newInstructor.name ?? null,
        email: newInstructor.email ?? null,
        userId: newInstructor.userId ?? null,
      },
      oldUser: {
        _id: args.oldUserId,
        clerkId: oldUser.clerkId,
        email: oldUser.email,
        alreadyDeleted: oldUser.deletedAt !== undefined,
      },
      oldClerkUserId: args.oldClerkUserId,
      counts: {
        workspaces: workspacesToReassign.length,
        sessionPacks: sessionPacksToReassign.length,
        seatReservations: seatReservationsToReassign.length,
        sessions: sessionsToReassign.length,
      },
      affectedIds: {
        workspaces: workspacesToReassign.map((w) => w._id),
        sessionPacks: sessionPacksToReassign.map((p) => p._id),
        seatReservations: seatReservationsToReassign.map((r) => r._id),
        sessions: sessionsToReassign.map((s) => s._id),
      },
    };

    const userCleanupComplete = oldUser.deletedAt !== undefined;
    let clerkDeletionEverQueued = false;
    const existingPendingDeletionForRerun = await ctx.db
      .query("pendingClerkDeletions")
      .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", args.oldClerkUserId))
      .first();
    if (existingPendingDeletionForRerun !== null) {
      clerkDeletionEverQueued = true;
    } else {
      const priorQueueAudit = await ctx.db
        .query("auditLogs")
        .withIndex("by_action", (q) =>
          q.eq("action", "queue_duplicate_clerk_user_for_deletion"),
        )
        .filter((q) => q.eq(q.field("targetId"), args.oldClerkUserId))
        .first();
      clerkDeletionEverQueued = priorQueueAudit !== null;
    }
    if (
      oldInstructorAlreadyDeleted &&
      workspacesToReassign.length === 0 &&
      sessionPacksToReassign.length === 0 &&
      seatReservationsToReassign.length === 0 &&
      sessionsToReassign.length === 0 &&
      userCleanupComplete &&
      clerkDeletionEverQueued
    ) {
      return {
        plan,
        applied: false,
        alreadyCompleted: true,
      };
    }

    if (dryRun) {
      return { plan, applied: false };
    }

    const applied: Array<{ action: string; targetType: string; targetId: string }> = [];

    for (const workspace of workspacesToReassign) {
      await ctx.db.patch(workspace._id, { instructorId: args.newInstructorId });
      applied.push({
        action: "reassign_workspace_instructor_from_duplicate",
        targetType: "workspace",
        targetId: workspace._id,
      });
    }

    for (const pack of sessionPacksToReassign) {
      await ctx.db.patch(pack._id, { instructorId: args.newInstructorId });
      applied.push({
        action: "reassign_session_pack_instructor_from_duplicate",
        targetType: "sessionPack",
        targetId: pack._id,
      });
    }

    for (const reservation of seatReservationsToReassign) {
      await ctx.db.patch(reservation._id, { instructorId: args.newInstructorId });
      applied.push({
        action: "reassign_seat_reservation_instructor_from_duplicate",
        targetType: "seatReservation",
        targetId: reservation._id,
      });
    }

    for (const session of sessionsToReassign) {
      await ctx.db.patch(session._id, { instructorId: args.newInstructorId });
      applied.push({
        action: "reassign_session_instructor_from_duplicate",
        targetType: "session",
        targetId: session._id,
      });
    }

    if (!oldInstructorAlreadyDeleted) {
      const now = Date.now();
      await ctx.db.patch(args.oldInstructorId, {
        deletedAt: now,
        isActive: false,
        updatedAt: now,
      });
      applied.push({
        action: "soft_delete_duplicate_instructor",
        targetType: "instructor",
        targetId: args.oldInstructorId,
      });
    }

    if (oldUser.deletedAt === undefined) {
      await ctx.db.patch(args.oldUserId, { deletedAt: Date.now() });
      applied.push({
        action: "soft_delete_duplicate_user",
        targetType: "user",
        targetId: args.oldUserId,
      });
    }

    const existingPendingDeletion = await ctx.db
      .query("pendingClerkDeletions")
      .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", args.oldClerkUserId))
      .first();

    if (!existingPendingDeletion) {
      await ctx.db.insert("pendingClerkDeletions", {
        clerkUserId: args.oldClerkUserId,
        instructorId: args.newInstructorId,
        attempts: 0,
        createdAt: Date.now(),
      });
      applied.push({
        action: "queue_duplicate_clerk_user_for_deletion",
        targetType: "pendingClerkDeletion",
        targetId: args.oldClerkUserId,
      });
    }

    for (const entry of applied) {
      await writeAuditLog(ctx, {
        actorId: "system",
        actorRole: "system",
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        details: `Fix duplicate-instructor account (note=${note}); oldInstructor=${args.oldInstructorId} newInstructor=${args.newInstructorId} oldClerkUserId=${args.oldClerkUserId}`,
        metadata: {
          note,
          oldInstructorId: args.oldInstructorId,
          newInstructorId: args.newInstructorId,
          oldUserId: args.oldUserId,
          oldClerkUserId: args.oldClerkUserId,
        },
      });
    }

    return { plan, applied, appliedCount: applied.length };
  },
});

const CLERK_USER_ID_PATTERN = /^user_[a-zA-Z0-9]+$/;
function isClerkUserId(id: string | undefined): boolean {
  return typeof id === "string" && CLERK_USER_ID_PATTERN.test(id);
}

/**
 * One-off repair for the "two live instructors for one email" bug class.
 *
 * Background (katjbritt@gmail.com, Nov 2026):
 *   The invitation flow linked the existing `cedarcia` profile to the
 *   Clerk user created by accepting the invitation. The same person then
 *   signed up again (a second Clerk user with the same email). The
 *   `user.created` webhook called `/instructors/create-for-clerk-user`
 *   with the new Clerk user, but the canonical profile was already linked
 *   to the old (now-deleted) Clerk user, so the old code fell through to
 *   `createInstructorInternal` and inserted a bare stub row. Result:
 *
 *     - two live instructor rows with the same email, which rendered as
 *       the same address twice in the admin "Instructor ID" picker;
 *     - the canonical profile linked to a Clerk user that no longer
 *       exists, while the live Clerk user was linked to the stub;
 *     - an orphan `users` row keyed to the deleted Clerk user, which
 *       blocks inserting a row for the live user
 *       (`EMAIL_BELONGS_TO_ANOTHER_USER`).
 *
 * This mutation:
 *   1. relinks the canonical instructor to the live Clerk user;
 *   2. re-keys the stale `users` row (userId + clerkId) to the live Clerk
 *      user so role/auth lookups resolve;
 *   3. moves `instructorUploads` and `videoEditorAssignments` rows from the
 *      stale Clerk id to the live one (both store the Clerk user id, not
 *      `instructors._id`);
 *   4. soft-deletes the duplicate stub row (never hard-deletes) and clears
 *      its Clerk link even if it was deleted earlier;
 *   5. points accepted `hdInvitations` rows at the live Clerk user;
 *   6. writes an audit row for every step.
 *
 * `staleClerkUserId` may be omitted: it is derived from the canonical
 * profile's current `userId`. `staleUserId` may be omitted too; the `users`
 * row is found by the stale Clerk id.
 *
 * It is idempotent and re-runnable: every step checks the pre-fix state
 * first. `dryRun=true` returns the plan without writing.
 *
 * Safety refusals (fail loudly instead of guessing):
 *   - the two rows must share the same non-empty email;
 *   - the duplicate must not own workspaces, session packs, seat
 *     reservations, sessions, or bookings (reassign first);
 *   - the duplicate must not be linked to a third live Clerk user;
 *   - an independent `users` row for the live Clerk user must not exist;
 *   - a video editor must not already have an assignment for the live
 *     Clerk id (resolve the collision manually);
 *   - the live Clerk user must not be queued for deletion;
 *   - a re-keyed `users` row must not have a legacy primary `userId`
 *     that differs from its `clerkId`.
 *
 * Runbook (production):
 *
 *   npx convex run --prod adminMigration:relinkDuplicateInstructorEmail \
 *     '{"canonicalInstructorId":"<cedarcia-id>","duplicateInstructorId":"<stub-id>","liveClerkUserId":"user_...","staleClerkUserId":"user_...","staleUserId":"<users-row-id>","dryRun":true}'
 *
 * Then repeat without `dryRun` after confirming the plan, and verify:
 *   - `instructors` has exactly one live row for the email;
 *   - that row's `userId` is the live Clerk user;
 *   - `users` has one live row for the live Clerk user with role
 *     `instructor`;
 *   - the admin "Instructor ID" picker lists the email once.
 */
export const relinkDuplicateInstructorEmail = internalMutation({
  args: {
    canonicalInstructorId: v.id("instructors"),
    duplicateInstructorId: v.id("instructors"),
    liveClerkUserId: v.string(),
    staleClerkUserId: v.optional(v.string()),
    staleUserId: v.optional(v.id("users")),
    dryRun: v.optional(v.boolean()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const dryRun = args.dryRun === true;
    const note = args.note ?? "relinkDuplicateInstructorEmail";

    if (!isClerkUserId(args.liveClerkUserId)) {
      throw new Error(
        `relinkDuplicateInstructorEmail: liveClerkUserId=${args.liveClerkUserId} is not a Clerk user id`,
      );
    }
    if (args.staleClerkUserId && !isClerkUserId(args.staleClerkUserId)) {
      throw new Error(
        `relinkDuplicateInstructorEmail: staleClerkUserId=${args.staleClerkUserId} is not a Clerk user id`,
      );
    }
    if (args.canonicalInstructorId === args.duplicateInstructorId) {
      throw new Error(
        "relinkDuplicateInstructorEmail: canonicalInstructorId and duplicateInstructorId must differ",
      );
    }

    const canonical = await ctx.db.get(args.canonicalInstructorId);
    if (!canonical) {
      throw new Error(
        `relinkDuplicateInstructorEmail: canonical instructor ${args.canonicalInstructorId} not found`,
      );
    }
    const duplicate = await ctx.db.get(args.duplicateInstructorId);
    if (!duplicate) {
      throw new Error(
        `relinkDuplicateInstructorEmail: duplicate instructor ${args.duplicateInstructorId} not found`,
      );
    }
    if (canonical.deletedAt !== undefined) {
      throw new Error(
        `relinkDuplicateInstructorEmail: canonical instructor ${args.canonicalInstructorId} is soft-deleted; refusing to relink a deleted profile`,
      );
    }

    const canonicalEmail = (canonical.email ?? "").toLowerCase().trim();
    const duplicateEmail = (duplicate.email ?? "").toLowerCase().trim();
    if (!canonicalEmail || canonicalEmail !== duplicateEmail) {
      throw new Error(
        `relinkDuplicateInstructorEmail: emails must match (canonical=${canonicalEmail || "<empty>"}, duplicate=${duplicateEmail || "<empty>"}); refusing to mutate`,
      );
    }

    const canonicalAlreadyRelinked = canonical.userId === args.liveClerkUserId;

    // Derive the old account id when the caller omits it. The canonical
    // profile's current userId IS the account being moved away from; without
    // this, a caller that only knows the canonical id would relink the
    // profile and delete the stub while leaving the stale `users` row,
    // instructor uploads, and video-editor assignments on the old account.
    const staleClerkUserId =
      args.staleClerkUserId ??
      (!canonicalAlreadyRelinked &&
      canonical.userId &&
      canonical.userId !== args.liveClerkUserId
        ? canonical.userId
        : undefined);
    if (staleClerkUserId && !isClerkUserId(staleClerkUserId)) {
      throw new Error(
        `relinkDuplicateInstructorEmail: staleClerkUserId=${staleClerkUserId} is not a Clerk user id; pass an explicit staleClerkUserId`,
      );
    }
    if (
      !canonicalAlreadyRelinked &&
      staleClerkUserId &&
      canonical.userId !== staleClerkUserId
    ) {
      throw new Error(
        `relinkDuplicateInstructorEmail: canonical.userId=${canonical.userId ?? "<null>"} does not match staleClerkUserId=${staleClerkUserId}; refusing to mutate`,
      );
    }

    const duplicateIsLinkedToThirdUser =
      duplicate.userId !== undefined &&
      duplicate.userId !== args.liveClerkUserId &&
      isClerkUserId(duplicate.userId);
    if (duplicateIsLinkedToThirdUser) {
      throw new Error(
        `relinkDuplicateInstructorEmail: duplicate instructor is linked to a different Clerk user (${duplicate.userId}); refusing to soft-delete it`,
      );
    }

    const pendingLiveDeletion = await ctx.db
      .query("pendingClerkDeletions")
      .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", args.liveClerkUserId))
      .first();
    if (pendingLiveDeletion) {
      throw new Error(
        `relinkDuplicateInstructorEmail: live Clerk user ${args.liveClerkUserId} is queued for deletion; remove that pendingClerkDeletions row first`,
      );
    }

    // The duplicate must be empty: moving owned records is a different
    // (reversible) operation handled by `reassignInstructorFromDuplicate`.
    const duplicateWorkspaces = await ctx.db
      .query("workspaces")
      .withIndex("by_instructorId", (q) => q.eq("instructorId", args.duplicateInstructorId))
      .collect();
    const duplicateSessionPacks = await ctx.db
      .query("sessionPacks")
      .withIndex("by_instructorId", (q) => q.eq("instructorId", args.duplicateInstructorId))
      .collect();
    const duplicateSeatReservations = await ctx.db
      .query("seatReservations")
      .withIndex("by_instructorId", (q) => q.eq("instructorId", args.duplicateInstructorId))
      .collect();
    const duplicateSessions = await ctx.db
      .query("sessions")
      .withIndex("by_instructorId", (q) => q.eq("instructorId", args.duplicateInstructorId))
      .collect();
    const duplicateBookings = await ctx.db
      .query("bookings")
      .withIndex("by_instructorId", (q) => q.eq("instructorId", args.duplicateInstructorId))
      .collect();
    const duplicateReferenceCounts = {
      workspaces: duplicateWorkspaces.length,
      sessionPacks: duplicateSessionPacks.length,
      seatReservations: duplicateSeatReservations.length,
      sessions: duplicateSessions.length,
      bookings: duplicateBookings.length,
    };
    const duplicateHasReferences = Object.values(duplicateReferenceCounts).some(
      (count) => count > 0,
    );
    if (duplicateHasReferences) {
      throw new Error(
        `relinkDuplicateInstructorEmail: duplicate instructor ${args.duplicateInstructorId} still owns records ${JSON.stringify(duplicateReferenceCounts)}; reassign them to the canonical instructor first (see adminMigration.reassignInstructorFromDuplicate) then re-run`,
      );
    }

    // `instructorUploads.instructorId` stores the Clerk user id (a string),
    // not `instructors._id`. Uploads assigned while the stale Clerk account
    // was the active identity must follow the person to the live account,
    // otherwise they disappear from the instructor's uploads dashboard.
    const staleUploads = staleClerkUserId
      ? await ctx.db
          .query("instructorUploads")
          .withIndex("by_instructorId", (q) =>
            q.eq("instructorId", staleClerkUserId),
          )
          .collect()
      : [];

    // `videoEditorAssignments.instructorId` also stores the Clerk user id
    // (`users.userId`), not `instructors._id`. A video editor with a specific
    // assignment for the stale account would lose upload rights once the
    // uploads move to the live account. Move the assignments too, and refuse
    // on collisions rather than silently dropping an editor's quota/scope.
    const staleEditorAssignments = staleClerkUserId
      ? await ctx.db
          .query("videoEditorAssignments")
          .withIndex("by_instructorId", (q) =>
            q.eq("instructorId", staleClerkUserId),
          )
          .collect()
      : [];
    const editorAssignmentCollisions: Array<{
      staleAssignmentId: string;
      existingAssignmentId: string;
      videoEditorId: string;
    }> = [];
    for (const assignment of staleEditorAssignments) {
      const counterpart = await ctx.db
        .query("videoEditorAssignments")
        .withIndex("by_videoEditorId_instructorId", (q) =>
          q
            .eq("videoEditorId", assignment.videoEditorId)
            .eq("instructorId", args.liveClerkUserId),
        )
        .first();
      if (counterpart) {
        editorAssignmentCollisions.push({
          staleAssignmentId: assignment._id,
          existingAssignmentId: counterpart._id,
          videoEditorId: assignment.videoEditorId,
        });
      }
    }
    if (editorAssignmentCollisions.length > 0) {
      throw new Error(
        `relinkDuplicateInstructorEmail: ${editorAssignmentCollisions.length} video-editor assignment(s) already exist for live Clerk user ${args.liveClerkUserId}; resolve the collisions first (${JSON.stringify(editorAssignmentCollisions)})`,
      );
    }

    // Resolve the orphan users row (keyed to the stale Clerk id) and any
    // independent row that already exists for the live Clerk id.
    const liveUserByUserId = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", args.liveClerkUserId))
      .first();
    const liveUserByClerkId = await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", args.liveClerkUserId))
      .first();
    const liveUser = liveUserByUserId ?? liveUserByClerkId ?? null;

    let staleUser = args.staleUserId ? await ctx.db.get(args.staleUserId) : null;
    if (!staleUser && staleClerkUserId) {
      const byPrimary = await ctx.db
        .query("users")
        .withIndex("by_userId", (q) => q.eq("userId", staleClerkUserId!))
        .first();
      const byClerk = await ctx.db
        .query("users")
        .withIndex("by_clerkId", (q) => q.eq("clerkId", staleClerkUserId!))
        .first();
      staleUser = byPrimary ?? byClerk ?? null;
    }

    // A previous run with the same arguments may have re-keyed the stale
    // `users` row to the live Clerk id. On a retry where the caller omits
    // `staleUserId`/`staleClerkUserId`, that repaired row looks like an
    // independent account. Recognize our own audit trail so repeat calls are
    // idempotent instead of throwing.
    const priorReKeyForThisRepair =
      liveUser === null
        ? false
        : (
            await ctx.db
              .query("auditLogs")
              .withIndex("by_action", (q) =>
                q.eq("action", "rekey_duplicate_instructor_users_row"),
              )
              .filter((q) => q.eq(q.field("targetId"), liveUser._id))
              .collect()
          ).some((row) => {
            const meta = row.metadata as Record<string, unknown> | undefined;
            return (
              meta?.canonicalInstructorId === args.canonicalInstructorId &&
              meta?.duplicateInstructorId === args.duplicateInstructorId &&
              meta?.liveClerkUserId === args.liveClerkUserId
            );
          });
    if (priorReKeyForThisRepair && !staleUser && liveUser) {
      staleUser = liveUser;
    }

    const staleUserAlreadyReKeyed =
      staleUser !== null && staleUser.userId === args.liveClerkUserId;
    const liveUserIsIndependent =
      liveUser !== null &&
      (!staleUser || liveUser._id !== staleUser._id) &&
      !priorReKeyForThisRepair;
    if (liveUserIsIndependent) {
      throw new Error(
        `relinkDuplicateInstructorEmail: users row ${liveUser._id} already exists for live Clerk user ${args.liveClerkUserId}; refusing to merge roles automatically`,
      );
    }
    if (staleUser && !staleUserAlreadyReKeyed) {
      if (staleUser.userId !== staleUser.clerkId) {
        throw new Error(
          `relinkDuplicateInstructorEmail: users row ${staleUser._id} has a legacy primary userId=${staleUser.userId} that differs from clerkId=${staleUser.clerkId}; re-keying it would orphan the legacy lookup`,
        );
      }
      if (staleClerkUserId && staleUser.clerkId !== staleClerkUserId) {
        throw new Error(
          `relinkDuplicateInstructorEmail: users row ${staleUser._id}.clerkId=${staleUser.clerkId} does not match staleClerkUserId=${staleClerkUserId}; refusing to re-key`,
        );
      }
    }

    const plan = {
      note,
      dryRun,
      email: canonicalEmail,
      canonical: {
        _id: canonical._id,
        slug: canonical.slug ?? null,
        userId: canonical.userId ?? null,
        alreadyRelinked: canonicalAlreadyRelinked,
      },
      duplicate: {
        _id: duplicate._id,
        name: duplicate.name ?? null,
        userId: duplicate.userId ?? null,
        alreadyDeleted: duplicate.deletedAt !== undefined,
      },
      liveClerkUserId: args.liveClerkUserId,
      staleClerkUserId: staleClerkUserId ?? null,
      usersRow: staleUser
        ? {
            _id: staleUser._id,
            userId: staleUser.userId,
            clerkId: staleUser.clerkId,
            role: staleUser.role ?? null,
            alreadyReKeyed: staleUserAlreadyReKeyed,
          }
        : null,
      duplicateReferenceCounts,
      instructorUploadsToReassign: staleUploads.length,
      videoEditorAssignmentsToReassign: staleEditorAssignments.length,
    };

    if (dryRun) {
      return { plan, applied: false };
    }

    const now = Date.now();
    const applied: Array<{ action: string; targetType: string; targetId: string }> = [];

    if (!canonicalAlreadyRelinked) {
      await ctx.db.patch(args.canonicalInstructorId, {
        userId: args.liveClerkUserId,
        updatedAt: now,
      });
      applied.push({
        action: "relink_duplicate_instructor_canonical",
        targetType: "instructor",
        targetId: args.canonicalInstructorId,
      });
    }

    if (staleUser && !staleUserAlreadyReKeyed) {
      await ctx.db.patch(staleUser._id, {
        userId: args.liveClerkUserId,
        clerkId: args.liveClerkUserId,
      });
      applied.push({
        action: "rekey_duplicate_instructor_users_row",
        targetType: "user",
        targetId: staleUser._id,
      });
    }

    for (const upload of staleUploads) {
      await ctx.db.patch(upload._id, {
        instructorId: args.liveClerkUserId,
        updatedAt: now,
      });
      applied.push({
        action: "reassign_instructor_upload_clerk_user",
        targetType: "instructorUpload",
        targetId: upload._id,
      });
    }

    for (const assignment of staleEditorAssignments) {
      await ctx.db.patch(assignment._id, {
        instructorId: args.liveClerkUserId,
      });
      applied.push({
        action: "reassign_video_editor_assignment_clerk_user",
        targetType: "videoEditorAssignment",
        targetId: assignment._id,
      });
    }

    const duplicateHasUserLink = duplicate.userId !== undefined;
    if (duplicate.deletedAt === undefined || duplicateHasUserLink) {
      await ctx.db.patch(args.duplicateInstructorId, {
        ...(duplicate.deletedAt === undefined
          ? { deletedAt: now, isActive: false, isListed: false }
          : {}),
        // The live Clerk user is now linked to the canonical profile. Clear
        // the duplicate's `userId` even when a previous repair/delete already
        // set `deletedAt`: `getInstructorByUserIdInternal` does not filter
        // deleted rows, so a soft-deleted stub sharing the live Clerk id
        // would still shadow the canonical profile on `.first()`.
        ...(duplicateHasUserLink ? { userId: undefined } : {}),
        updatedAt: now,
      });
      if (duplicate.deletedAt === undefined) {
        applied.push({
          action: "soft_delete_duplicate_instructor",
          targetType: "instructor",
          targetId: args.duplicateInstructorId,
        });
      }
      if (duplicateHasUserLink) {
        applied.push({
          action: "clear_duplicate_instructor_user_link",
          targetType: "instructor",
          targetId: args.duplicateInstructorId,
        });
      }
    }

    if (staleClerkUserId) {
      const invitations = await ctx.db
        .query("hdInvitations")
        .withIndex("by_email", (q) => q.eq("email", canonicalEmail))
        .collect();
      for (const invitation of invitations) {
        if (
          invitation.status === "accepted" &&
          invitation.clerkInvitationId === staleClerkUserId
        ) {
          await ctx.db.patch(invitation._id, {
            clerkInvitationId: args.liveClerkUserId,
            updatedAt: now,
          });
          applied.push({
            action: "repair_duplicate_instructor_update_invitation",
            targetType: "hdInvitation",
            targetId: invitation._id,
          });
        }
      }
    }

    for (const entry of applied) {
      await writeAuditLog(ctx, {
        actorId: "system",
        actorRole: "system",
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        details:
          `Repair duplicate instructor email (note=${note}); canonical=${args.canonicalInstructorId} ` +
          `duplicate=${args.duplicateInstructorId} liveClerkUserId=${args.liveClerkUserId}`,
        metadata: {
          note,
          canonicalInstructorId: args.canonicalInstructorId,
          duplicateInstructorId: args.duplicateInstructorId,
          liveClerkUserId: args.liveClerkUserId,
          staleClerkUserId: staleClerkUserId ?? null,
          staleUserId: staleUser?._id ?? args.staleUserId ?? null,
        },
      });
    }

    return {
      plan,
      applied,
      appliedCount: applied.length,
      alreadyCompleted: applied.length === 0,
    };
  },
});
