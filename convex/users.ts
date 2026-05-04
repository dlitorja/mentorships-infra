import { query, mutation } from "./_generated/server";
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

/** Creates a new user if one doesn't already exist with the given email. */
export const createUser = mutation({
  args: {
    userId: v.string(),
    email: v.string(),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    role: v.optional(v.union(v.literal("student"), v.literal("mentor"), v.literal("admin"), v.literal("video_editor"))),
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
    
    return await ctx.db.insert("users", args);
  },
});

/** Updates the specified user's fields and returns the updated document. */
export const updateUser = mutation({
  args: {
    id: v.id("users"),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    role: v.optional(v.union(v.literal("student"), v.literal("mentor"), v.literal("admin"), v.literal("video_editor"))),
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

export const syncUser = mutation({
  args: {
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    role: v.optional(v.union(v.literal("student"), v.literal("mentor"), v.literal("admin"), v.literal("video_editor"))),
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
      if (args.role) {
        updates.role = args.role;
      }
      await ctx.db.patch(existingByEmail._id, updates);
      return await ctx.db.get(existingByEmail._id);
    }

    const id = await ctx.db.insert("users", {
      userId: identity.subject,
      email: email,
      firstName: args.firstName,
      lastName: args.lastName,
      role: args.role ?? "student",
      timeZone: args.timeZone,
    });

    const inserted = await ctx.db.get(id);
    if (!inserted) throw new Error("Failed to create user");
    return inserted;
  },
});
