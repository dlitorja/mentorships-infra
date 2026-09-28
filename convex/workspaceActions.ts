// PR workspace-storage-3c: the `generateWorkspaceImageUploadUrl`
// action is retained for the legacy `apps/web` client
// (`apps/web/components/workspace/images.tsx`). `apps/web` has not
// been ported to the B2 path — its workspace gallery still uploads
// to Convex storage. The action is gated by `WORKSPACE_STORAGE_USE_B2`
// the same way the B2 actions are: when the flag is set, this
// action refuses to mint a URL so legacy callers fail loud during
// the cutover window. `apps/platform` does NOT call this action —
// all `apps/platform` uploads go through
// `workspaceStorage.generateWorkspaceUploadUrl`.
"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { api } from "./_generated/api";

export const generateWorkspaceImageUploadUrl = action({
  args: {
    workspaceId: v.id("workspaces"),
  },
  handler: async (ctx, args) => {
    if (process.env.WORKSPACE_STORAGE_USE_B2 === "true") {
      throw new Error(
        "Convex storage uploads are disabled. Use workspaceStorage.generateWorkspaceUploadUrl."
      );
    }

    const role = await ctx.runQuery(api.workspaces.getUserWorkspaceRole, {
      workspaceId: args.workspaceId,
    });
    if (!role) {
      throw new Error("Not authorized to upload to this workspace");
    }

    return await ctx.storage.generateUploadUrl();
  },
});
