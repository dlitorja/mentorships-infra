import { query, mutation, internalQuery, internalMutation, action } from "./_generated/server";
import { internal } from "./_generated/api";
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

export const getUsersByClerkIds = query({
  args: { userIds: v.array(v.string()) },
  handler: async (ctx, args) => {
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

/**
 * Sets a user's role, verified by a server-provided HMAC signature.
 *
 * Usage: Intended to be called only from trusted server code (e.g., Next.js API routes)
 * after performing external authorization (Clerk, etc.). The server generates an HMAC
 * over `${userId}:${role}:${ts}` using the shared secret in both environments.
 *
 * Security:
 * - Requires a valid HMAC signature derived from `process.env.CONVEX_SERVER_SHARED_SECRET`.
 * - Rejects requests older than 5 minutes to reduce replay risk.
 * - Allows elevating to admin only via valid signature.
 */
// serverVerifiedSetUserRole moved to users_actions.ts (Node action)

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

// Internal-only mutation to set a user's role. Intended to be called from
// server-verified actions that have already authenticated the request.
export const setUserRoleTrusted = internalMutation({
  args: {
    userId: v.string(),
    role: v.union(v.literal("student"), v.literal("instructor"), v.literal("admin"), v.literal("video_editor")),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, { role: args.role, userId: args.userId });
      return await ctx.db.get(existing._id);
    }

    const identity = await ctx.auth.getUserIdentity();
    const email = identity?.email;
    const id = await ctx.db.insert("users", {
      userId: args.userId,
      email: email ?? undefined,
      clerkId: args.userId,
      role: args.role,
    } as Partial<Doc<"users">> as any);
    const inserted = await ctx.db.get(id);
    if (!inserted) throw new Error("Failed to set role");
    return inserted;
  },
});

export const createUserFromClerk = internalMutation({
  args: {
    userId: v.string(),
    email: v.string(),
    clerkId: v.string(),
    role: v.union(v.literal("student"), v.literal("instructor"), v.literal("admin"), v.literal("video_editor")),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existingByUserId = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();

    if (existingByUserId) {
      await ctx.db.patch(existingByUserId._id, {
        email: args.email,
        clerkId: args.clerkId,
        role: args.role,
        firstName: args.firstName ?? existingByUserId.firstName,
        lastName: args.lastName ?? existingByUserId.lastName,
      });
      return await ctx.db.get(existingByUserId._id);
    }

    const id = await ctx.db.insert("users", {
      userId: args.userId,
      email: args.email,
      clerkId: args.clerkId,
      role: args.role,
      firstName: args.firstName,
      lastName: args.lastName,
    });

    const inserted = await ctx.db.get(id);
    if (!inserted) throw new Error("Failed to create user");
    return inserted;
  },
});

export const getAllUsersForMigration = query({
  handler: async (ctx) => {
    return await ctx.db.query("users").collect();
  },
});

// Sets clerkId field only - preserves userId for apps/platform
export const setUserClerkId = internalMutation({
  args: {
    userId: v.string(),
    clerkId: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();
    
    if (!user) {
      throw new Error(`User with userId ${args.userId} not found`);
    }
    
    await ctx.db.patch(user._id, {
      clerkId: args.clerkId,
    });
    
    return await ctx.db.get(user._id);
  },
});

export const getUserByClerkId = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    // First try userId (primary Clerk ID from apps/platform)
    const byUserId = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();
    if (byUserId) return byUserId;

    // Fall back to clerkId (secondary Clerk ID from apps like huckleberry-drive)
    const byClerkId = await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", args.userId))
      .first();
    return byClerkId;
  },
});

export const getUserByClerkIdPublic = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const authUser = await ctx.auth.getUserIdentity();
    if (!authUser) {
      return null;
    }
    return await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();
  },
});

export const getUserByClerkIdServer = action({
  args: { userId: v.string() },
  handler: async (ctx, args): Promise<any> => {
    return await ctx.runQuery(internal.users.getUserByClerkId as any, {
      userId: args.userId,
    });
  },
});

