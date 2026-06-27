import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

export const generateWorkspaceImageUploadUrl = action({
  args: {
    workspaceId: v.id("workspaces"),
  },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    console.log("DEBUG generateWorkspaceImageUploadUrl called");
    console.log("DEBUG user:", user);
    if (!user) {
      console.log("DEBUG: user is null, throwing Unauthorized");
      throw new Error("Unauthorized");
    }

    console.log("DEBUG user.subject:", user.subject);
    const canAccess = await ctx.runQuery(internal.workspaces.canAccessWorkspaceQuery, {
      workspaceId: args.workspaceId,
      userId: user.subject,
    });
    if (!canAccess) {
      throw new Error("Not authorized to upload images to this workspace");
    }

    const uploadUrl = await ctx.storage.generateUploadUrl();
    return uploadUrl;
  },
});