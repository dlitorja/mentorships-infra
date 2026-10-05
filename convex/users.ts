import { query, mutation, internalQuery, internalMutation, action } from "./_generated/server";
import { internal } from "./_generated/api";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { writeAuditLog } from "./auditLog";

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

/** Returns all users in the database, paginated. */
export const listUsers = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return { page: [], isDone: true, continueCursor: "" };
    }
    return await ctx.db.query("users").paginate(args.paginationOpts);
  },
});

/** Returns all users with the given role. */
export const getUsersByRole = query({
  args: { role: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return [];
    }
    return await ctx.db
      .query("users")
      .withIndex("by_role", (q) =>
        q.eq("role", args.role as Doc<"users">["role"])
      )
      .collect();
  },
});

/**
 * Same as `getUsersByRole` but excludes soft-deleted users (`deletedAt` set)
 * AND users without a matching instructors profile row. Used by open-access
 * video editor flows where the dropdown lists every invited instructor —
 * soft-deleted accounts and accounts without a profile row must not be
 * selectable, because createUpload requires a profile to be present
 * (unless the caller is uploading to their own storage).
 */
export const getActiveUsersByRole = query({
  args: { role: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return [];
    }
    const all = await ctx.db
      .query("users")
      .withIndex("by_role", (q) =>
        q.eq("role", args.role as Doc<"users">["role"])
      )
      .collect();
    const active = all.filter((u) => u.deletedAt === undefined);

    // For the instructor role, additionally require an instructors profile
    // row. createUpload rejects editor uploads to a user without a profile.
    // Use the by_userId index for each lookup instead of a full-table
    // collect, so the read budget scales with the number of active
    // instructors (typically <100) rather than the entire instructors
    // table (which can grow as soft-deleted profiles accumulate).
    if (args.role !== "instructor") {
      return active;
    }
    // Round-21 Greptile P2 #3: also exclude profiles whose own
    // deletedAt is set. Profile deletion is independent from user
    // deletion: an admin may decommission the instructor profile
    // while leaving the users row intact with role='instructor'.
    // createUpload also rejects uploads to such profiles, so the
    // dropdown / switcher must not surface them.
    const withProfile = await Promise.all(
      active.map(async (u) => {
        const profile = await ctx.db
          .query("instructors")
          .withIndex("by_userId", (q) => q.eq("userId", u.userId))
          .first();
        if (!profile) return null;
        if (profile.deletedAt !== undefined) return null;
        return u;
      })
    );
    return withProfile.filter((u): u is NonNullable<typeof u> => u !== null);
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
    // Greptile P1 #14 (PR #905): the calendar (and other UI) calls
    // getCurrentUser. `syncUser` now writes the email lowercased;
    // if we look up the raw Clerk email, a mixed-case new user
    // would silently miss their row. Normalize first, then fall
    // back to the raw form for legacy rows written before
    // normalization.
    const normalizedEmail = email.trim().toLowerCase();
    let user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", normalizedEmail))
      .first();
    if (!user && normalizedEmail !== email) {
      user = await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", email))
        .first();
    }
    return user;
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

/** Updates the authenticated user's own profile fields and returns the updated document.
 *  Requires the caller to be authenticated and the target user to be their own record.
 *  Does not accept role changes; use updateUserRole for admin-managed role changes.
 */
export const updateUser = mutation({
  args: {
    id: v.id("users"),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    timeZone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;

    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Unauthorized");
    }

    const currentUser = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
      .first();

    if (!currentUser || currentUser._id !== id) {
      throw new Error("Unauthorized");
    }

    await ctx.db.patch(id, updates);
    return await ctx.db.get(id);
  },
});

/**
 * PR #4: set a single key on `notificationPreferences`.
 *
 * Authorization: the caller must (a) be authenticated, (b) own
 * the user record being updated, and (c) be eligible to write
 * notification preferences. Eligibility is:
 *
 *   - `role === "student"` — explicit student.
 *   - `role === undefined` — legacy record, NOT YET classified.
 *     `syncUser` can preserve an undefined role on records
 *     created before role assignment was enforced (Greptile
 *     R3 P1). The UI surfaces the toggle to these users via
 *     Clerk-derived workspace role, so blocking them at the
 *     backend would create a UX dead-end. The migration
 *     `backfillNotificationPreferences` stamps their `role`
 *     after classifying via workspace ownership; once it runs,
 *     no undefined roles remain and this branch is never hit.
 *
 * Anything else (`instructor` / `admin` / `video_editor` /
 * `support`) — rejected with "Only students can save
 * notification preferences". Recording-ready email is meaningful
 * only for students, so writing the preference for any other
 * role would be dead data.
 *
 * Future keys with broader audiences will need either a per-key
 * role whitelist or a dedicated mutation — see `ALLOWED_KEYS`
 * below.
 *
 * The `key` argument is a free-form string but validated against
 * a server-side whitelist so a client cannot pollute the
 * preference blob. Adding a new key = append to `ALLOWED_KEYS`
 * here. The value is type-checked by Convex's `v.boolean()`.
 *
 * Existing keys are preserved: the new value is shallow-merged
 * into the existing blob, so future toggles (e.g.,
 * `inAppBannerDismissed`) won't be wiped when the user changes
 * the recording-ready toggle.
 */
const ALLOWED_KEYS: ReadonlyArray<string> = ["recordingReadyEmail"];

export const setNotificationPreference = mutation({
  args: {
    key: v.string(),
    value: v.boolean(),
  },
  handler: async (ctx, args): Promise<{ ok: true; notificationPreferences: unknown }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    const currentUser = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
      .first();
    if (!currentUser) throw new Error("Unauthorized");

    const isExplicitStudent = currentUser.role === "student";
    const isLegacyUnclassified = currentUser.role === undefined;
    if (!isExplicitStudent && !isLegacyUnclassified) {
      throw new Error(
        "Only students can save notification preferences"
      );
    }

    if (!ALLOWED_KEYS.includes(args.key)) {
      throw new Error(
        `Unsupported notification preference key: ${args.key}. Allowed: ${ALLOWED_KEYS.join(", ")}`
      );
    }

    const existing = currentUser.notificationPreferences;
    const merged: Record<string, unknown> =
      existing && typeof existing === "object" && !Array.isArray(existing)
        ? { ...(existing as Record<string, unknown>) }
        : {};
    merged[args.key] = args.value;

    await ctx.db.patch(currentUser._id, {
      notificationPreferences: merged,
    });
    return { ok: true, notificationPreferences: merged };
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

    // Greptile P1 #11 (PR #904 follow-up): normalize the email
    // before the by_email lookup. `bootstrapAdminRoleOnce` (and
    // `migrateUser`) persist emails in lowercased+trimmed form so
    // a `syncUser` lookup matches; without this, a mixed-case email
    // (e.g. "Admin@Example.COM") would miss the bootstrap row and
    // insert a duplicate row.
    const normalizedEmail = email.trim().toLowerCase();

    // Greptile P1 #12 (PR #905, security): account-linking refusal.
    // Look up the row by NORMALIZED email first (handles rows written
    // after normalization). If not found, also try the raw email
    // (handles legacy rows written before normalization). Either
    // way, the row MUST have clerkId === identity.subject for us
    // to treat it as the caller's own row. A different clerkId
    // means the email is in use by another account, and we refuse
    // to silently merge them — see the incident mitigation at
    // docs/reverts/incident-mitigation_846-20260920-instructor-linking-refusal-bdd7a01.md.
    let existingByEmail = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", normalizedEmail))
      .first();
    if (!existingByEmail && normalizedEmail !== email) {
      existingByEmail = await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", email))
        .first();
    }
    if (
      existingByEmail &&
      existingByEmail.clerkId &&
      existingByEmail.clerkId !== identity.subject
    ) {
      throw new Error(
        "Refusing to link: this email is already associated with a different Clerk account. Contact support if this is your account.",
      );
    }

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
      // Greptile P1 #11 (PR #904 follow-up): insert with the
      // normalized email so future lookups match.
      email: normalizedEmail,
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
    // Greptile P1 #13 (PR #905): normalize the email on write so
    // legacy rows written after this fix are findable by syncUser
    // (which looks up lowercased). Rows written BEFORE this fix
    // keep their mixed-case email; syncUser/getCurrentUser fall
    // back to a raw lookup for those.
    const normalizedEmail = args.email.trim().toLowerCase();

    const existingByUserId = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();

    if (existingByUserId) {
      const updates: Partial<Doc<"users">> = {
        email: normalizedEmail,
        role: args.role ?? existingByUserId.role,
        timeZone: args.timeZone ?? existingByUserId.timeZone,
      };
      await ctx.db.patch(existingByUserId._id, updates);
      return { action: "updated", id: existingByUserId._id };
    }

    const id = await ctx.db.insert("users", {
      userId: args.userId,
      email: normalizedEmail,
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
//
// When `audit` is provided, the mutation writes a single audit row
// using the caller-supplied action/target/details/metadata instead of
// the default "set_user_role" row. This keeps the role change and its
// audit record in the same transaction (no orphaned role change with a
// missing audit row, no double audit rows).
export const setUserRoleTrusted = internalMutation({
  args: {
    userId: v.string(),
    role: v.union(v.literal("student"), v.literal("instructor"), v.literal("admin"), v.literal("video_editor")),
    actorId: v.optional(v.string()),
    actorRole: v.optional(v.union(v.literal("admin"), v.literal("support"), v.literal("instructor"), v.literal("student"), v.literal("system"))),
    audit: v.optional(v.object({
      action: v.string(),
      targetType: v.string(),
      targetId: v.string(),
      details: v.optional(v.string()),
      metadata: v.optional(v.record(v.string(), v.any())),
    })),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();

    if (existing) {
      const previousRole = existing.role;
      await ctx.db.patch(existing._id, { role: args.role, userId: args.userId });
      if (args.audit) {
        await writeAuditLog(ctx, {
          actorId: args.actorId ?? "system",
          actorRole: args.actorRole ?? "system",
          action: args.audit.action,
          targetType: args.audit.targetType,
          targetId: args.audit.targetId,
          details: args.audit.details,
          metadata: args.audit.metadata,
        });
      } else {
        await writeAuditLog(ctx, {
          actorId: args.actorId ?? "system",
          actorRole: args.actorRole ?? "system",
          action: "set_user_role",
          targetType: "user",
          targetId: args.userId,
          details: `Role changed from ${previousRole ?? "unset"} to ${args.role}`,
          metadata: { previousRole, newRole: args.role },
        });
      }
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
    if (args.audit) {
      await writeAuditLog(ctx, {
        actorId: args.actorId ?? "system",
        actorRole: args.actorRole ?? "system",
        action: args.audit.action,
        targetType: args.audit.targetType,
        targetId: args.audit.targetId,
        details: args.audit.details,
        metadata: args.audit.metadata,
      });
    } else {
      await writeAuditLog(ctx, {
        actorId: args.actorId ?? "system",
        actorRole: args.actorRole ?? "system",
        action: "set_user_role",
        targetType: "user",
        targetId: args.userId,
        details: `User created with role ${args.role}`,
        metadata: { previousRole: null, newRole: args.role },
      });
    }
    return inserted;
  },
});

/**
 * Greptile P1 #2 (PR #904): atomic first-time admin bootstrap.
 *
 * Replaces the multi-call dance the seed-role HTTP route used to do
 * (fetchQuery precondition → `syncUser` insert → `/users/set-role`
 * write). The old shape had a race: between the precondition read and
 * the role write, another admin could create a row with a non-admin
 * role, and the bootstrap would silently overwrite it to `admin`.
 *
 * This mutation performs the precondition check AND the role write
 * inside one Convex transaction. Concurrent admins writing a
 * non-admin role either commit first (this mutation then sees the
 * existing row and aborts) or commit after (this mutation's insert
 * blocks them).
 *
 * Greptile P2 #3: distinguishes "row absent" from "row present with
 * role undefined". An existing row is rejected even if its role has
 * not yet been set — bootstrap is only for genuinely first-time
 * admins, and re-elevating a demoted admin must go through
 * `setUserRoleTrusted` via the admin path.
 *
 * Caller contract: the HTTP route that invokes this MUST have
 * already authenticated the caller as an admin via
 * `requireRoleForApi("admin", { skipConvexAdminCheck: true })`. The
 * precondition check here is the role-write precondition, NOT an
 * authentication step.
 */
export const bootstrapAdminRoleOnce = internalMutation({
  args: {
    userId: v.string(),
    actorId: v.optional(v.string()),
    // Greptile P1 #7 (PR #904): the HTTP route resolves the caller's
    // primary email from the Clerk Backend API and passes it in. The
    // mutation stores it on the row so the subsequent Clerk webhook
    // `syncUser` (which looks up by `by_email`) finds and patches the
    // row instead of inserting a duplicate.
    //
    // Greptile P1 #10 (PR #904): the email is REQUIRED (non-empty).
    // An empty-string fallback would leave the bootstrap row with
    // `email=""`, and the later `syncUser` (looking up by email)
    // would miss it and insert a duplicate row. The HTTP route must
    // resolve the email from Clerk first; if it can't, it surfaces
    // a 502 to the caller instead of attempting bootstrap with
    // an empty email.
    email: v.string(),
  },
  handler: async (ctx, args) => {
    if (!args.email || args.email.trim() === "") {
      throw new Error(
        "Refusing bootstrap: email is required to prevent a later syncUser from inserting a duplicate row. Resolve the caller's primary email from Clerk before retrying.",
      );
    }

    const byUserId = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();
    if (byUserId) {
      throw new Error(
        `Refusing bootstrap: a users row already exists for userId=${args.userId}. Re-elevation must go through the admin path (setUserRoleTrusted).`,
      );
    }
    const byClerkId = await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", args.userId))
      .first();
    if (byClerkId) {
      throw new Error(
        `Refusing bootstrap: a users row already exists for clerkId=${args.userId}. Re-elevation must go through the admin path (setUserRoleTrusted).`,
      );
    }

    const id = await ctx.db.insert("users", {
      userId: args.userId,
      email: args.email.trim().toLowerCase(),
      clerkId: args.userId,
      role: "admin",
    } as Partial<Doc<"users">> as any);

    await writeAuditLog(ctx, {
      actorId: args.actorId ?? "system",
      actorRole: "system",
      action: "bootstrap_admin_role",
      targetType: "user",
      targetId: args.userId,
      details: "First-time admin bootstrap via HTTP route",
      metadata: { newRole: "admin", email: args.email },
    });

    const inserted = await ctx.db.get(id);
    if (!inserted) throw new Error("Failed to bootstrap admin role");
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

/** Synchronizes mutable Clerk profile fields across every linked user row. */
export const syncClerkProfile = internalMutation({
  args: {
    clerkUserId: v.string(),
    email: v.string(),
    firstName: v.union(v.string(), v.null()),
    lastName: v.union(v.string(), v.null()),
  },
  returns: v.object({ updatedCount: v.number() }),
  handler: async (ctx, args) => {
    const normalizedEmail = args.email.trim().toLowerCase();
    const [byUserId, byClerkId, byCurrentEmail] = await Promise.all([
      ctx.db
        .query("users")
        .withIndex("by_userId", (q) => q.eq("userId", args.clerkUserId))
        .collect(),
      ctx.db
        .query("users")
        .withIndex("by_clerkId", (q) => q.eq("clerkId", args.clerkUserId))
        .collect(),
      ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", normalizedEmail))
        .collect(),
    ]);

    // ID-linked rows reveal the previous email when Clerk has just changed it.
    // Include every row on those emails so split onboarding records stay aligned.
    const previousEmails = new Set(
      [...byUserId, ...byClerkId].map((user) => user.email.trim().toLowerCase())
    );
    previousEmails.delete(normalizedEmail);
    const byPreviousEmail = await Promise.all(
      [...previousEmails].map((email) =>
        ctx.db.query("users").withIndex("by_email", (q) => q.eq("email", email)).collect()
      )
    );

    const users = new Map(
      [...byUserId, ...byClerkId, ...byCurrentEmail, ...byPreviousEmail.flat()].map((user) => [
        user._id,
        user,
      ])
    );

    await Promise.all(
      [...users.values()].map((user) =>
        ctx.db.patch(user._id, {
          email: normalizedEmail,
          firstName: args.firstName?.trim() || undefined,
          lastName: args.lastName?.trim() || undefined,
        })
      )
    );

    return { updatedCount: users.size };
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
    actorId: v.optional(v.string()),
    actorRole: v.optional(v.union(v.literal("admin"), v.literal("support"), v.literal("instructor"), v.literal("student"), v.literal("system"))),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();

    if (!user) {
      throw new Error(`User with userId ${args.userId} not found`);
    }

    const previousClerkId = user.clerkId;
    await ctx.db.patch(user._id, {
      clerkId: args.clerkId,
    });

    await writeAuditLog(ctx, {
      actorId: args.actorId ?? "system",
      actorRole: args.actorRole ?? "system",
      action: "set_user_clerk_id",
      targetType: "user",
      targetId: args.userId,
      details: `clerkId changed from ${previousClerkId} to ${args.clerkId}`,
      metadata: { previousClerkId, newClerkId: args.clerkId },
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

/** Public self-lookup: returns the authenticated user's own record. */
export const getCurrentUserPublic = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const authUser = await ctx.auth.getUserIdentity();
    if (!authUser || authUser.subject !== args.userId) {
      return null;
    }
    // Primary lookup by userId (Clerk ID from apps/platform). Fall back to the
    // huckleberry-drive Clerk ID for users whose primary userId differs.
    const byUserId = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();
    if (byUserId) return byUserId;

    return await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", args.userId))
      .first();
  },
});

export const getUserByClerkIdPublic = query({
  args: { userId: v.string(), sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    const authUser = await ctx.auth.getUserIdentity();
    if (!authUser) {
      return null;
    }
    // Self-lookup is handled by getCurrentUserPublic. This query is used by
    // instructor-facing session routes to retrieve a student's contact info.
    // Enforce that the caller is either an admin or the instructor assigned to
    // the provided session, and that the requested user is the student for that
    // session.
    const caller = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", authUser.subject))
      .first();
    const callerByClerkId = caller ?? await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", authUser.subject))
      .first();
    if (!callerByClerkId || (callerByClerkId.role !== "instructor" && callerByClerkId.role !== "admin")) {
      return null;
    }

    const session = await ctx.db.get(args.sessionId);
    if (!session) return null;

    if (callerByClerkId.role === "instructor") {
      const instructor = await ctx.db
        .query("instructors")
        .withIndex("by_userId", (q) => q.eq("userId", callerByClerkId.userId))
        .first();
      const instructorByClerkId = instructor ?? await ctx.db
        .query("instructors")
        .withIndex("by_userId", (q) => q.eq("userId", callerByClerkId.clerkId ?? ""))
        .first();
      if (!instructorByClerkId || instructorByClerkId._id !== session.instructorId) {
        return null;
      }
    }

    if (session.studentId !== args.userId) {
      return null;
    }

    const user = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();
    // For split-ID students the session studentId may be the Clerk subject
    // (huckleberry-drive clerkId) while the canonical userId differs.
    const userByClerkId = user ?? await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", args.userId))
      .first();
    if (!userByClerkId) return null;
    // Return only the contact fields needed by session notification routes.
    return {
      email: userByClerkId.email,
      firstName: userByClerkId.firstName,
      lastName: userByClerkId.lastName,
      timeZone: userByClerkId.timeZone,
    };
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
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    try {
      const identity = await ctx.auth.getUserIdentity();
      if (!identity) {
        return { page: [], isDone: true, continueCursor: "" };
      }

      const currentUser = await ctx.db
        .query("users")
        .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
        .first();

      if (!currentUser || currentUser.role !== "admin") {
        return { page: [], isDone: true, continueCursor: "" };
      }

      const page = await ctx.db
        .query("users")
        .withIndex("by_deletedAt", (q) => q.eq("deletedAt", undefined))
        .filter((q) => q.eq(q.field("hardDeletedAt"), undefined))
        .order("desc")
        .paginate(args.paginationOpts);

      const activeUsers = page.page.map((u) => ({
        _id: u._id,
        userId: u.userId,
        email: u.email,
        firstName: u.firstName,
        lastName: u.lastName,
        role: u.role,
        timeZone: u.timeZone,
        clerkId: u.clerkId,
        createdAt: u._creationTime,
      }));

      return { ...page, page: activeUsers };
    } catch (e) {
      console.error("listActiveUsers error:", e);
      return { page: [], isDone: true, continueCursor: "" };
    }
  },
});

export const listDeletedUsers = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    try {
      const identity = await ctx.auth.getUserIdentity();
      if (!identity) {
        return { page: [], isDone: true, continueCursor: "" };
      }

      const currentUser = await ctx.db
        .query("users")
        .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
        .first();

      if (!currentUser || currentUser.role !== "admin") {
        return { page: [], isDone: true, continueCursor: "" };
      }

      const page = await ctx.db
        .query("users")
        .withIndex("by_deletedAt", (q) => q.gt("deletedAt", 0))
        .filter((q) => q.eq(q.field("hardDeletedAt"), undefined))
        .order("desc")
        .paginate(args.paginationOpts);

      const deletedUsers = page.page.map((u) => ({
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
      }));

      return { ...page, page: deletedUsers };
    } catch (e) {
      console.error("listDeletedUsers error:", e);
      return { page: [], isDone: true, continueCursor: "" };
    }
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

    // Greptile P1 #1 + P1 #8 + P1 #9 (PR #904): if linked `users` rows
    // exist for the same Clerk user, patch EACH one (not just the
    // first) so a demoted admin cannot keep admin access through any
    // of them. Use `args.userId` for the `by_clerkId` lookup — NOT
    // `targetUser.clerkId`. The linked-row concept is keyed by Clerk
    // user ID, and in normal operation `userId === clerkId === subject`,
    // so `args.userId` is the Clerk user ID of the target. Using the
    // target row's stored `clerkId` instead could patch a different
    // Clerk account entirely if the stored value is stale or wrong.
    // Linked rows are an edge case (`onboardingAlias` splits, support
    // overlays); in normal operation there are no extra rows beyond
    // the target itself (filtered by `row._id !== targetUser._id`).
    const linkedRows = await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", args.userId))
      .collect();
    for (const row of linkedRows) {
      if (row._id !== targetUser._id) {
        await ctx.db.patch(row._id, { role: args.role });
      }
    }

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
        b2UploadId: upload.b2UploadId ?? undefined,
      });
    }

    // The per-user workspaceAliases table is keyed by userId; rows
    // contain the (possibly nickname) the user picked for a
    // workspace. Without this pass a hard-deleted account would
    // leave participant-chosen names in the database indefinitely.
    const userAliases = await ctx.db
      .query("workspaceAliases")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .collect();
    for (const alias of userAliases) {
      await ctx.db.delete(alias._id);
    }

    return {
      success: true,
      userId: args.userId,
      filesQueued: filesToDelete.length,
      aliasesRemoved: userAliases.length,
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
