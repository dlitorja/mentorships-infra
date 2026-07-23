import { query, mutation, internalMutation, internalQuery, action, httpAction, QueryCtx, MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";

async function getAdminUser(ctx: QueryCtx | MutationCtx, identitySubject: string): Promise<Doc<"users"> | null> {
  const byUserId = await ctx.db
    .query("users")
    .withIndex("by_userId", (q) => q.eq("userId", identitySubject))
    .first();
  if (byUserId) return byUserId;

  const byClerkId = await ctx.db
    .query("users")
    .withIndex("by_clerkId", (q) => q.eq("clerkId", identitySubject))
    .first();
  return byClerkId;
}

async function requireAdminUser(ctx: QueryCtx | MutationCtx, identitySubject: string): Promise<Doc<"users">> {
  const user = await getAdminUser(ctx, identitySubject);
  if (!user || user.role !== "admin") {
    throw new Error("Admin access required");
  }
  return user;
}

export const listHdInvitations = query({
  args: {
    status: v.optional(v.union(v.literal("pending"), v.literal("accepted"), v.literal("expired"), v.literal("cancelled"), v.literal("all"))),
    role: v.optional(v.union(v.literal("student"), v.literal("instructor"), v.literal("admin"), v.literal("video_editor"))),
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    await requireAdminUser(ctx, identity.subject);

    const limit = Math.min(args.limit ?? 50, 200);
    const offset = args.offset ?? 0;

    // PR1: indexed reads instead of `collect()` + in-memory filter/sort.
    // Index chosen by which filters are set:
    //   status + role       → by_status_createdAt + post-filter by role
    //   status only         → by_status_createdAt
    //   role only           → by_role_createdAt
    //   no filter           → collect() (rare admin path)
    const filteredStatus = args.status !== undefined && args.status !== "all" ? args.status : undefined;
    const filteredRole = args.role;
    const hasStatus = filteredStatus !== undefined;
    const hasRole = filteredRole !== undefined;

    let rows;
    if (hasStatus && hasRole) {
      rows = await ctx.db
        .query("hdInvitations")
        .withIndex("by_status_createdAt", (q) => q.eq("status", filteredStatus!))
        .order("desc")
        .collect();
      rows = rows.filter((inv) => inv.role === filteredRole);
    } else if (hasStatus) {
      rows = await ctx.db
        .query("hdInvitations")
        .withIndex("by_status_createdAt", (q) => q.eq("status", filteredStatus!))
        .order("desc")
        .collect();
    } else if (hasRole) {
      rows = await ctx.db
        .query("hdInvitations")
        .withIndex("by_role_createdAt", (q) => q.eq("role", filteredRole!))
        .order("desc")
        .collect();
    } else {
      rows = await ctx.db.query("hdInvitations").collect();
      rows.sort((a, b) => b._creationTime - a._creationTime);
    }

    const total = rows.length;
    const paginated = rows.slice(offset, offset + limit);

    return {
      items: paginated.map((inv) => ({
        id: inv._id,
        email: inv.email,
        role: inv.role,
        status: inv.status,
        clerkInvitationId: inv.clerkInvitationId ?? null,
        invitedByUserId: inv.invitedByUserId,
        expiresAt: inv.expiresAt,
        createdAt: inv._creationTime,
      })),
      total,
    };
  },
});

export const getHdInvitation = query({
  args: {
    invitationId: v.id("hdInvitations"),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    await requireAdminUser(ctx, identity.subject);

    const invitation = await ctx.db.get(args.invitationId);
    if (!invitation) return null;

    return {
      id: invitation._id,
      email: invitation.email,
      role: invitation.role,
      status: invitation.status,
      clerkInvitationId: invitation.clerkInvitationId ?? null,
      invitedByUserId: invitation.invitedByUserId,
      expiresAt: invitation.expiresAt,
      createdAt: invitation._creationTime,
    };
  },
});

export const createHdInvitation = mutation({
  args: {
    email: v.string(),
    role: v.union(v.literal("student"), v.literal("instructor"), v.literal("admin"), v.literal("video_editor")),
    expiresInDays: v.optional(v.number()),
    clerkInvitationId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    await requireAdminUser(ctx, identity.subject);

    const emailLower = args.email.toLowerCase().trim();

    const existingPending = await ctx.db
      .query("hdInvitations")
      .withIndex("by_email", (q) => q.eq("email", emailLower))
      .first();

    if (existingPending && existingPending.status === "pending" && existingPending.expiresAt > Date.now()) {
      throw new Error("A pending invitation already exists for this email");
    }

    const expiresInDays = args.expiresInDays ?? 7;
    const expiresAt = Date.now() + expiresInDays * 24 * 60 * 60 * 1000;

    const invitationId = await ctx.db.insert("hdInvitations", {
      email: emailLower,
      role: args.role,
      status: "pending",
      clerkInvitationId: args.clerkInvitationId,
      invitedByUserId: identity.subject,
      expiresAt,
    });

    return invitationId;
  },
});

export const cancelHdInvitation = mutation({
  args: {
    invitationId: v.id("hdInvitations"),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    await requireAdminUser(ctx, identity.subject);

    const invitation = await ctx.db.get(args.invitationId);
    if (!invitation) {
      throw new Error("Invitation not found");
    }

    if (invitation.status !== "pending") {
      throw new Error("Can only cancel pending invitations");
    }

    await ctx.db.patch(args.invitationId, {
      status: "cancelled",
      updatedAt: Date.now(),
    });

    return {
      invitationId: args.invitationId,
      clerkInvitationId: invitation.clerkInvitationId ?? null,
    };
  },
});

export const updateHdInvitationStatus = mutation({
  args: {
    invitationId: v.id("hdInvitations"),
    status: v.union(v.literal("pending"), v.literal("accepted"), v.literal("expired"), v.literal("cancelled")),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    await requireAdminUser(ctx, identity.subject);

    await ctx.db.patch(args.invitationId, {
      status: args.status,
      updatedAt: Date.now(),
    });

    return args.invitationId;
  },
});

export const updateHdInvitationClerkId = mutation({
  args: {
    invitationId: v.id("hdInvitations"),
    clerkInvitationId: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    await requireAdminUser(ctx, identity.subject);

    await ctx.db.patch(args.invitationId, {
      clerkInvitationId: args.clerkInvitationId,
      updatedAt: Date.now(),
    });

    return args.invitationId;
  },
});

export const resendHdInvitation = mutation({
  args: {
    invitationId: v.id("hdInvitations"),
    clerkInvitationId: v.string(),
    expiresInDays: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    await requireAdminUser(ctx, identity.subject);

    const invitation = await ctx.db.get(args.invitationId);
    if (!invitation) {
      throw new Error("Invitation not found");
    }

    if (invitation.status !== "pending") {
      throw new Error("Can only resend pending invitations");
    }

    const previousClerkInvitationId = invitation.clerkInvitationId ?? null;
    const expiresInDays = args.expiresInDays ?? 7;
    const expiresAt = Date.now() + expiresInDays * 24 * 60 * 60 * 1000;

    await ctx.db.patch(args.invitationId, {
      clerkInvitationId: args.clerkInvitationId,
      expiresAt,
      updatedAt: Date.now(),
    });

    return { invitationId: args.invitationId, newExpiresAt: expiresAt, previousClerkInvitationId };
  },
});

export const getHdInvitationStats = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    await requireAdminUser(ctx, identity.subject);

    const invitations = await ctx.db.query("hdInvitations").collect();

    return {
      total: invitations.length,
      pending: invitations.filter((i) => i.status === "pending").length,
      accepted: invitations.filter((i) => i.status === "accepted").length,
      expired: invitations.filter((i) => i.status === "expired").length,
      cancelled: invitations.filter((i) => i.status === "cancelled").length,
    };
  },
});

