import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

async function isAdmin(ctx: any, userId: string): Promise<boolean> {
  const user = await ctx.db
    .query("users")
    .withIndex("by_userId", (q: any) => q.eq("userId", userId))
    .first();
  return user?.role === "admin";
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

export const getAllWorkspaces = query({
  args: {
    paginationOpts: v.any(),
    type: v.optional(v.union(v.literal("mentorship"), v.literal("admin_mentee"), v.literal("admin_instructor"))),
  },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return { page: [], continueCursor: null, isDone: true };
    }

    const isUserAdmin = await isAdmin(ctx, user.subject);
    if (!isUserAdmin) {
      throw new Error("Admin access required");
    }

    if (args.type) {
      return await ctx.db
        .query("workspaces")
        .withIndex("by_type", (q) => q.eq("type", args.type))
        .order("desc")
        .paginate(args.paginationOpts);
    }

    return await ctx.db
      .query("workspaces")
      .order("desc")
      .paginate(args.paginationOpts);
  },
});

export const getWorkspaceByIdAdmin = query({
  args: { id: v.id("workspaces") },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return null;
    }

    const isUserAdmin = await isAdmin(ctx, user.subject);
    if (!isUserAdmin) {
      throw new Error("Admin access required");
    }

    const workspace = await ctx.db.get(args.id);
    if (!workspace) {
      return null;
    }

    await logWorkspaceAudit(ctx, args.id, user.subject, "view_workspace");

    return workspace;
  },
});

export const createAdminMenteeWorkspace = mutation({
  args: {
    menteeUserId: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      throw new Error("Unauthorized");
    }

    const isUserAdmin = await isAdmin(ctx, user.subject);
    if (!isUserAdmin) {
      throw new Error("Admin access required");
    }

    const existingWorkspace = await ctx.db
      .query("workspaces")
      .filter((q) =>
        q.and(
          q.eq(q.field("ownerId"), args.menteeUserId),
          q.eq(q.field("type"), "admin_mentee")
        )
      )
      .first();

    if (existingWorkspace) {
      await logWorkspaceAudit(ctx, existingWorkspace._id, user.subject, "create_admin_mentee_workspace", "Returned existing workspace");
      return existingWorkspace;
    }

    const mentee = await ctx.db
      .query("users")
      .withIndex("by_userId", (q: any) => q.eq("userId", args.menteeUserId))
      .first();

    const workspaceId = await ctx.db.insert("workspaces", {
      name: `Admin Communication - ${mentee?.firstName || mentee?.email || "User"}`,
      description: "Private workspace for admin-mentee communication",
      ownerId: args.menteeUserId,
      isPublic: false,
      menteeImageCount: 0,
      mentorImageCount: 0,
      type: "admin_mentee",
    });

    await logWorkspaceAudit(ctx, workspaceId, user.subject, "create_admin_mentee_workspace");

    return await ctx.db.get(workspaceId);
  },
});

export const createAdminInstructorWorkspace = mutation({
  args: {
    instructorId: v.id("instructors"),
  },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      throw new Error("Unauthorized");
    }

    const isUserAdmin = await isAdmin(ctx, user.subject);
    if (!isUserAdmin) {
      throw new Error("Admin access required");
    }

    const existingWorkspace = await ctx.db
      .query("workspaces")
      .filter((q) =>
        q.and(
          q.eq(q.field("mentorId"), args.instructorId),
          q.eq(q.field("type"), "admin_instructor")
        )
      )
      .first();

    if (existingWorkspace) {
      await logWorkspaceAudit(ctx, existingWorkspace._id, user.subject, "create_admin_instructor_workspace", "Returned existing workspace");
      return existingWorkspace;
    }

    const workspaceId = await ctx.db.insert("workspaces", {
      name: "Admin Communication - Instructor",
      description: "Private workspace for admin-instructor communication",
      ownerId: user.subject,
      mentorId: args.instructorId,
      isPublic: false,
      menteeImageCount: 0,
      mentorImageCount: 0,
      type: "admin_instructor",
    });

    await logWorkspaceAudit(ctx, workspaceId, user.subject, "create_admin_instructor_workspace");

    return await ctx.db.get(workspaceId);
  },
});

export const getWorkspaceAuditLogs = query({
  args: {
    workspaceId: v.id("workspaces"),
    paginationOpts: v.any(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return { page: [], continueCursor: null, isDone: true };
    }

    const isUserAdmin = await isAdmin(ctx, user.subject);
    if (!isUserAdmin) {
      throw new Error("Admin access required");
    }

    return await ctx.db
      .query("workspaceAuditLogs")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", args.workspaceId))
      .order("desc")
      .paginate(args.paginationOpts);
  },
});

export const getAllAuditLogs = query({
  args: {
    paginationOpts: v.any(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return { page: [], continueCursor: null, isDone: true };
    }

    const isUserAdmin = await isAdmin(ctx, user.subject);
    if (!isUserAdmin) {
      throw new Error("Admin access required");
    }

    return await ctx.db
      .query("workspaceAuditLogs")
      .withIndex("by_timestamp")
      .order("desc")
      .paginate(args.paginationOpts);
  },
});
