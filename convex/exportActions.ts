import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";

/**
 * Trigger.dev hand-off for export jobs.
 *
 * Why these are actions and not inline `fetch` calls in the mutations:
 * Convex mutations run inside a transaction and cannot perform network
 * I/O. Calling `fetch` from `createWorkspaceExport` /
 * `createOnboardingArtworkExport` would throw as soon as Trigger
 * credentials were configured, and the catch block would mark the row
 * failed — the export would never start. The mutation inserts the row
 * and schedules one of these actions instead.
 *
 * Failures are written back onto the export row (with an
 * `errorMessage`, so `updateWorkspaceExportStatus` does not mistake it
 * for a user cancel). The scheduler itself does not retry, but the
 * message is enough for the UI to show a retry affordance.
 */

const TRIGGER_API_BASE = "https://api.trigger.dev/api/v1/tasks";

const MISSING_KEY_MESSAGE =
  "TRIGGER_SECRET_KEY (or TRIGGER_API_KEY) is not set in the Convex environment variables.";

function triggerSecretKey(): string | undefined {
  return process.env.TRIGGER_SECRET_KEY ?? process.env.TRIGGER_API_KEY;
}

async function triggerTask(
  taskName: string,
  payload: Record<string, unknown>
): Promise<void> {
  const key = triggerSecretKey();
  if (!key) {
    throw new Error(MISSING_KEY_MESSAGE);
  }

  const response = await fetch(
    `${TRIGGER_API_BASE}/${encodeURIComponent(taskName)}/trigger`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ payload }),
    }
  );

  if (!response.ok) {
    throw new Error(`Trigger.dev request failed: ${response.status}`);
  }
}

/** Starts `process-workspace-export` or `process-workspace-links-export`. */
export const triggerWorkspaceExportTask = internalAction({
  args: {
    exportId: v.id("workspaceExports"),
    workspaceId: v.id("workspaces"),
    taskName: v.string(),
    scope: v.optional(
      v.union(
        v.literal("workspace"),
        v.literal("images"),
        v.literal("links")
      )
    ),
    imageIds: v.optional(v.array(v.id("workspaceImages"))),
    linkIds: v.optional(v.array(v.id("workspaceLinks"))),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    try {
      await triggerTask(args.taskName, {
        workspaceId: args.workspaceId,
        exportId: String(args.exportId),
        imageIds: args.imageIds,
        linkIds: args.linkIds,
        scope: args.scope,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error("Failed to trigger workspace export task:", errorMessage);
      await ctx.runMutation(
        internal.mutations.http.updateWorkspaceExportStatus,
        {
          exportId: args.exportId,
          status: "failed",
          errorMessage,
        }
      );
    }
    return null;
  },
});

/** Starts `process-onboarding-artwork-export`. */
export const triggerOnboardingArtworkExportTask = internalAction({
  args: {
    exportId: v.id("onboardingArtworkExports"),
    onboardingId: v.id("adminOnboardings"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    try {
      await triggerTask("process-onboarding-artwork-export", {
        onboardingId: args.onboardingId,
        exportId: String(args.exportId),
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(
        "Failed to trigger onboarding artwork export task:",
        errorMessage
      );
      await ctx.runMutation(
        internal.onboardingArtworkExports.updateOnboardingArtworkExportStatus,
        {
          exportId: args.exportId,
          status: "failed",
          errorMessage,
        }
      );
    }
    return null;
  },
});
