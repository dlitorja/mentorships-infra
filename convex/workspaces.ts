import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

const WORKSPACE_IMAGE_CAPS = {
  mentee: 75,
  mentor: 150,
} as const;

const EIGHTEEN_MONTHS_MS = 18 * 30 * 24 * 60 * 60 * 1000;

async function getWorkspaceRole(
  ctx: any,
  workspace: { mentorId?: any; ownerId: string },
  userId: string
): Promise<"mentor" | "mentee" | null> {
  if (workspace.mentorId) {
    const mentor = await ctx.db
      .query("mentors")
      .withIndex("by_userId", (q: any) => q.eq("userId", userId))
      .first();
    if (mentor && mentor._id === workspace.mentorId) {
      return "mentor";
    }
  }
  if (workspace.ownerId === userId) {
    return "mentee";
  }
  if (workspace.mentorId) {
    const seatReservation = await ctx.db
      .query("seatReservations")
      .withIndex("by_userId", (q: any) => q.eq("userId", userId))
      .filter((q: any) => q.eq(q.field("mentorId"), workspace.mentorId))
      .first();
    if (seatReservation) {
      return "mentee";
    }
  }
  return null;
}

export const getWorkspaceById = query({
  args: { id: v.id("workspaces") },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return null;
    }
    return await ctx.db.get(args.id);
  },
});

export const getUserWorkspaces = query({
  args: { ownerId: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return [];
    }
    return await ctx.db
      .query("workspaces")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", args.ownerId))
      .collect();
  },
});

export const getMentorWorkspaces = query({
  args: { mentorId: v.id("mentors") },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return [];
    }
    return await ctx.db
      .query("workspaces")
      .withIndex("by_mentorId", (q) => q.eq("mentorId", args.mentorId))
      .collect();
  },
});

export const getWorkspaceBySeatReservation = query({
  args: { seatReservationId: v.id("seatReservations") },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return null;
    }
    return await ctx.db
      .query("workspaces")
      .withIndex("by_seatReservationId", (q) =>
        q.eq("seatReservationId", args.seatReservationId)
      )
      .first();
  },
});

export const getWorkspacesNeedingRetentionDeletion = query({
  args: {},
  handler: async (ctx, args) => {
    const cutoff = Date.now() - EIGHTEEN_MONTHS_MS;
    return await ctx.db
      .query("workspaces")
      .withIndex("by_endedAt", (q) => q.lt("endedAt", cutoff))
      .filter((q) => q.or(q.eq(q.field("deletedAt"), undefined), q.gt(q.field("deletedAt"), cutoff)))
      .collect();
  },
});

export const getWorkspacesForRetentionNotification = query({
  args: {},
  handler: async (ctx, args) => {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const notifications: {
      workspace: any;
      daysUntilDeletion: number;
    }[] = [];

    const workspaces = await ctx.db
      .query("workspaces")
      .withIndex("by_endedAt")
      .collect();

    for (const workspace of workspaces) {
      if (!workspace.endedAt) continue;

    const daysUntilDeletion = Math.floor(
      (workspace.endedAt + EIGHTEEN_MONTHS_MS - now) / dayMs
    );

    // Use ±1 window for robustness against timing drift
    const inWindow = (target: number) => daysUntilDeletion >= target - 1 && daysUntilDeletion <= target + 1;
    if (inWindow(90) || inWindow(30) || inWindow(7)) {
      notifications.push({ workspace, daysUntilDeletion });
    }
    }

    return notifications;
  },
});

export const getUserWorkspaceRole = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return null;
    }
    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace) {
      return null;
    }
    const role = await getWorkspaceRole(ctx, { mentorId: workspace.mentorId, ownerId: workspace.ownerId }, user.subject);
    return role;
  },
});

export const createWorkspace = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    ownerId: v.string(),
    mentorId: v.optional(v.id("mentors")),
    imageUrl: v.optional(v.string()),
    isPublic: v.optional(v.boolean()),
    seatReservationId: v.optional(v.id("seatReservations")),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("workspaces", {
      ...args,
      isPublic: args.isPublic ?? false,
      menteeImageCount: 0,
      mentorImageCount: 0,
    });
  },
});

export const updateWorkspace = mutation({
  args: {
    id: v.id("workspaces"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    isPublic: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    await ctx.db.patch(id, updates);
    return await ctx.db.get(id);
  },
});

export const deleteWorkspace = mutation({
  args: { id: v.id("workspaces") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { deletedAt: Date.now() });
  },
});

