import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";

const MAX_WORKSPACE_FILE_BYTES = 50 * 1024 * 1024;
const WORKSPACE_IMAGE_CAPS = {
  student: 75,
  instructor: 150,
  admin: 9999,
} as const;

type WorkspaceRole = "instructor" | "student" | "admin" | null;

async function getWorkspaceRole(ctx: any, workspaceId: Id<"workspaces">, userId: string): Promise<WorkspaceRole> {
  const membership = await ctx.db
    .query("workspaceMemberships")
    .withIndex("by_workspace_and_user", (q: any) => q.eq("workspaceId", workspaceId).eq("userId", userId))
    .first();
  return membership?.role ?? null;
}

async function countActiveWorkspaceImages(ctx: any, workspaceId: Id<"workspaces">): Promise<number> {
  let count = 0;
  for await (const img of ctx.db.query("workspaceImages").withIndex("by_workspaceId", (q: any) => q.eq("workspaceId", workspaceId))) {
    if (!img.deletedAt) count++;
  }
  return count;
}

/** Returns all instructor resources for the current user's instructor record in a workspace. */
export const getInstructorResources = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return [];
    }

    const instructor = await ctx.db
      .query("instructors")
      .withIndex("by_userId", (q: any) => q.eq("userId", user.subject))
      .first();
    if (!instructor) {
      return [];
    }

    const resources = await ctx.db
      .query("instructorResources")
      .withIndex("by_instructorId", (q: any) => q.eq("instructorId", instructor._id))
      .collect();

    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace) {
      return [];
    }

    const filtered = resources.filter(r => r.workspaceId === args.workspaceId);
    if (workspace.instructorId !== instructor._id) {
      return [];
    }

    const enriched = await Promise.all(
      filtered.map(async (r) => {
        const url = await ctx.storage.getUrl(r.storageId);
        return {
          ...r,
          url: url ?? null,
        };
      })
    );

    return enriched;
  },
});

/** Uploads a new instructor resource. Enforces image/file size and image cap limits. Requires instructor or admin role. */
export const uploadInstructorResource = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    storageId: v.id("_storage"),
    fileName: v.string(),
    contentType: v.string(),
    size: v.number(),
    type: v.union(v.literal("image"), v.literal("file")),
  },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      throw new Error("Unauthorized");
    }

    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace) {
      throw new Error("Workspace not found");
    }

    const role = await getWorkspaceRole(ctx, args.workspaceId, user.subject);
    if (role !== "instructor" && role !== "admin") {
      throw new Error("Only instructors and admins can upload resources");
    }

    const instructor = await ctx.db
      .query("instructors")
      .withIndex("by_userId", (q: any) => q.eq("userId", user.subject))
      .first();
    if (!instructor) {
      throw new Error("Instructor not found");
    }

    if (role === "instructor" && workspace.instructorId !== instructor._id) {
      throw new Error("You are not the instructor for this workspace");
    }

    if (args.size > MAX_WORKSPACE_FILE_BYTES) {
      throw new Error("File exceeds 50MB size limit");
    }

    if (args.type === "image") {
      const isAdmin = role === "admin";
      const currentCount = isAdmin
        ? await countActiveWorkspaceImages(ctx, args.workspaceId)
        : (workspace.instructorImageCount ?? 0);
      const cap = isAdmin ? WORKSPACE_IMAGE_CAPS.admin : WORKSPACE_IMAGE_CAPS.instructor;
      if (currentCount >= cap) {
        throw new Error(`Image limit reached (${cap} images allowed)`);
      }
    }

    const resourceId = await ctx.db.insert("instructorResources", {
      instructorId: instructor._id,
      workspaceId: args.workspaceId,
      storageId: args.storageId,
      fileName: args.fileName,
      contentType: args.contentType,
      size: args.size,
      type: args.type,
      createdBy: user.subject,
      createdAt: Date.now(),
    });

    if (args.type === "image") {
      await ctx.db.patch(args.workspaceId, {
        instructorImageCount: (workspace.instructorImageCount ?? 0) + 1,
      });
    }

    return resourceId;
  },
});

/** Deletes an instructor resource and decrements the image count if it was an image. Requires ownership. */
export const deleteInstructorResource = mutation({
  args: { id: v.id("instructorResources") },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      throw new Error("Unauthorized");
    }

    const resource = await ctx.db.get(args.id);
    if (!resource) {
      throw new Error("Resource not found");
    }

    const instructor = await ctx.db
      .query("instructors")
      .withIndex("by_userId", (q: any) => q.eq("userId", user.subject))
      .first();
    if (!instructor || resource.instructorId !== instructor._id) {
      throw new Error("Not authorized to delete this resource");
    }

    if (resource.type === "image") {
      const workspace = await ctx.db.get(resource.workspaceId);
      if (workspace) {
        await ctx.db.patch(resource.workspaceId, {
          instructorImageCount: Math.max(0, (workspace.instructorImageCount ?? 1) - 1),
        });
      }
    }

    await ctx.db.delete(args.id);
  },
});

