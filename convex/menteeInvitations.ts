import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const listMenteeInvitations = query({
  args: {
    status: v.optional(v.union(v.literal("pending"), v.literal("accepted"), v.literal("expired"), v.literal("cancelled"), v.literal("all"))),
    instructorId: v.optional(v.id("instructors")),
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { items: [], total: 0 };

    let invitationsQuery = ctx.db.query("menteeInvitations");

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

export const createMenteeInvitation = mutation({
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
      .query("menteeInvitations")
      .withIndex("by_email_instructorId", (q) => 
        q.eq("email", args.email.toLowerCase()).eq("instructorId", args.instructorId)
      )
      .first();

    if (existingPending && existingPending.status === "pending" && existingPending.expiresAt > Date.now()) {
      throw new Error("A pending invitation already exists for this email and instructor");
    }

    const invitationId = await ctx.db.insert("menteeInvitations", {
      email: args.email.toLowerCase(),
      instructorId: args.instructorId,
      clerkInvitationId: args.clerkInvitationId ?? undefined,
      expiresAt: args.expiresAt,
      status: args.status ?? "pending",
    });

    return invitationId;
  },
});

export const updateMenteeInvitationStatus = mutation({
  args: {
    id: v.id("menteeInvitations"),
    status: v.union(v.literal("pending"), v.literal("accepted"), v.literal("expired"), v.literal("cancelled")),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    await ctx.db.patch(args.id, { status: args.status });
    return args.id;
  },
});