export const getWorkspaceNotes = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return [];
    }
    return await ctx.db
      .query("workspaceNotes")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();
  },
});

export const createWorkspaceNote = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    title: v.string(),
    content: v.string(),
    createdBy: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("workspaceNotes", {
      ...args,
      updatedAt: Date.now(),
    });
  },
});

export const updateWorkspaceNote = mutation({
  args: {
    id: v.id("workspaceNotes"),
    title: v.optional(v.string()),
    content: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    await ctx.db.patch(id, { ...updates, updatedAt: Date.now() });
    return await ctx.db.get(id);
  },
});

export const deleteWorkspaceNote = mutation({
  args: { id: v.id("workspaceNotes") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { deletedAt: Date.now() });
  },
});

export const getWorkspaceLinks = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return [];
    }
    return await ctx.db
      .query("workspaceLinks")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();
  },
});

export const createWorkspaceLink = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    url: v.string(),
    title: v.optional(v.string()),
    createdBy: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("workspaceLinks", args);
  },
});

export const deleteWorkspaceLink = mutation({
  args: { id: v.id("workspaceLinks") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { deletedAt: Date.now() });
  },
});

export const getWorkspaceImages = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return [];
    }
    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace) {
      return [];
    }
    const role = await getWorkspaceRole(ctx, workspace, user.subject);
    const images = await ctx.db
      .query("workspaceImages")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();

    if (role === "mentor") {
      return images;
    }

    if (!workspace.mentorId) {
      return images.filter((img) => img.createdBy === user.subject);
    }

    // Get the mentor's userId so mentee can see mentor's images
    const mentor = await ctx.db.get(workspace.mentorId);
    const mentorUserId = mentor?.userId;

    return images.filter(
      (img) => img.createdBy === user.subject || img.createdBy === mentorUserId
    );
  },
});

export const createWorkspaceImage = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    imageUrl: v.string(),
    storageId: v.optional(v.string()),
    createdBy: v.string(),
  },
  handler: async (ctx, args) => {
    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace) {
      throw new Error("Workspace not found");
    }

    const role = await getWorkspaceRole(ctx, workspace, args.createdBy);
    if (!role) {
      throw new Error("Not authorized to add images to this workspace");
    }

    const isMentee = role === "mentee";
    const currentCount = isMentee
      ? (workspace.menteeImageCount ?? 0)
      : (workspace.mentorImageCount ?? 0);
    const cap = isMentee
      ? WORKSPACE_IMAGE_CAPS.mentee
      : WORKSPACE_IMAGE_CAPS.mentor;

    if (currentCount >= cap) {
      throw new Error(
        `Image limit reached (${cap} ${role} images allowed per workspace)`
      );
    }

    const imageId = await ctx.db.insert("workspaceImages", args);

    await ctx.db.patch(args.workspaceId, {
      menteeImageCount: isMentee
        ? (workspace.menteeImageCount ?? 0) + 1
        : workspace.menteeImageCount ?? 0,
      mentorImageCount: !isMentee
        ? (workspace.mentorImageCount ?? 0) + 1
        : workspace.mentorImageCount ?? 0,
    });

    return imageId;
  },
});

export const getWorkspaceExportData = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return null;
    }

    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace) {
      return null;
    }

    const role = await getWorkspaceRole(ctx, workspace, user.subject);
    if (!role) {
      return null;
    }

    const notes = await ctx.db
      .query("workspaceNotes")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", args.workspaceId))
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .collect();

    const images = await ctx.db
      .query("workspaceImages")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", args.workspaceId))
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .collect();

    return {
      workspaceName: workspace.name || "Workspace",
      notes: notes.map((n) => ({
        title: n.title,
        content: n.content,
        updatedAt: n.updatedAt,
      })),
      images: images.map((img) => ({
        imageUrl: img.imageUrl,
        createdBy: img.createdBy,
        createdAt: img._creationTime,
      })),
    };
  },
});

