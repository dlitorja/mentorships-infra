import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

const WORKSPACE_IMAGE_CAPS = {
  mentee: 75,
  instructor: 150,
  admin: 150,
} as const;

const EIGHTEEN_MONTHS_MS = 18 * 30 * 24 * 60 * 60 * 1000;

type WorkspaceRole = "mentor" | "mentee" | "admin" | null;

async function isAdmin(ctx: any, userId: string): Promise<boolean> {
  const user = await ctx.db
    .query("users")
    .withIndex("by_userId", (q: any) => q.eq("userId", userId))
    .first();
  return user?.role === "admin";
}

async function getWorkspaceRole(
  ctx: any,
  workspace: { mentorId?: any; ownerId: string; type?: string },
  userId: string
): Promise<WorkspaceRole> {
  const userIsAdmin = await isAdmin(ctx, userId);
  if (userIsAdmin) {
    return "admin";
  }

  if (workspace.type === "admin_mentee") {
    return workspace.ownerId === userId ? "mentee" : null;
  }

  if (workspace.type === "admin_instructor") {
    if (workspace.mentorId) {
      const instructor = await ctx.db
        .query("instructors")
        .withIndex("by_userId", (q: any) => q.eq("userId", userId))
        .first();
      if (instructor && instructor._id === workspace.mentorId) {
        return "mentor";
      }
    }
    return null;
  }

  if (workspace.mentorId) {
    const mentor = await ctx.db
      .query("instructors")
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

async function logWorkspaceAudit(
  ctx: any,
  workspaceId: any,
  adminId: string,
  action: "view_workspace" | "send_message" | "create_workspace" | "create_admin_mentee_workspace" | "create_admin_instructor_workspace",
  details?: string
) {
  await ctx.db.insert("workspaceAuditLogs", {
    workspaceId,
    adminId,
    action,
    details,
    timestamp: Date.now(),
  });
}

/** Log a view_workspace audit event. Called from admin API routes after fetching workspace details. */
export const logViewWorkspaceAudit = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    adminId: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("workspaceAuditLogs", {
      workspaceId: args.workspaceId,
      adminId: args.adminId,
      action: "view_workspace",
      timestamp: Date.now(),
    });
  },
});

/** Returns a workspace by ID. Requires auth. */
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

/** Returns all workspaces owned by a user. Requires auth. */
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

/** Returns all workspaces assigned to an instructor. Requires auth. */
export const getInstructorWorkspaces = query({
  args: { mentorId: v.id("instructors") },
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

/** Returns a workspace by seat reservation ID. Requires auth. */
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

/** Returns workspaces past the 18-month retention period that are pending deletion. */
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

/** Returns workspaces approaching retention deletion within 90, 30, or 7 days. */
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

/** Returns the authenticated user's role (mentor/mentee/admin) in a workspace. Requires auth. */
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
    const role = await getWorkspaceRole(ctx, { mentorId: workspace.mentorId, ownerId: workspace.ownerId, type: workspace.type }, user.subject);
    return role;
  },
});

/** Creates a new workspace with the given owner, mentor, and settings. */
export const createWorkspace = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    ownerId: v.string(),
    mentorId: v.optional(v.id("instructors")),
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

/** Updates a workspace's name, description, image, or visibility. */
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

/** Soft-deletes a workspace by setting the deletedAt timestamp. */
export const deleteWorkspace = mutation({
  args: { id: v.id("workspaces") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { deletedAt: Date.now() });
  },
});

/** Returns all notes for a workspace. Requires auth. */
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

/** Creates a new note in a workspace. */
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

/** Updates a workspace note's title and content. */
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

/** Soft-deletes a workspace note by setting deletedAt. */
export const deleteWorkspaceNote = mutation({
  args: { id: v.id("workspaceNotes") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { deletedAt: Date.now() });
  },
});

/** Returns all links for a workspace. Requires auth. */
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

/** Creates a new link in a workspace. */
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

/** Soft-deletes a workspace link by setting deletedAt. */
export const deleteWorkspaceLink = mutation({
  args: { id: v.id("workspaceLinks") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { deletedAt: Date.now() });
  },
});

/** Returns images for a workspace, filtered by role (mentors see all, mentees see own and mentor's). Requires auth. */
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

/** Creates an image in a workspace, enforcing role-based upload caps. Requires auth. */
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
    const isAdmin = role === "admin";
    const currentCount = isMentee
      ? (workspace.menteeImageCount ?? 0)
      : (workspace.mentorImageCount ?? 0);
    const cap = isMentee
      ? WORKSPACE_IMAGE_CAPS.mentee
      : isAdmin
        ? WORKSPACE_IMAGE_CAPS.admin
        : WORKSPACE_IMAGE_CAPS.instructor;

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

/** Returns workspace notes and images for export. Requires auth. */
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

/** Soft-deletes a workspace image and decrements the role-based image counter. */
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

/** Returns all messages for a workspace in chronological order. Requires auth. */
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

/** Creates a message in a workspace with automatic sender role detection. Requires auth. */
export const createWorkspaceMessage = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    userId: v.string(),
    content: v.string(),
    type: v.optional(v.union(v.literal("text"), v.literal("image"), v.literal("file"))),
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

    const isUserAdmin = await isAdmin(ctx, user.subject);
    let senderRole: "mentor" | "mentee" | "admin" | undefined;

    if (isUserAdmin) {
      senderRole = "admin";
    } else if (workspace.mentorId) {
      const instructor = await ctx.db
        .query("instructors")
        .withIndex("by_userId", (q: any) => q.eq("userId", user.subject))
        .first();
      if (instructor && instructor._id === workspace.mentorId) {
        senderRole = "mentor";
      } else if (workspace.ownerId === user.subject) {
        senderRole = "mentee";
      }
    } else if (workspace.ownerId === user.subject) {
      senderRole = "mentee";
    }

    const messageId = await ctx.db.insert("workspaceMessages", {
      ...args,
      type: args.type ?? "text",
      senderRole,
    });

    if (isUserAdmin) {
      await logWorkspaceAudit(ctx, args.workspaceId, user.subject, "send_message");
    }

    return messageId;
  },
});

/** Creates a workspace export record and triggers a Trigger.dev task for zip format. Requires auth. */
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

/** Updates an export's status, download URL, or expiration time. */
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

/** Returns the 10 most recent exports for a workspace. Requires auth. */
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

/** Returns all retention notifications for a workspace. Requires auth. */
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

/** Returns unacknowledged retention notifications for the current user across all workspaces. */
export const getUnacknowledgedRetentionNotifications = query({
  args: {},
  handler: async (ctx) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return [];
    }

    const notifications = await ctx.db
      .query("workspaceRetentionNotifications")
      .withIndex("by_userId", (q) => q.eq("userId", user.subject))
      .filter((q) => q.eq(q.field("acknowledgedAt"), undefined))
      .collect();

    return notifications;
  },
});

/** Creates a retention notification (expiry warning or deleted). */
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

/** Marks a retention notification as acknowledged. */
export const acknowledgeNotification = mutation({
  args: { id: v.id("workspaceRetentionNotifications") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { acknowledgedAt: Date.now() });
    return await ctx.db.get(args.id);
  },
});

/** Permanently deletes all notes, links, images, and messages in a workspace and resets image counters. */
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
