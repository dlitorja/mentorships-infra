import { query, mutation } from "./_generated/server";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";

async function isAdmin(ctx: QueryCtx | MutationCtx, userId: string): Promise<boolean> {
  const user = await ctx.db
    .query("users")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .first();
  return user?.role === "admin";
}

async function logWorkspaceAudit(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
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

type WorkspaceListItem = {
  id: Doc<"workspaces">["_id"];
  name: string;
  description: string | undefined;
  type: string;
  ownerId: string;
  owner: { userId: string; email: string; firstName: string | undefined; lastName: string | undefined } | null;
  mentorId: Doc<"instructors">["_id"] | undefined;
  mentor: { userId: string; bio: string | undefined; pricing: string | undefined } | null;
  isPublic: boolean;
  endedAt: number | undefined;
  createdAt: number;
  menteeImageCount: number;
  mentorImageCount: number;
};

async function enrichWorkspaces(
  ctx: QueryCtx | MutationCtx,
  workspaces: Doc<"workspaces">[]
): Promise<WorkspaceListItem[]> {
  const ownerIds = [...new Set(workspaces.map((w) => w.ownerId))];
  const mentorIds = [...new Set(workspaces.map((w) => w.mentorId).filter((id): id is Id<"instructors"> => id !== undefined))];

  const ownerDocs = await Promise.all(
    ownerIds.map((id) =>
      ctx.db.query("users").withIndex("by_userId", (q) => q.eq("userId", id)).first()
    )
  );
  const ownersMap = new Map<string, Doc<"users">>();
  ownerIds.forEach((id, i) => {
    if (ownerDocs[i]) ownersMap.set(id, ownerDocs[i]!);
  });

  const mentorDocs = await Promise.all(mentorIds.map((id) => ctx.db.get(id)));
  const mentorsMap = new Map<Id<"instructors">, Doc<"instructors">>();
  mentorIds.forEach((id, i) => {
    if (mentorDocs[i] && !mentorDocs[i]!.deletedAt) mentorsMap.set(id, mentorDocs[i]!);
  });

  return workspaces.map((w) => ({
    id: w._id,
    name: w.name,
    description: w.description,
    type: w.type ?? "mentorship",
    ownerId: w.ownerId,
    owner: w.ownerId && ownersMap.has(w.ownerId)
      ? (() => {
          const o = ownersMap.get(w.ownerId)!;
          return { userId: o.userId, email: o.email, firstName: o.firstName ?? undefined, lastName: o.lastName ?? undefined };
        })()
      : null,
    mentorId: w.mentorId,
    mentor: w.mentorId && mentorsMap.has(w.mentorId)
      ? (() => {
          const m = mentorsMap.get(w.mentorId)!;
          return { userId: m.userId, bio: m.bio ?? undefined, pricing: m.pricing ?? undefined };
        })()
      : null,
    isPublic: w.isPublic,
    endedAt: w.endedAt,
    createdAt: w._creationTime,
    menteeImageCount: w.menteeImageCount,
    mentorImageCount: w.mentorImageCount,
  }));
}

/** List all workspaces with pagination, filtering by type. Returns enriched items with owner and mentor data. Requires admin auth. */
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

    const result = args.type
      ? await ctx.db
          .query("workspaces")
          .withIndex("by_type", (q) => q.eq("type", args.type))
          .order("desc")
          .paginate(args.paginationOpts)
      : await ctx.db
          .query("workspaces")
          .order("desc")
          .paginate(args.paginationOpts);

    const enrichedPage = await enrichWorkspaces(ctx, result.page);

    return {
      page: enrichedPage,
      continueCursor: result.continueCursor,
      isDone: result.isDone,
    };
  },
});

/** Fetch a single workspace by ID with enriched owner and mentor data. Requires admin auth. */
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

    const [enriched] = await enrichWorkspaces(ctx, [workspace]);
    return enriched;
  },
});

/** Create a private admin-mentee workspace for communication with a mentee. Returns existing workspace if one already exists. Requires admin auth. */
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
      .withIndex("by_userId", (q) => q.eq("userId", args.menteeUserId))
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

/** Create a private admin-instructor workspace for communication with an instructor. Returns existing workspace if one already exists. Requires admin auth. */
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

/** Retrieve paginated audit logs for a specific workspace. Requires admin auth. */
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

/** Retrieve all audit logs across all workspaces with pagination. Requires admin auth. */
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