export const deleteWorkspaceImage = mutation({
  args: { id: v.id("workspaceImages") },
  handler: async (ctx, args) => {
    const image = await ctx.db.get(args.id);
    if (!image) return;

    await ctx.db.patch(args.id, { deletedAt: Date.now() });

    // Determine if the image was created by mentee or mentor and decrement counter
    const workspace = await ctx.db.get(image.workspaceId);
    if (!workspace) return;

    const isMentee = image.createdBy === workspace.ownerId;
    const mentor = workspace.mentorId ? await ctx.db.get(workspace.mentorId) : null;
    const isMentor = mentor && image.createdBy === mentor.userId;

    if (isMentee) {
      await ctx.db.patch(workspace._id, {
        menteeImageCount: Math.max(0, (workspace.menteeImageCount ?? 1) - 1),
      });
    } else if (isMentor) {
      await ctx.db.patch(workspace._id, {
        mentorImageCount: Math.max(0, (workspace.mentorImageCount ?? 1) - 1),
      });
    }
  },
});

export const getWorkspaceMessages = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return [];
    }
    return await ctx.db
      .query("workspaceMessages")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", args.workspaceId))
      .order("asc")
      .collect();
  },
});

export const createWorkspaceMessage = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    userId: v.string(),
    content: v.string(),
    type: v.optional(v.union(v.literal("text"), v.literal("image"), v.literal("file"))),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("workspaceMessages", {
      ...args,
      type: args.type ?? "text",
    });
  },
});

export const createWorkspaceExport = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    userId: v.string(),
    format: v.union(v.literal("pdf"), v.literal("markdown"), v.literal("zip")),
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

    const role = await getWorkspaceRole(ctx, workspace, user.subject);
    if (!role) {
      throw new Error("Not authorized to export this workspace");
    }

    const exportId = await ctx.db.insert("workspaceExports", {
      ...args,
      status: "pending",
    });

    const triggerApiKey = process.env.TRIGGER_API_KEY;
    const triggerProjectRef = process.env.NEXT_PUBLIC_TRIGGER_PROJECT_REF || "proj_fvyorgaijayllujsxzgb";

    if (triggerApiKey && args.format === "zip") {
      try {
        const response = await fetch(`https://app.trigger.dev/api/v1/projects/${triggerProjectRef}/tasks/process-workspace-export/trigger`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${triggerApiKey}`,
          },
          body: JSON.stringify({
            payload: {
              workspaceId: args.workspaceId,
              exportId: String(exportId),
            },
          }),
        });

        if (!response.ok) {
          await ctx.db.patch(exportId, { status: "failed" });
          throw new Error(`Trigger.dev request failed: ${response.status}`);
        }
      } catch (error) {
        await ctx.db.patch(exportId, { status: "failed" });
        console.error("Failed to trigger export task:", error);
        throw error;
      }
    }

    return exportId;
  },
});

export const updateWorkspaceExport = mutation({
  args: {
    id: v.id("workspaceExports"),
    status: v.optional(v.union(v.literal("pending"), v.literal("processing"), v.literal("completed"), v.literal("failed"))),
    downloadUrl: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    await ctx.db.patch(id, updates);
    return await ctx.db.get(id);
  },
});

export const getWorkspaceExports = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return [];
    }
    return await ctx.db
      .query("workspaceExports")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", args.workspaceId))
      .order("desc")
      .take(10);
  },
});

export const getWorkspaceRetentionNotifications = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return [];
    }
    return await ctx.db
      .query("workspaceRetentionNotifications")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();
  },
});

export const createRetentionNotification = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    userId: v.string(),
    notificationType: v.union(v.literal("expiry_warning"), v.literal("deleted")),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("workspaceRetentionNotifications", {
      ...args,
      sentAt: Date.now(),
    });
  },
});

export const acknowledgeNotification = mutation({
  args: { id: v.id("workspaceRetentionNotifications") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { acknowledgedAt: Date.now() });
    return await ctx.db.get(args.id);
  },
});

export const deleteAllWorkspaceContent = mutation({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    const notes = await ctx.db
      .query("workspaceNotes")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();
    for (const note of notes) {
      await ctx.db.delete(note._id);
    }

    const links = await ctx.db
      .query("workspaceLinks")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();
    for (const link of links) {
      await ctx.db.delete(link._id);
    }

    const images = await ctx.db
      .query("workspaceImages")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();
    for (const image of images) {
      await ctx.db.delete(image._id);
    }

    const messages = await ctx.db
      .query("workspaceMessages")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();
    for (const message of messages) {
      await ctx.db.delete(message._id);
    }

    await ctx.db.patch(args.workspaceId, {
      menteeImageCount: 0,
      mentorImageCount: 0,
    });

    return { deleted: { notes: notes.length, links: links.length, images: images.length, messages: messages.length } };
  },
});