/** Shares an instructor image resource to the workspace chat. Also creates a workspaceImage record so it appears in the Images tab. Requires instructor or admin role. */
export const shareResourceToChat = mutation({
  args: {
    resourceId: v.id("instructorResources"),
    workspaceId: v.id("workspaces"),
  },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      throw new Error("Unauthorized");
    }

    const role = await getWorkspaceRole(ctx, args.workspaceId, user.subject);
    if (role !== "instructor" && role !== "admin") {
      throw new Error("Only instructors and admins can share resources");
    }

    const resource = await ctx.db.get(args.resourceId);
    if (!resource) {
      throw new Error("Resource not found");
    }
    if (resource.type !== "image") {
      throw new Error("Only image resources can be shared to chat");
    }
    if (resource.workspaceId !== args.workspaceId) {
      throw new Error("Resource does not belong to this workspace");
    }

    const imageUrl = await ctx.storage.getUrl(resource.storageId);
    if (!imageUrl) {
      throw new Error("Failed to get image URL");
    }

    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace) {
      throw new Error("Workspace not found");
    }

    const isAdmin = role === "admin";
    const currentCount = isAdmin
      ? await countActiveWorkspaceImages(ctx, args.workspaceId)
      : (workspace.instructorImageCount ?? 0);
    const cap = isAdmin ? WORKSPACE_IMAGE_CAPS.admin : WORKSPACE_IMAGE_CAPS.instructor;
    if (currentCount >= cap) {
      throw new Error(`Image limit reached (${cap} images allowed)`);
    }

    await ctx.db.insert("workspaceImages", {
      workspaceId: args.workspaceId,
      imageUrl,
      storageId: resource.storageId,
      createdBy: user.subject,
    });

    await ctx.db.patch(args.workspaceId, {
      instructorImageCount: (workspace.instructorImageCount ?? 0) + 1,
    });

    await ctx.db.insert("workspaceMessages", {
      workspaceId: args.workspaceId,
      userId: user.subject,
      content: `encodeURIComponent(${resource.fileName})|${imageUrl}`,
      type: "file",
    });
  },
});

/** Embeds an instructor image resource in a workspace note. Also creates a workspaceImage record and updates the note's imageUrl. Requires instructor or admin role. */
export const embedResourceInNote = mutation({
  args: {
    resourceId: v.id("instructorResources"),
    noteId: v.id("workspaceNotes"),
  },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      throw new Error("Unauthorized");
    }

    const resource = await ctx.db.get(args.resourceId);
    if (!resource) {
      throw new Error("Resource not found");
    }
    if (resource.type !== "image") {
      throw new Error("Only image resources can be embedded in notes");
    }

    const note = await ctx.db.get(args.noteId);
    if (!note) {
      throw new Error("Note not found");
    }

    const role = await getWorkspaceRole(ctx, note.workspaceId, user.subject);
    if (role !== "instructor" && role !== "admin") {
      throw new Error("Only instructors and admins can embed resources in notes");
    }

    if (resource.workspaceId !== note.workspaceId) {
      throw new Error("Resource does not belong to this workspace");
    }

    const imageUrl = await ctx.storage.getUrl(resource.storageId);
    if (!imageUrl) {
      throw new Error("Failed to get image URL");
    }

    const workspace = await ctx.db.get(note.workspaceId);
    if (!workspace) {
      throw new Error("Workspace not found");
    }

    const isAdmin = role === "admin";
    const currentCount = isAdmin
      ? await countActiveWorkspaceImages(ctx, note.workspaceId)
      : (workspace.instructorImageCount ?? 0);
    const cap = isAdmin ? WORKSPACE_IMAGE_CAPS.admin : WORKSPACE_IMAGE_CAPS.instructor;
    if (currentCount >= cap) {
      throw new Error(`Image limit reached (${cap} images allowed)`);
    }

    await ctx.db.insert("workspaceImages", {
      workspaceId: note.workspaceId,
      imageUrl,
      storageId: resource.storageId,
      createdBy: user.subject,
    });

    await ctx.db.patch(note.workspaceId, {
      instructorImageCount: (workspace.instructorImageCount ?? 0) + 1,
    });

    await ctx.db.patch(args.noteId, {
      imageUrl,
      updatedAt: Date.now(),
    });

    return imageUrl;
  },
});