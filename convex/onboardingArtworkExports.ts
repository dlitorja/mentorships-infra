import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { getAuthorizedOnboardingRow } from "./onboardingWorkExamples";

/**
 * Onboarding artwork exports — "download all" for reviewers.
 *
 * Instructors reviewing a submitted questionnaire can already open
 * every work example individually. This module backs the ZIP variant:
 * a reviewer asks for one archive, a Trigger.dev task streams the
 * active objects straight out of the workspace B2 bucket and writes
 * the ZIP back beside them, and the row flips to `completed` with a
 * 7-day signed URL.
 *
 * Design notes:
 * - Nothing passes through Convex storage. The task reads/writes B2
 *   directly, matching `src/trigger/workspace-export.ts`.
 * - Rows live in `onboardingArtworkExports` rather than
 *   `workspaceExports` because no workspace exists yet at review time.
 * - Auth is the same gate as `listWorkExamples` /
 *   `getWorkExampleByIdForViewer`: assigned student, an assigned
 *   instructor, or admin/support. The requester's Clerk subject is
 *   derived from auth, never from the client.
 */

const MISSING_TRIGGER_KEY_MESSAGE =
  "TRIGGER_SECRET_KEY (or TRIGGER_API_KEY) is not set in the Convex environment variables.";

/** Creates a pending export row and asks Trigger.dev to build the ZIP. */
export const createOnboardingArtworkExport = mutation({
  args: { onboardingId: v.id("adminOnboardings") },
  returns: v.object({
    exportId: v.id("onboardingArtworkExports"),
    errorMessage: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Unauthorized");
    }

    const onboarding = await getAuthorizedOnboardingRow(
      ctx,
      args.onboardingId,
      identity.subject
    );
    if (!onboarding) {
      // Same "do not leak existence" posture as the read paths.
      throw new Error("Not authorized to export this onboarding");
    }

    const activeCount = (
      await ctx.db
        .query("onboardingWorkExamples")
        .withIndex("by_onboardingId_active", (q) =>
          q.eq("onboardingId", args.onboardingId).eq("status", "active")
        )
        .collect()
    ).length;

    if (activeCount === 0) {
      throw new Error("There is no uploaded artwork to export yet.");
    }

    const exportId = await ctx.db.insert("onboardingArtworkExports", {
      onboardingId: args.onboardingId,
      requestedBy: identity.subject,
      status: "pending",
    });

    const triggerSecretKey =
      process.env.TRIGGER_SECRET_KEY ?? process.env.TRIGGER_API_KEY;

    if (!triggerSecretKey) {
      await ctx.db.patch(exportId, {
        status: "failed",
        errorMessage: MISSING_TRIGGER_KEY_MESSAGE,
      });
      return { exportId, errorMessage: MISSING_TRIGGER_KEY_MESSAGE };
    }

    // Convex mutations cannot make network requests, so the Trigger.dev
    // call lives in an internal action. The action writes a failure back
    // onto this row if the request is rejected.
    await ctx.scheduler.runAfter(
      0,
      internal.exportActions.triggerOnboardingArtworkExportTask,
      {
        exportId,
        onboardingId: args.onboardingId,
      }
    );

    return { exportId };
  },
});

/**
 * Latest exports for an onboarding, newest first. Gated to authorized
 * viewers; returns `[]` for anyone else so the surface degrades to
 * "nothing to show" rather than an error.
 */
export const getOnboardingArtworkExports = query({
  args: { onboardingId: v.id("adminOnboardings") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    const onboarding = await getAuthorizedOnboardingRow(
      ctx,
      args.onboardingId,
      identity.subject
    );
    if (!onboarding) return [];

    return await ctx.db
      .query("onboardingArtworkExports")
      .withIndex("by_onboardingId", (q) =>
        q.eq("onboardingId", args.onboardingId)
      )
      .order("desc")
      .take(5);
  },
});

/**
 * Marks an in-flight export as failed so the reviewer can start a new
 * one. Allowed for the requester or any other authorized viewer of the
 * onboarding (a reviewer taking over from a colleague shouldn't be
 * blocked by a stuck archive).
 */
export const cancelOnboardingArtworkExport = mutation({
  args: { id: v.id("onboardingArtworkExports") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    const exportDoc = await ctx.db.get(args.id);
    if (!exportDoc) throw new Error("Export not found");

    if (exportDoc.requestedBy !== identity.subject) {
      const onboarding = await getAuthorizedOnboardingRow(
        ctx,
        exportDoc.onboardingId,
        identity.subject
      );
      if (!onboarding) {
        throw new Error("Not authorized to cancel this export");
      }
    }

    // No errorMessage on purpose — that is the marker
    // `updateOnboardingArtworkExportStatus` uses to distinguish a
    // user cancel from a task failure (same convention as
    // `cancelWorkspaceExport`).
    await ctx.db.patch(args.id, { status: "failed" });
    return null;
  },
});

/**
 * Task-facing data: the active work examples for an onboarding, plus
 * the student's email so the archive can be named after them.
 * Internal because it returns B2 keys.
 */
export const getOnboardingArtworkExportData = internalQuery({
  args: { onboardingId: v.id("adminOnboardings") },
  returns: v.object({
    studentEmail: v.string(),
    files: v.array(
      v.object({
        b2Key: v.string(),
        fileName: v.string(),
        contentType: v.string(),
        size: v.number(),
      })
    ),
  }),
  handler: async (ctx, args) => {
    const onboarding = await ctx.db.get(args.onboardingId);
    if (!onboarding) {
      throw new Error("Onboarding not found");
    }

    const rows = await ctx.db
      .query("onboardingWorkExamples")
      .withIndex("by_onboardingId_active", (q) =>
        q.eq("onboardingId", args.onboardingId).eq("status", "active")
      )
      .collect();

    // Stable order so a retried export produces the same archive
    // layout and duplicate-name suffixes stay deterministic.
    rows.sort((a, b) => a.uploadedAt - b.uploadedAt || a._id.localeCompare(b._id));

    return {
      studentEmail: onboarding.email,
      files: rows.map((row) => ({
        b2Key: row.b2Key,
        fileName: row.fileName,
        contentType: row.contentType,
        size: row.size,
      })),
    };
  },
});

/**
 * Task-facing status update. Mirrors `updateWorkspaceExportStatus`:
 * a completed row can never be downgraded, and a user-cancelled row
 * (`failed` with no `errorMessage`) cannot be revived by a retry.
 */
export const updateOnboardingArtworkExportStatus = internalMutation({
  args: {
    exportId: v.id("onboardingArtworkExports"),
    status: v.union(
      v.literal("pending"),
      v.literal("processing"),
      v.literal("completed"),
      v.literal("failed")
    ),
    downloadUrl: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
    fileCount: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const exportRecord = await ctx.db.get(args.exportId);
    if (!exportRecord) {
      throw new Error("Export not found");
    }

    if (exportRecord.status === "completed" && args.status !== "completed") {
      throw new Error("Export already completed");
    }

    const isUserCancel =
      exportRecord.status === "failed" && exportRecord.errorMessage === undefined;
    if (isUserCancel) {
      throw new Error("Export was cancelled; refusing to update");
    }

    const updates: Record<string, unknown> = { status: args.status };
    if (args.downloadUrl !== undefined) updates.downloadUrl = args.downloadUrl;
    if (args.expiresAt !== undefined) updates.expiresAt = args.expiresAt;
    if (args.errorMessage !== undefined) updates.errorMessage = args.errorMessage;
    if (args.fileCount !== undefined) updates.fileCount = args.fileCount;

    await ctx.db.patch(args.exportId, updates);
    return null;
  },
});
