import { query, mutation } from "./_generated/server";
import { internalMutation } from "./_generated/server";
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
  action: "view_workspace" | "send_message" | "create_workspace" | "create_admin_student_workspace" | "create_admin_instructor_workspace",
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
  owner: { userId: string | undefined; email: string | undefined; firstName: string | undefined; lastName: string | undefined } | null;
  instructorId: Doc<"instructors">["_id"] | undefined;
  instructor: { userId: string | undefined; bio: string | undefined; pricing: string | undefined } | null;
  isPublic: boolean;
  endedAt: number | undefined;
  createdAt: number;
  studentImageCount: number;
  instructorImageCount: number;
};

async function enrichWorkspaces(
  ctx: QueryCtx | MutationCtx,
  workspaces: Doc<"workspaces">[]
): Promise<WorkspaceListItem[]> {
  const ownerIds = [...new Set(workspaces.map((w) => w.ownerId))];
  const instructorIds = [...new Set(workspaces.map((w) => w.instructorId).filter((id): id is Id<"instructors"> => id !== undefined))];

  const ownerDocs = await Promise.all(
    ownerIds.map((id) =>
      ctx.db.query("users").withIndex("by_userId", (q) => q.eq("userId", id)).first()
    )
  );
  const ownersMap = new Map<string, Doc<"users">>();
  ownerIds.forEach((id, i) => {
    if (ownerDocs[i]) ownersMap.set(id, ownerDocs[i]!);
  });

  const instructorDocs = await Promise.all(instructorIds.map((id) => ctx.db.get(id)));
  const instructorsMap = new Map<Id<"instructors">, Doc<"instructors">>();
  instructorIds.forEach((id, i) => {
    if (instructorDocs[i] && !instructorDocs[i]!.deletedAt) instructorsMap.set(id, instructorDocs[i]!);
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
    instructorId: w.instructorId,
    instructor: w.instructorId && instructorsMap.has(w.instructorId)
      ? (() => {
          const m = instructorsMap.get(w.instructorId)!;
          return { userId: m.userId, bio: m.bio ?? undefined, pricing: m.pricing ?? undefined };
        })()
      : null,
    isPublic: w.isPublic,
    endedAt: w.endedAt,
    createdAt: w._creationTime,
    studentImageCount: w.studentImageCount,
    instructorImageCount: w.instructorImageCount,
  }));
}

/** List all workspaces with pagination, filtering by type. Returns enriched items with owner and instructor data. Requires admin auth. */
export const getAllWorkspaces = query({
  args: {
    paginationOpts: v.any(),
    type: v.optional(v.union(v.literal("mentorship"), v.literal("admin_student"), v.literal("admin_instructor"))),
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

/** Fetch a single workspace by ID with enriched owner and instructor data. Requires admin auth. */
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

/** Create a private admin-student workspace for communication with a student. Returns existing workspace if one already exists. Requires admin auth. */
export const createAdminStudentWorkspace = mutation({
  args: {
    studentUserId: v.string(),
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
          q.eq(q.field("ownerId"), args.studentUserId),
          q.eq(q.field("type"), "admin_student")
        )
      )
      .first();

    if (existingWorkspace) {
      await logWorkspaceAudit(ctx, existingWorkspace._id, user.subject, "create_admin_student_workspace", "Returned existing workspace");
      return existingWorkspace;
    }

    const student = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", args.studentUserId))
      .first();

    const workspaceId = await ctx.db.insert("workspaces", {
      name: `Admin Communication - ${student?.firstName || student?.email || "User"}`,
      description: "Private workspace for admin-student communication",
      ownerId: args.studentUserId,
      isPublic: false,
      studentImageCount: 0,
      instructorImageCount: 0,
      type: "admin_student",
    });

    await logWorkspaceAudit(ctx, workspaceId, user.subject, "create_admin_student_workspace");

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
          q.eq(q.field("instructorId"), args.instructorId),
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
      instructorId: args.instructorId,
      isPublic: false,
      studentImageCount: 0,
      instructorImageCount: 0,
      type: "admin_instructor",
    });

    await logWorkspaceAudit(ctx, workspaceId, user.subject, "create_admin_instructor_workspace");

    return await ctx.db.get(workspaceId);
  },
});

/** Internal-only: Ensure an admin-student workspace exists for a given student user. No auth check; protect via HTTP key. */
export const ensureAdminStudentWorkspace = internalMutation({
  args: {
    studentUserId: v.string(),
  },
  handler: async (ctx, args) => {
    const existingWorkspace = await ctx.db
      .query("workspaces")
      .filter((q) =>
        q.and(
          q.eq(q.field("ownerId"), args.studentUserId),
          q.eq(q.field("type"), "admin_student"),
        )
      )
      .first();

    if (existingWorkspace) {
      return { id: existingWorkspace._id, created: false };
    }

    const student = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", args.studentUserId))
      .first();

    const name = `Admin Communication - ${student?.firstName || student?.email || "User"}`;
    const wsId = await ctx.db.insert("workspaces", {
      name,
      description: "Private workspace for admin-student communication",
      ownerId: args.studentUserId,
      isPublic: false,
      studentImageCount: 0,
      instructorImageCount: 0,
      type: "admin_student",
    });

    // Record audit log with a system actor to preserve traceability
    await logWorkspaceAudit(ctx as any, wsId as any, "system", "create_admin_student_workspace", "Auto-created post-payment");

    return { id: wsId, created: true };
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