export const getAllInstructors = query({
  args: {},
  handler: async (ctx) => {
    const allUsers = await ctx.db.query("users").collect();
    return allUsers
      .filter((u) => u.role === "instructor")
      .map((u) => ({
        userId: u.userId,
        name: [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email || "",
        email: u.email ?? "",
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const getAdminStats = query({
  args: {},
  handler: async (ctx) => {
    const allUsers = await ctx.db.query("users").collect();
    const allUploads = await ctx.db.query("instructorUploads").collect();

    const instructors = allUsers.filter((u) => u.role === "instructor");

    let totalFiles = 0;
    let totalBytes = 0;
    let deletedFiles = 0;
    let deletedBytes = 0;

    for (const upload of allUploads) {
      totalFiles++;
      totalBytes += upload.size;
      if (upload.status === "deleted" || upload.status === "deleting") {
        deletedFiles++;
        deletedBytes += upload.size;
      }
    }

    const activeBytes = totalBytes - deletedBytes;

    return {
      totalInstructors: instructors.length,
      totalFiles,
      totalBytes,
      activeFiles: totalFiles - deletedFiles,
      activeBytes,
    };
  },
});

export const listActiveUsers = query({
  args: {},
  handler: async (ctx) => {
const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    const currentUser = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
      .first();

    if (!currentUser || currentUser.role !== "admin") {
      throw new Error("Admin access required");
    }

    const allUsers = await ctx.db.query("users").collect();

    return allUsers
      .filter((u) => !u.deletedAt && !u.hardDeletedAt)
      .map((u) => ({
        _id: u._id,
        userId: u.userId,
        email: u.email,
        firstName: u.firstName,
        lastName: u.lastName,
        role: u.role,
        timeZone: u.timeZone,
        clerkId: u.clerkId,
        createdAt: u._creationTime,
      }))
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  },
});

export const listDeletedUsers = query({
  args: {},
  handler: async (ctx) => {
const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    const currentUser = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
      .first();

    if (!currentUser || currentUser.role !== "admin") {
      throw new Error("Admin access required");
    }

    const allUsers = await ctx.db.query("users").collect();

    return allUsers
      .filter((u) => u.deletedAt && !u.hardDeletedAt)
      .map((u) => ({
        _id: u._id,
        userId: u.userId,
        email: u.email,
        firstName: u.firstName,
        lastName: u.lastName,
        role: u.role,
        deletedAt: u.deletedAt,
        deletedBy: u.deletedBy,
        clerkId: u.clerkId,
        createdAt: u._creationTime,
      }))
      .sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0));
  },
});

export const getUserWithFiles = query({
  args: { userId: v.string() },
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

    const user = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();

    if (!user) return null;

    const userUploads = await ctx.db
      .query("instructorUploads")
      .withIndex("by_instructorId", (q) => q.eq("instructorId", args.userId))
      .collect();

    let totalFiles = 0;
    let totalBytes = 0;
    let activeFiles = 0;
    let activeBytes = 0;

    for (const upload of userUploads) {
      totalFiles++;
      totalBytes += upload.size;
      if (upload.status !== "deleted" && upload.status !== "deleting") {
        activeFiles++;
        activeBytes += upload.size;
      }
    }

    return {
      user: {
        _id: user._id,
        userId: user.userId,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        deletedAt: user.deletedAt,
        hardDeletedAt: user.hardDeletedAt,
        clerkId: user.clerkId,
        createdAt: user._creationTime,
      },
      files: {
        total: totalFiles,
        active: activeFiles,
        totalBytes,
        activeBytes,
      },
    };
  },
});

export const updateUserRole = mutation({
  args: {
    userId: v.string(),
    role: v.union(v.literal("student"), v.literal("instructor"), v.literal("admin"), v.literal("video_editor")),
  },
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

    if (args.userId === identity.subject) {
      throw new Error("Cannot change your own role");
    }

    const targetUser = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();

    if (!targetUser) {
      throw new Error("User not found");
    }

    if (targetUser.hardDeletedAt) {
      throw new Error("Cannot update role of hard-deleted user");
    }

    await ctx.db.patch(targetUser._id, {
      role: args.role,
    });

    return await ctx.db.get(targetUser._id);
  },
});

export const softDeleteUser = mutation({
  args: { userId: v.string() },
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

    if (args.userId === identity.subject) {
      throw new Error("Cannot delete your own account");
    }

    const targetUser = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();

    if (!targetUser) {
      throw new Error("User not found");
    }

    if (targetUser.deletedAt && !targetUser.hardDeletedAt) {
      throw new Error("User is already soft-deleted");
    }

    if (targetUser.hardDeletedAt) {
      throw new Error("Cannot soft-delete a hard-deleted user");
    }

    await ctx.db.patch(targetUser._id, {
      deletedAt: Date.now(),
      deletedBy: identity.subject,
    });

    const pendingInvitations = await ctx.db
      .query("hdInvitations")
      .withIndex("by_email", (q) => q.eq("email", targetUser.email.toLowerCase()))
      .collect();

    for (const inv of pendingInvitations) {
      if (inv.status === "pending") {
        await ctx.db.patch(inv._id, {
          status: "cancelled",
          updatedAt: Date.now(),
        });
      }
    }

    return { success: true, userId: args.userId };
  },
});

export const hardDeleteUser = mutation({
  args: { userId: v.string() },
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

    if (args.userId === identity.subject) {
      throw new Error("Cannot delete your own account");
    }

    const targetUser = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();

    if (!targetUser) {
      throw new Error("User not found");
    }

    if (!targetUser.deletedAt) {
      throw new Error("Must soft-delete user before hard delete");
    }

    if (targetUser.hardDeletedAt) {
      throw new Error("User is already hard-deleted");
    }

    await ctx.db.patch(targetUser._id, {
      hardDeletedAt: Date.now(),
    });

    const pendingInvitations = await ctx.db
      .query("hdInvitations")
      .withIndex("by_email", (q) => q.eq("email", targetUser.email.toLowerCase()))
      .collect();

    for (const inv of pendingInvitations) {
      if (inv.status === "pending") {
        await ctx.db.patch(inv._id, {
          status: "cancelled",
          updatedAt: Date.now(),
        });
      }
    }

    const userUploads = await ctx.db
      .query("instructorUploads")
      .withIndex("by_instructorId", (q) => q.eq("instructorId", args.userId))
      .collect();

    const filesToDelete = userUploads.filter(
      (u) => u.status !== "deleted" && u.status !== "deleting"
    );

    for (const upload of filesToDelete) {
      await ctx.scheduler.runAfter(0, internal.instructorUploads.deleteUploadFromStorage, {
        uploadId: upload.legacyId ?? upload._id,
        filename: upload.filename ?? undefined,
        s3Key: upload.s3Key ?? undefined,
        b2FileId: upload.b2FileId ?? undefined,
      });
    }

    return {
      success: true,
      userId: args.userId,
      filesQueued: filesToDelete.length,
    };
  },
});

export const restoreUser = mutation({
  args: { userId: v.string() },
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

    const targetUser = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();

    if (!targetUser) {
      throw new Error("User not found");
    }

    if (!targetUser.deletedAt) {
      throw new Error("User is not deleted");
    }

    if (targetUser.hardDeletedAt) {
      throw new Error("Cannot restore a hard-deleted user");
    }

    await ctx.db.patch(targetUser._id, {
      deletedAt: undefined,
      deletedBy: undefined,
    });

    return { success: true, userId: args.userId };
  },
});