export const getPendingInvitationsByEmail = query({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    const currentUser = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
      .first();

    if (!currentUser || currentUser.role !== "admin") {
      throw new Error("Admin access required");
    }

    const invitations = await ctx.db
      .query("hdInvitations")
      .withIndex("by_email", (q) => q.eq("email", args.email.toLowerCase()))
      .collect();

    return invitations
      .filter((inv) => inv.status === "pending" && inv.clerkInvitationId)
      .map((inv) => ({
        id: inv._id,
        clerkInvitationId: inv.clerkInvitationId,
        role: inv.role,
        expiresAt: inv.expiresAt,
      }));
  },
});

export const deleteHdInvitation = mutation({
  args: {
    invitationId: v.id("hdInvitations"),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    await requireAdminUser(ctx, identity.subject);

    const invitation = await ctx.db.get(args.invitationId);
    if (!invitation) {
      throw new Error("Invitation not found");
    }

    await ctx.db.delete(args.invitationId);

    return { success: true };
  },
});

export const acceptHdInvitationFromClerk = action({
  args: {
    email: v.string(),
    clerkUserId: v.string(),
    webhookSecret: v.string(),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const expectedSecret = process.env.CONVEX_WEBHOOK_SECRET;
    if (!expectedSecret || args.webhookSecret !== expectedSecret) {
      return { success: false, reason: "unauthorized" };
    }

    const emailLower = args.email.toLowerCase().trim();

    const invitation = await ctx.runQuery(internal.hdInvitations.getPendingInvitationByEmailInternal, {
      email: emailLower,
    });

    if (!invitation) {
      return { success: false, reason: "no_pending_invitation" };
    }

    await ctx.runMutation(internal.hdInvitations.markInvitationAccepted, {
      invitationId: invitation._id,
      clerkUserId: args.clerkUserId,
    });

    return { success: true };
  },
});

export const getPendingInvitationByEmailInternal = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const invitations = await ctx.db
      .query("hdInvitations")
      .withIndex("by_email", (q) => q.eq("email", args.email.toLowerCase()))
      .collect();

    const now = Date.now();
    const validInvitation = invitations
      .filter((inv) => inv.status === "pending" && inv.expiresAt > now)
      .sort((a, b) => b.expiresAt - a.expiresAt)[0];

    return validInvitation ?? null;
  },
});

export const markInvitationAccepted = internalMutation({
  args: {
    invitationId: v.id("hdInvitations"),
    clerkUserId: v.string(),
  },
  handler: async (ctx, args) => {
    const invitation = await ctx.db.get(args.invitationId);
    if (!invitation) {
      throw new Error("Invitation not found");
    }

    await ctx.db.patch(args.invitationId, {
      status: "accepted",
      clerkInvitationId: args.clerkUserId,
      updatedAt: Date.now(),
    });

    const existingUser = await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", args.clerkUserId))
      .first();

    if (!existingUser) {
      await ctx.db.insert("users", {
        userId: args.clerkUserId,
        email: invitation.email,
        clerkId: args.clerkUserId,
        role: invitation.role,
        firstName: undefined,
        lastName: undefined,
      });

      if (invitation.role === "instructor") {
        await ctx.runMutation(internal.instructors.createInstructorInternal, {
          userId: args.clerkUserId,
          name: invitation.email,
          email: invitation.email,
          isActive: true,
          isNew: true,
        });
      }
    }
  },
});