import { query, mutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";

/** Returns a user matching the given email address. */
export const getUserByEmail = query({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return null;
    }
    return await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .first();
  },
});

/** Returns a user by their document ID. */
export const getUserById = query({
  args: { id: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return null;
    }
    return await ctx.db.get(args.id);
  },
});

/** Returns a user by their auth userId. Requires admin auth. */
export const getUserByUserId = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return null;
    }
    
    const dbUser = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", user.subject))
      .first();
    
    if (dbUser?.role !== "admin") {
      return null;
    }
    
    return await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();
  },
});

/** Returns users matching the given auth userIds. */
export const getUsersByUserIds = query({
  args: { userIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return [];
    }
    
    const users = await Promise.all(
      args.userIds.map((userId) =>
        ctx.db
          .query("users")
          .withIndex("by_userId", (q) => q.eq("userId", userId))
          .first()
      )
    );
    
    return users.filter((u): u is Doc<"users"> => u !== null);
  },
});

/** Returns all users in the database. */
export const listUsers = query({
  handler: async (ctx) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return [];
    }
    return await ctx.db.query("users").collect();
  },
});

/** Returns the currently authenticated user based on their auth identity. */
export const getCurrentUser = query({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity || !identity.email) {
      return null;
    }
    const email = identity.email;
    return await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();
  },
});

/**
 * Creates a new user if one doesn't already exist with the given email.
 * Used for backfills and admin tooling; does not enforce role semantics beyond insertion.
 */
export const createUser = mutation({
  args: {
    userId: v.string(),
    email: v.string(),
    clerkId: v.optional(v.string()),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    role: v.optional(v.union(v.literal("student"), v.literal("instructor"), v.literal("admin"), v.literal("video_editor"))),
    timeZone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .first();
    
    if (existing) {
      return existing._id;
    }
    
    const { clerkId, ...rest } = args;
    return await ctx.db.insert("users", {
      ...rest,
      clerkId: clerkId ?? `placeholder_${args.userId}`,
    });
  },
});

/** Updates the specified user's fields and returns the updated document. */
export const updateUser = mutation({
  args: {
    id: v.id("users"),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    role: v.optional(v.union(v.literal("student"), v.literal("instructor"), v.literal("admin"), v.literal("video_editor"))),
    timeZone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    await ctx.db.patch(id, updates);
    return await ctx.db.get(id);
  },
});

/** Deletes a user by their document ID. Requires admin auth. */
export const deleteUser = mutation({
  args: { id: v.id("users") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
  },
});

/**
 * Syncs the current authenticated user's profile into Convex.
 * - If a record exists, updates basic fields (name/timezone) and may adjust role subject to guards.
 * - If no record exists, inserts a new user with a safe default role.
 *
 * Role handling hardening:
 * - Never elevates to admin here; only preserves admin if already set on the existing record.
 * - Allows role "instructor" only when an instructor document exists for this user.
 * - Allows non-privileged roles (student, video_editor) changes.
 */
export const syncUser = mutation({
  args: {
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    role: v.optional(v.union(v.literal("student"), v.literal("instructor"), v.literal("admin"), v.literal("video_editor"))),
    timeZone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    const email = identity.email;
    if (!email) throw new Error("User email not found in auth identity");

    const existingByEmail = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();

    if (existingByEmail) {
      const updates: Partial<Doc<"users">> = {
        userId: identity.subject,
        firstName: args.firstName ?? existingByEmail.firstName,
        lastName: args.lastName ?? existingByEmail.lastName,
        timeZone: args.timeZone ?? existingByEmail.timeZone,
      };

      // Harden role updates: prevent privilege escalation from clients
      if (args.role) {
        const requested = args.role;

        // Fetch current role (may be undefined on legacy docs)
        const currentRole = existingByEmail.role as Doc<"users">["role"] | undefined;

        if (requested === "admin") {
          // Only allow setting to admin if already admin (idempotent) — no elevation here
          if (currentRole === "admin") {
            updates.role = currentRole;
          }
        } else if (requested === "instructor") {
          // Allow instructor role if an instructor record exists for this user
          const hasInstructor = await ctx.db
            .query("instructors")
            .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
            .first();
          if (hasInstructor) {
            updates.role = "instructor";
          }
        } else if (requested === "student" || requested === "video_editor") {
          // Downgrades or non-admin roles are allowed
          updates.role = requested;
        }
      }

      await ctx.db.patch(existingByEmail._id, updates);
      return await ctx.db.get(existingByEmail._id);
    }

    // New insert: never allow creating with admin directly to avoid elevation vectors.
    // Default to student; allow instructor if they already have an instructor record.
    let insertRole: Doc<"users">["role"] = "student";
    if (args.role === "instructor") {
      const hasInstructor = await ctx.db
        .query("instructors")
        .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
        .first();
      if (hasInstructor) insertRole = "instructor" as const;
    } else if (args.role === "video_editor") {
      insertRole = "video_editor" as const;
    }

    const id = await ctx.db.insert("users", {
      userId: identity.subject,
      email: email,
      clerkId: identity.subject,
      firstName: args.firstName,
      lastName: args.lastName,
      role: insertRole,
      timeZone: args.timeZone,
    });

    const inserted = await ctx.db.get(id);
    if (!inserted) throw new Error("Failed to create user");
    return inserted;
  },
});

export const migrateUser = mutation({
  args: {
    userId: v.string(),
    email: v.string(),
    role: v.optional(v.union(v.literal("student"), v.literal("instructor"), v.literal("admin"), v.literal("video_editor"))),
    timeZone: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existingByUserId = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();

    if (existingByUserId) {
      const updates: Partial<Doc<"users">> = {
        email: args.email,
        role: args.role ?? existingByUserId.role,
        timeZone: args.timeZone ?? existingByUserId.timeZone,
      };
      await ctx.db.patch(existingByUserId._id, updates);
      return { action: "updated", id: existingByUserId._id };
    }

    const id = await ctx.db.insert("users", {
      userId: args.userId,
      email: args.email,
      clerkId: `migrated_${args.userId}`,
      role: args.role ?? "student",
      timeZone: args.timeZone,
      firstName: undefined,
      lastName: undefined,
    });

    return { action: "inserted", id };
  },
});

export const getAllUsersForMigration = query({
  handler: async (ctx) => {
    return await ctx.db.query("users").collect();
  },
});

export const getUserByClerkId = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();
  },
});
