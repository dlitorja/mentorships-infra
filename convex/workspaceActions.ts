import { action } from "./_generated/server";
import { v } from "convex/values";

async function isAdmin(ctx: any, userId: string): Promise<boolean> {
  const user = await ctx.db
    .query("users")
    .withIndex("by_userId", (q: any) => q.eq("userId", userId))
    .first();
  return user?.role === "admin";
}

async function canAccessWorkspace(
  ctx: any,
  workspaceId: any,
  userId: string
): Promise<boolean> {
  const workspace = await ctx.db.get(workspaceId);
  if (!workspace) return false;

  const userIsAdmin = await isAdmin(ctx, userId);
  if (userIsAdmin) return true;

  if (workspace.ownerId === userId) return true;

  if (workspace.instructorId) {
    const instructor = await ctx.db
      .query("instructors")
      .withIndex("by_userId", (q: any) => q.eq("userId", userId))
      .first();
    if (instructor && instructor._id === workspace.instructorId) {
      return true;
    }
  }

  return false;
}

export const generateWorkspaceImageUploadUrl = action({
  args: {
    workspaceId: v.id("workspaces"),
  },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      throw new Error("Unauthorized");
    }

    const canAccess = await canAccessWorkspace(ctx, args.workspaceId, user.subject);
    if (!canAccess) {
      throw new Error("Not authorized to upload images to this workspace");
    }

    const uploadUrl = await ctx.storage.generateUploadUrl();
    return uploadUrl;
  },
});