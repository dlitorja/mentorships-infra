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

    if (oldInstructor.userId !== args.oldClerkUserId) {
      throw new Error(
        `reassignInstructorFromDuplicate: instructor ${args.oldInstructorId}.userId=${oldInstructor.userId ?? "<null>"} does not match oldClerkUserId=${args.oldClerkUserId}; refusing to mutate`,
      );
    }
    if (oldUser.clerkId !== args.oldClerkUserId) {
      throw new Error(
        `reassignInstructorFromDuplicate: user ${args.oldUserId}.clerkId=${oldUser.clerkId} does not match oldClerkUserId=${args.oldClerkUserId}; refusing to mutate`,
      );
    }
    if ((oldInstructor.email ?? "").toLowerCase() !== (newInstructor.email ?? "").toLowerCase()) {
      throw new Error(
        `reassignInstructorFromDuplicate: old instructor email=${oldInstructor.email ?? "<null>"} does not match new instructor email=${newInstructor.email ?? "<null>"}; refusing to mutate`,
      );
    }

    const oldInstructorAlreadyDeleted = oldInstructor.deletedAt !== undefined;

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
      },
      affectedIds: {
        workspaces: workspacesToReassign.map((w) => w._id),
        sessionPacks: sessionPacksToReassign.map((p) => p._id),
        seatReservations: seatReservationsToReassign.map((r) => r._id),
      },
    };

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
