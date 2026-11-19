import { internalMutation } from "../_generated/server";
import { v } from "convex/values";

/**
 * Repair tooling for the 2026-11-14..19 workspace-content wipe.
 *
 * The nightly `delete-expired-workspace-content` task selected every
 * workspace (including active ones) because the `by_endedAt` range
 * treated the optional field's `null` bucket as "older than cutoff".
 * It then hard-deleted `workspaceNotes`, `workspaceLinks`,
 * `workspaceImages`, `workspaceMessages`, and `workspaceAliases`.
 *
 * The B2 ledger (`fileUploads`) was untouched, so every image and
 * file attachment can be reconstructed. Text messages have no
 * secondary store; they are only recoverable from a Convex backup
 * or the deployment's document log (Convex support).
 *
 * The row inserts deliberately go through `npx convex import`
 * (see `scripts/restore-workspace-content.mjs`) so the original
 * `_creationTime` from the ledger is preserved — a mutation would
 * stamp every restored message with "now" and scramble the thread
 * order. This module only handles the counter repair, which import
 * cannot express.
 */
export const recomputeWorkspaceImageCounts = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace) {
      throw new Error(`Workspace ${args.workspaceId} not found`);
    }

    const images = await ctx.db
      .query("workspaceImages")
      .withIndex("by_workspaceId_and_deletedAt", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("deletedAt", undefined)
      )
      .collect();

    const instructor = workspace.instructorId
      ? await ctx.db.get(workspace.instructorId)
      : null;
    const instructorUserId = instructor?.userId;

    let studentImageCount = 0;
    let instructorImageCount = 0;
    for (const image of images) {
      if (instructorUserId !== undefined && image.createdBy === instructorUserId) {
        instructorImageCount += 1;
      } else if (image.createdBy === workspace.ownerId) {
        studentImageCount += 1;
      }
      // Uploads by other participants (admins) are counted live by
      // `countActiveWorkspaceImages`; the workspace counters cover
      // student and instructor caps only.
    }

    if (!args.dryRun) {
      await ctx.db.patch(args.workspaceId, {
        studentImageCount,
        instructorImageCount,
      });
    }

    return {
      workspaceId: args.workspaceId,
      studentImageCount,
      instructorImageCount,
      totalVisibleImages: images.length,
      dryRun: args.dryRun ?? false,
    };
  },
});
