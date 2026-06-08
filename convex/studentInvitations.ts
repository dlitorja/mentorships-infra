import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * Lists student invitations with optional filtering by status, instructor, and pagination.
 * Returns items with instructor details attached.
 */
export const listStudentInvitations = query({
  args: {
    status: v.optional(v.union(v.literal("pending"), v.literal("accepted"), v.literal("expired"), v.literal("cancelled"), v.literal("all"))),
    instructorId: v.optional(v.id("instructors")),
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { items: [], total: 0 };

    let invitationsQuery = ctx.db.query("studentInvitations");

    let invitations = await invitationsQuery.collect();

    if (args.status && args.status !== "all") {
      invitations = invitations.filter(inv => inv.status === args.status);
    }

    if (args.instructorId) {
      invitations = invitations.filter(inv => inv.instructorId === args.instructorId);
    }

    const total = invitations.length;

    invitations = invitations.sort((a, b) => b._creationTime - a._creationTime);

    const offset = args.offset ?? 0;
    const limit = args.limit ?? 20;
    invitations = invitations.slice(offset, offset + limit);

    const results = await Promise.all(
      invitations.map(async (inv) => {
        const instructor = await ctx.db.get(inv.instructorId);
        return {
          id: inv._id,
          email: inv.email,
          instructorId: inv.instructorId,
          instructorName: instructor?.name ?? null,
          instructorSlug: instructor?.slug ?? null,
          clerkInvitationId: inv.clerkInvitationId ?? null,
          expiresAt: inv.expiresAt,
          status: inv.status,
          createdAt: inv._creationTime,
        };
      })
    );

    return { items: results, total };
  },
});

/**
 * Creates a new student invitation for an instructor.
 * Prevents duplicate pending invitations for the same email and instructor combination.
 */
export const createStudentInvitation = mutation({
  args: {
    email: v.string(),
    instructorId: v.id("instructors"),
    clerkInvitationId: v.optional(v.string()),
    expiresAt: v.number(),
    status: v.optional(v.union(v.literal("pending"), v.literal("accepted"), v.literal("expired"), v.literal("cancelled"))),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    const existingPending = await ctx.db
      .query("studentInvitations")
      .withIndex("by_email_instructorId", (q) => 
        q.eq("email", args.email.toLowerCase()).eq("instructorId", args.instructorId)
      )
      .first();

    if (existingPending && existingPending.status === "pending" && existingPending.expiresAt > Date.now()) {
      throw new Error("A pending invitation already exists for this email and instructor");
    }

    const invitationId = await ctx.db.insert("studentInvitations", {
      email: args.email.toLowerCase(),
      instructorId: args.instructorId,
      clerkInvitationId: args.clerkInvitationId ?? undefined,
      expiresAt: args.expiresAt,
      status: args.status ?? "pending",
    });

    return invitationId;
  },
});

/**
 * Updates the status of a student invitation (pending, accepted, expired, cancelled).
 * Requires admin authentication.
 */
export const updateStudentInvitationStatus = mutation({
  args: {
    id: v.id("studentInvitations"),
    status: v.union(v.literal("pending"), v.literal("accepted"), v.literal("expired"), v.literal("cancelled")),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    await ctx.db.patch(args.id, { status: args.status });
    return args.id;
  },
});

/**
 * Migrates a student invitation from legacy system.
 * Updates existing invitation if found by email and instructor, otherwise creates new.
 */
export const migrateInvitation = mutation({
  args: {
    id: v.string(),
    email: v.string(),
    instructorId: v.id("instructors"),
    clerkInvitationId: v.optional(v.string()),
    expiresAt: v.number(),
    status: v.optional(v.union(v.literal("pending"), v.literal("accepted"), v.literal("expired"), v.literal("cancelled"))),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const normalizedEmail = args.email.toLowerCase();

    const existingByEmailInstructor = await ctx.db
      .query("studentInvitations")
      .withIndex("by_email_instructorId", (q) =>
        q.eq("email", normalizedEmail).eq("instructorId", args.instructorId)
      )
      .first();

    if (existingByEmailInstructor) {
      const updates: Record<string, unknown> = {};
      if (args.status) updates.status = args.status;
      if (args.clerkInvitationId) updates.clerkInvitationId = args.clerkInvitationId;
      if (args.expiresAt) updates.expiresAt = args.expiresAt;

      if (Object.keys(updates).length > 0) {
        await ctx.db.patch(existingByEmailInstructor._id, updates);
      }
      return { action: "updated", id: existingByEmailInstructor._id };
    }

    const insertResult = await ctx.db.insert("studentInvitations", {
      email: normalizedEmail,
      instructorId: args.instructorId,
      clerkInvitationId: args.clerkInvitationId ?? undefined,
      expiresAt: args.expiresAt,
      status: args.status ?? "pending",
    });

    return { action: "inserted", id: insertResult };
  },
});
