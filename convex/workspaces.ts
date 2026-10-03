import { query, mutation, internalMutation, internalQuery, action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { resolveSessionWorkspace } from "./lib/sessionWorkspace";

import {
  WORKSPACE_IMAGE_CAPS,
  WORKSPACE_FILE_CAPS,
  MAX_WORKSPACE_FILE_BYTES,
  MAX_WORKSPACE_FILE_MB,
  MAX_BINDING_AGE_MS,
  WORKSPACE_RETENTION_MS,
} from "./workspaceConstants";

const EIGHTEEN_MONTHS_MS = 18 * 30 * 24 * 60 * 60 * 1000;

type WorkspaceRole = "instructor" | "student" | "admin" | null;
type AuthorRole = Exclude<WorkspaceRole, null>;
type WorkspaceCtx = QueryCtx | MutationCtx;

async function isAdmin(ctx: WorkspaceCtx, userId: string): Promise<boolean> {
  const user = await ctx.db
    .query("users")
    .withIndex("by_userId", (q: any) => q.eq("userId", userId))
    .first();
  return user?.role === "admin";
}

export async function getWorkspaceRole(
  ctx: WorkspaceCtx,
  workspace: { instructorId?: any; ownerId: string; type?: string },
  userId: string
): Promise<WorkspaceRole> {
  const userIsAdmin = await isAdmin(ctx, userId);
  if (userIsAdmin) {
    return "admin";
  }

  if (workspace.type === "admin_student") {
    return workspace.ownerId === userId ? "student" : null;
  }

  if (workspace.type === "admin_instructor") {
    if (workspace.instructorId) {
      const instructor = await ctx.db
        .query("instructors")
        .withIndex("by_userId", (q: any) => q.eq("userId", userId))
        .first();
      if (instructor && instructor._id === workspace.instructorId) {
        return "instructor";
      }
    }
    return null;
  }

  if (workspace.instructorId) {
    const instructor = await ctx.db
      .query("instructors")
      .withIndex("by_userId", (q: any) => q.eq("userId", userId))
      .first();
    if (instructor && instructor._id === workspace.instructorId) {
      return "instructor";
    }
  }
  if (workspace.ownerId === userId) {
    return "student";
  }
  return null;
}

/**
 * Returns the workspace only if it exists and is not soft-deleted.
 * Ended workspaces are still accessible (18-month retention period).
 */
async function getWorkspaceIfNotDeleted(
  ctx: WorkspaceCtx,
  workspaceId: Id<"workspaces">
): Promise<Doc<"workspaces"> | null> {
  const workspace = await ctx.db.get(workspaceId);
  if (!workspace) return null;
  if (workspace.deletedAt !== undefined) return null;
  return workspace;
}

/**
 * Returns the workspace only if it exists and is not soft-deleted or ended.
 * Use this for write/create mutations where no new content should be added
 * after a workspace has ended.
 */
async function getWorkspaceIfActive(
  ctx: WorkspaceCtx,
  workspaceId: Id<"workspaces">
): Promise<Doc<"workspaces"> | null> {
  const workspace = await getWorkspaceIfNotDeleted(ctx, workspaceId);
  if (!workspace) return null;
  if (workspace.endedAt !== undefined) return null;
  return workspace;
}

/**
 * Resolves the caller's role for a workspace, returning null when the caller
 * is not authenticated, the workspace does not exist, the workspace is
 * soft-deleted, or the caller is not a participant. Ended workspaces remain
 * accessible during the 18-month retention period.
 */
async function getCallerWorkspaceRole(
  ctx: WorkspaceCtx,
  workspaceId: Id<"workspaces">
): Promise<{ role: WorkspaceRole; workspace: Doc<"workspaces"> } | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  const workspace = await getWorkspaceIfNotDeleted(ctx, workspaceId);
  if (!workspace) return null;
  const role = await getWorkspaceRole(ctx, workspace, identity.subject);
  if (!role) return null;
  return { role, workspace };
}

async function resolveAuthorDisplayNames(
  ctx: QueryCtx,
  workspace: Pick<Doc<"workspaces">, "instructorId">,
  authors: Array<{ userId: string; role?: AuthorRole }>
): Promise<Map<string, string>> {
  const uniqueAuthors = new Map(authors.map((author) => [author.userId, author]));
  const resolved = await Promise.all(
    [...uniqueAuthors.values()].map(async (author) => {
      const [user, instructor] = await Promise.all([
        ctx.db
          .query("users")
          .withIndex("by_userId", (q) => q.eq("userId", author.userId))
          .first(),
        ctx.db
          .query("instructors")
          .withIndex("by_userId", (q) => q.eq("userId", author.userId))
          .first(),
      ]);
      const role: AuthorRole =
        author.role ??
        (user?.role === "admin"
          ? "admin"
          : instructor && instructor._id === workspace.instructorId
            ? "instructor"
            : "student");
      const userName = [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim();
      const displayName =
        (role === "instructor" ? instructor?.name?.trim() : undefined) ||
        userName ||
        (role === "admin" ? "Admin" : role === "instructor" ? "Instructor" : "Student");
      return [author.userId, displayName] as const;
    })
  );
  return new Map(resolved);
}

/**
 * Same as `getCallerWorkspaceRole` but throws when the caller is not an
 * active participant. Use this for mutations.
 */
async function requireCallerWorkspaceRole(
  ctx: WorkspaceCtx,
  workspaceId: Id<"workspaces">
): Promise<{ role: WorkspaceRole; workspace: Doc<"workspaces"> }> {
  const result = await getCallerWorkspaceRole(ctx, workspaceId);
  if (!result) {
    throw new Error("Not authorized to access this workspace");
  }
  return result;
}

export async function countActiveWorkspaceImages(ctx: any, workspaceId: Id<"workspaces">): Promise<number> {
  const images = await ctx.db
    .query("workspaceImages")
    .withIndex("by_workspaceId_and_deletedAt", (q: any) =>
      q.eq("workspaceId", workspaceId).eq("deletedAt", undefined)
    )
    .collect();
  return images.length;
}

export async function countWorkspaceFilesByRole(
  ctx: any,
  workspaceId: Id<"workspaces">,
  role: "instructor" | "student" | "admin"
): Promise<number> {
  // PR #convex-egress-1: use the narrow index so we only scan file
  // messages for the requested role instead of the entire chat history.
  // PR #B: filter out soft-deleted messages so a delete frees a slot
  // immediately. `deletedAt` is not in the index (would require
  // `by_workspaceId_type_senderRole_deletedAt`); per the Convex index
  // guidance, an additional `.filter()` after the indexed range scan
  // is acceptable for predicates that cannot be expressed by the
  // existing index. The bounded index scan keeps the post-filter cost
  // proportional to that role's message count, not the whole table.
  const messages = await ctx.db
    .query("workspaceMessages")
    .withIndex("by_workspaceId_type_senderRole", (q: any) =>
      q.eq("workspaceId", workspaceId).eq("type", "file").eq("senderRole", role)
    )
    .filter((q: any) => q.eq(q.field("deletedAt"), undefined))
    .collect();

  return messages.length;
}

async function logWorkspaceAudit(
  ctx: any,
  workspaceId: any,
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

/**
 * Verifies that the given session belongs to the workspace: the
 * session's instructor/student pair matches the workspace's
 * instructor/owner pair. Throws on mismatch so callers can fail fast
 * before inserting rows tagged to the wrong session.
 *
 * Used by every workspace mutation that accepts an optional
 * `sessionId` (PR #4b) so a client cannot tag a note/link/image/chat
 * message to a session that is not associated with the workspace the
 * caller is writing to.
 *
 * PR #4b (Greptile R2 P2): typed `MutationCtx` (rather than
 * `any`) so OCC guarantees and the schema's field types are
 * enforced at the type level. Surrounding helpers in this file
 * still use `ctx: any` — they predate this helper and are out
 * of scope to retype.
 */
export async function assertSessionBelongsToWorkspace(
  ctx: MutationCtx,
  args: { sessionId?: Id<"sessions">; workspaceId: Id<"workspaces"> }
): Promise<void> {
  if (args.sessionId === undefined) return;
  const [session, workspace] = await Promise.all([
    ctx.db.get(args.sessionId),
    ctx.db.get(args.workspaceId),
  ]);
  if (!session) {
    throw new Error("Session not found");
  }
  if (!workspace) {
    throw new Error("Workspace not found");
  }
  if (workspace.instructorId === undefined) {
    throw new Error("Workspace is not paired with an instructor");
  }
  if (session.instructorId !== workspace.instructorId) {
    throw new Error("Session does not belong to this workspace");
  }
  if (session.studentId !== workspace.ownerId) {
    throw new Error("Session does not belong to this workspace");
  }
}

/**
 * Verifies that the given `storageId` was bound to the caller by
 * {@link recordFileUpload} for the given workspace. Refuses to
 * proceed otherwise.
 *
 * This is the gate that prevents a workspace participant from
 * passing an unrelated storage id (e.g. one they discovered in a
 * chat URL they have access to) to the create mutations and
 * causing the retention cron to delete that blob after the 30-day
 * window (Greptile Security P1). Convex storage does not track
 * uploader metadata, so the `fileUploads` ledger is the source
 * of truth.
 */
// PR workspace-storage-3c: the Convex-storage path helper
// `assertFileUploadOwnedByCaller` was removed — every chat-create
// mutation that previously gated on the storage-ledger row now
// uses the B2-key helper `assertB2FileUploadOwnedByCaller` below.
// The `chatFileRetention` cleanup cron and the PR 3a
// `cleanupMigratedConvexStorageBlobs` cron never called this
// helper directly; they read `fileUploads.by_storageId` themselves
// to enumerate the legacy rows.

/**
 * B2-path equivalent of {@link assertFileUploadOwnedByCaller}: gates
 * the new chat-create mutations (`embedImageInNote` /
 * `createWorkspaceImageAndMessage` / `createWorkspaceFileMessage`)
 * so a workspace participant cannot pass an unrelated B2 key
 * (Greptile Security P1).
 *
 * PR workspace-storage-3c: the `by_b2Key` index was added in PR 1;
 * the lookup matches on the stored value regardless of the runtime
 * type of the field validator.
 */
export async function assertB2FileUploadOwnedByCaller(
  ctx: MutationCtx,
  args: {
    workspaceId: Id<"workspaces">;
    b2Key: string;
    callerId: string;
  }
): Promise<Doc<"fileUploads">> {
  const row = await ctx.db
    .query("fileUploads")
    .withIndex("by_b2Key", (q) => q.eq("b2Key", args.b2Key))
    .first();
  if (!row) {
    throw new Error(
      "B2 key is not bound to a known upload. Re-upload and try again."
    );
  }
  if (row.workspaceId !== args.workspaceId) {
    throw new Error(
      "B2 key is not bound to this workspace. Re-upload and try again."
    );
  }
  if (row.uploaderId !== args.callerId) {
    throw new Error(
      "B2 key is not owned by the caller. Re-upload and try again."
    );
  }
  if (row.cancelledAt !== undefined) {
    throw new Error(
      "B2 key upload was cancelled. Re-upload and try again."
    );
  }
  if (row.completedAt === undefined) {
    throw new Error(
      "B2 key upload has not been confirmed. Re-upload and try again."
    );
  }
  return row;
}

/**
 * Resolves the display name a caller should see for a workspace. If
 * the caller has set a private alias in `workspaceAliases`, returns
 * that; otherwise falls back to the workspace's `name`. The alias is
 * scoped per `(workspaceId, userId)`, so one user's rename never
 * affects another participant's view.
 *
 * Reads use the `by_workspaceId_userId` compound index so the lookup
 * is O(1) per call. Callers that surface a workspace's name to a
 * specific user (the picker, the workspace header, the admin
 * settings page) should pass through this helper so a user renaming
 * their workspace always wins over the default name.
 */
export async function resolveWorkspaceDisplayName(
  ctx: WorkspaceCtx,
  args: { workspaceId: Id<"workspaces">; userId: string }
): Promise<string> {
  const workspace = await ctx.db.get(args.workspaceId);
  if (!workspace) return "";
  const aliasRow = await ctx.db
    .query("workspaceAliases")
    .withIndex("by_workspaceId_userId", (q) =>
      q.eq("workspaceId", args.workspaceId).eq("userId", args.userId)
    )
    .first();
  return aliasRow?.alias?.trim() || workspace.name;
}

/**
 * PR #4c-1: confirms the caller is a participant on the given
 * session (either the session's instructor OR the student paired
 * with that instructor on one of the caller's workspaces). Returns
 * the session row + the matching workspace + the caller's role, so
 * callers (the recording route, `getCallRecordingsForWorkspace`,
 * etc.) don't have to re-query.
 *
 * Used as the single source of truth for "can this user see this
 * call's recording?" — same role-resolution shape as
 * `getSessionByVideoRoomName` (`convex/sessions.ts`) but flipped
 * to take a `sessionId` instead of a `videoRoomName`.
 *
 * Implementation notes:
 * - Identity derived from `ctx.auth.getUserIdentity()` only —
 *   caller-supplied user ids are never accepted (Convex auth
 *   guideline).
 * - Workspace lookup prefers the session's immutable `workspaceId`.
 *   Legacy rows resolve only through pack evidence or one unambiguous pair.
 * - Soft-deleted workspaces are rejected. Ended workspaces remain readable
 *   during retention so participants can download recordings.
 * - Returns role `"instructor"` if the caller's Clerk token matches
 *   the session's instructor doc, else `"student"`. Never both.
 */
export async function assertParticipantForSession(
  ctx: QueryCtx,
  args: { sessionId: Id<"sessions"> }
): Promise<{
  session: Doc<"sessions">;
  workspace: Doc<"workspaces">;
  role: "instructor" | "student";
}> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Unauthorized");
  }

  const session = await ctx.db.get(args.sessionId);
  if (!session) {
    throw new Error("Session not found");
  }
  if (session.deletedAt !== undefined) {
    throw new Error("Session not found");
  }
  if (session.instructorId === undefined) {
    throw new Error("Session is not paired with an instructor");
  }

  const instructor = await ctx.db.get(session.instructorId);
  if (!instructor) {
    throw new Error("Instructor not found");
  }

  const workspace = await resolveSessionWorkspace(ctx, session);
  if (!workspace) {
    throw new Error("No unambiguous workspace matches this session");
  }
  if (workspace.deletedAt !== undefined) {
    throw new Error("No retained workspace matches this session");
  }
  if (instructor.userId === identity.subject) {
    return { session, workspace, role: "instructor" };
  }
  if (
    workspace.ownerId === identity.subject &&
    session.studentId === identity.subject
  ) {
    return { session, workspace, role: "student" };
  }
  throw new Error("Forbidden");
}

/**
 * Resolve the workspace to link to from an instructor + student pair
 * in the student list / dashboard. Used by
 * `getInstructorStudentsWithRemainingSessions` and
 * `getInstructorStudentsWithSessionInfo` to populate the
 * `workspaceId` column so the UI can route to `/workspace/{id}`
 * instead of the stale per-student detail page.
 *
 * Returns the active workspace (`endedAt` undefined, `deletedAt`
 * undefined) for the pair, or `null` if none exists.
 *
 * Uses the `by_instructorId_ownerId` index (PR #4c-1) so this is
 * O(1) for the common case. We collect all matches because the
 * index does not narrow to a single row — historically the same
 * pair could end and re-open a new workspace, so we sort in memory.
 */
export async function resolveActiveWorkspaceForPair(
  ctx: QueryCtx,
  args: { instructorId: Id<"instructors">; studentUserId: string }
): Promise<Doc<"workspaces"> | null> {
  const candidates = await ctx.db
    .query("workspaces")
    .withIndex("by_instructorId_ownerId", (q) =>
      q
        .eq("instructorId", args.instructorId)
        .eq("ownerId", args.studentUserId)
    )
    .collect();

  const active = candidates.find(
    (w) => w.deletedAt === undefined && w.endedAt === undefined
  );
  return active ?? null;
}

/** Log a view_workspace audit event. Called from admin API routes after fetching workspace details. */
export const logViewWorkspaceAudit = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    adminId: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("workspaceAuditLogs", {
      workspaceId: args.workspaceId,
      adminId: args.adminId,
      action: "view_workspace",
      timestamp: Date.now(),
    });
  },
});

/**
 * Returns a workspace by ID. The caller must be an active participant
 * (owner, instructor, or admin) and the workspace must not be
 * soft-deleted/ended. Returns null otherwise.
 */
export const getWorkspaceById = query({
  args: { id: v.id("workspaces") },
  handler: async (ctx, args) => {
    const result = await getCallerWorkspaceRole(ctx, args.id);
    if (!result) {
      return null;
    }
    const identity = await ctx.auth.getUserIdentity();
    const displayName = identity
      ? await resolveWorkspaceDisplayName(ctx, {
          workspaceId: result.workspace._id,
          userId: identity.subject,
        })
      : result.workspace.name;
    return { ...result.workspace, displayName };
  },
});

/**
 * PR #4c-2: workspace fetch for the `/workspace/[id]` dynamic route.
 *
 * Returns `null` if the workspace doesn't exist, is soft-deleted,
 * or the caller is not a participant (owner OR instructor). Drives
 * the auth gate at the route boundary — the server-side page
 * renders a redirect to `/workspace` (the picker) if this returns
 * `null`, so unauthorized users never see a 404 vs a 200 with
 * leaked data.
 *
 * Uses the existing `getWorkspaceRole` helper so the role
 * resolution is identical to every other workspace query
 * (`getWorkspaceNotes`, `getUserWorkspaceRole`, etc.). The
 * instructor-lookup branch is the same one as
 * `getUserWorkspaces` — keeps the "instructor sees their own
 * workspaces" rule consistent across read paths.
 */
export const getWorkspaceByIdForUser = query({
  args: { id: v.id("workspaces") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return null;
    }
    const workspace = await ctx.db.get(args.id);
    if (!workspace) {
      return null;
    }
    if (workspace.deletedAt !== undefined) {
      return null;
    }
    const role = await getWorkspaceRole(ctx, workspace, identity.subject);
    if (!role) {
      return null;
    }
    let sessionPackId: Id<"sessionPacks"> | undefined = undefined;
    if (workspace.seatReservationId) {
      const seat = await ctx.db.get(workspace.seatReservationId);
      sessionPackId = seat?.sessionPackId ?? undefined;
    }
    const displayName = await resolveWorkspaceDisplayName(ctx, {
      workspaceId: workspace._id,
      userId: identity.subject,
    });
    return { ...workspace, sessionPackId, displayName };
  },
});

/** Returns all workspaces owned by a user OR where the user is the instructor. Requires auth. */
export const getUserWorkspaces = query({
  args: { ownerId: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return [];
    }
    const ownedWorkspaces = await ctx.db
      .query("workspaces")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", args.ownerId))
      .collect();

    // Also get workspaces where the user is the instructor
    const instructor = await ctx.db
      .query("instructors")
      .withIndex("by_userId", (q) => q.eq("userId", args.ownerId))
      .first();

    let instructorWorkspaces: typeof ownedWorkspaces = [];
    if (instructor) {
      instructorWorkspaces = await ctx.db
        .query("workspaces")
        .withIndex("by_instructorId", (q) => q.eq("instructorId", instructor._id))
        .collect();
    }

    // Merge and deduplicate by workspace ID, excluding soft-deleted workspaces
    const allWorkspaces = [...ownedWorkspaces, ...instructorWorkspaces];
    const seen = new Set<string>();
    const visibleWorkspaces = allWorkspaces.filter((w) => {
      if (seen.has(w._id)) return false;
      seen.add(w._id);
      // Exclude soft-deleted workspaces
      if (w.deletedAt) return false;
      return true;
    });

    return await Promise.all(
      visibleWorkspaces.map(async (workspace) => {
        const displayName = await resolveWorkspaceDisplayName(ctx, {
          workspaceId: workspace._id,
          userId: user.subject,
        });
        if (!workspace.seatReservationId) {
          return {
            ...workspace,
            sessionPackId: undefined as Id<"sessionPacks"> | undefined,
            displayName,
          };
        }

        const seatReservation = await ctx.db.get(workspace.seatReservationId);
        return {
          ...workspace,
          sessionPackId: seatReservation?.sessionPackId ?? undefined,
          displayName,
        };
      })
    );
  },
});

/** Returns all workspaces assigned to an instructor. Requires auth. */
export const getInstructorWorkspaces = query({
  args: { instructorId: v.id("instructors") },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return [];
    }
    return await ctx.db
      .query("workspaces")
      .withIndex("by_instructorId", (q) => q.eq("instructorId", args.instructorId))
      .collect();
  },
});

/** Returns a workspace by seat reservation ID. Requires auth. */
export const getWorkspaceBySeatReservation = query({
  args: { seatReservationId: v.id("seatReservations") },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return null;
    }
    return await ctx.db
      .query("workspaces")
      .withIndex("by_seatReservationId", (q) =>
        q.eq("seatReservationId", args.seatReservationId)
      )
      .first();
  },
});

/** Returns the active workspace ID for a session pack, or null if none exists. Requires auth. */
export const getWorkspaceBySessionPackId = query({
  args: { sessionPackId: v.id("sessionPacks") },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return null;
    }
    const pack = await ctx.db.get(args.sessionPackId);
    if (!pack) {
      return null;
    }
    if (user.subject !== pack.userId) {
      return null;
    }
    const workspace = await resolveActiveWorkspaceForPair(ctx, {
      instructorId: pack.instructorId,
      studentUserId: pack.userId,
    });
    return workspace?._id ?? null;
  },
});

/**
 * Links workspaces owned by a placeholder email ID to a real Clerk user ID.
 * Called by the Clerk account-linking flow after a guest checkout user signs up.
 * Only rewrites workspaces whose ownerId is an email placeholder, leaving
 * already-linked workspaces untouched.
 */
export const linkWorkspacesByEmail = internalMutation({
  args: {
    clerkUserId: v.string(),
    email: v.string(),
  },
  handler: async (ctx, args) => {
    const normalizedEmail = args.email.toLowerCase().trim();
    const placeholderUserId = `email:${normalizedEmail}`;

    const workspacesToLink = await ctx.db
      .query("workspaces")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", placeholderUserId))
      .collect();

    let linked = 0;
    for (const workspace of workspacesToLink) {
      await ctx.db.patch(workspace._id, { ownerId: args.clerkUserId });
      linked++;
    }

    return { linked };
  },
});

/** Returns workspaces past the 18-month retention period that are pending deletion. */
export const getWorkspacesNeedingRetentionDeletion = query({
  args: {},
  handler: async (ctx, args) => {
    const cutoff = Date.now() - EIGHTEEN_MONTHS_MS;
    return await ctx.db
      .query("workspaces")
      .withIndex("by_endedAt", (q) => q.lt("endedAt", cutoff))
      .filter((q) => q.or(q.eq(q.field("deletedAt"), undefined), q.gt(q.field("deletedAt"), cutoff)))
      .collect();
  },
});

/** Returns workspaces approaching retention deletion within 90, 30, or 7 days. */
export const getWorkspacesForRetentionNotification = query({
  args: {},
  handler: async (ctx, args) => {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const notifications: {
      workspace: any;
      daysUntilDeletion: number;
    }[] = [];

    const workspaces = await ctx.db
      .query("workspaces")
      .withIndex("by_endedAt")
      .collect();

    for (const workspace of workspaces) {
      if (!workspace.endedAt) continue;

    const daysUntilDeletion = Math.floor(
      (workspace.endedAt + EIGHTEEN_MONTHS_MS - now) / dayMs
    );

    // Use ±1 window for robustness against timing drift
    const inWindow = (target: number) => daysUntilDeletion >= target - 1 && daysUntilDeletion <= target + 1;
    if (inWindow(90) || inWindow(30) || inWindow(7)) {
      notifications.push({ workspace, daysUntilDeletion });
    }
    }

    return notifications;
  },
});

/** Returns the authenticated user's role (instructor/student/admin) in a workspace. Requires auth. */
export const getUserWorkspaceRole = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return null;
    }
    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace) {
      return null;
    }
    const role = await getWorkspaceRole(ctx, { instructorId: workspace.instructorId, ownerId: workspace.ownerId, type: workspace.type }, user.subject);
    return role;
  },
});

/**
 * Requires an authenticated admin caller. Throws for unauthenticated or
 * non-admin users.
 */
async function requireAdmin(ctx: WorkspaceCtx): Promise<void> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Unauthorized");
  }
  const user = await ctx.db
    .query("users")
    .withIndex("by_userId", (q: any) => q.eq("userId", identity.subject))
    .first();
  if (user?.role !== "admin") {
    throw new Error("Admin access required");
  }
}

const createWorkspaceArgs = {
  name: v.string(),
  description: v.optional(v.string()),
  ownerId: v.string(),
  instructorId: v.optional(v.id("instructors")),
  imageUrl: v.optional(v.string()),
  isPublic: v.optional(v.boolean()),
  seatReservationId: v.optional(v.id("seatReservations")),
} as const;

const updateWorkspaceArgs = {
  id: v.id("workspaces"),
  name: v.optional(v.string()),
  description: v.optional(v.string()),
  imageUrl: v.optional(v.string()),
  isPublic: v.optional(v.boolean()),
  ownerId: v.optional(v.string()),
} as const;

const deleteWorkspaceArgs = {
  id: v.id("workspaces"),
} as const;

async function createWorkspaceImpl(
  ctx: MutationCtx,
  args: {
    name: string;
    description?: string;
    ownerId: string;
    instructorId?: Id<"instructors">;
    imageUrl?: string;
    isPublic?: boolean;
    seatReservationId?: Id<"seatReservations">;
  }
) {
  return await ctx.db.insert("workspaces", {
    ...args,
    isPublic: args.isPublic ?? false,
    studentImageCount: 0,
    instructorImageCount: 0,
  });
}

async function updateWorkspaceImpl(
  ctx: MutationCtx,
  args: {
    id: Id<"workspaces">;
    name?: string;
    description?: string;
    imageUrl?: string;
    isPublic?: boolean;
    ownerId?: string;
  }
) {
  const { id, ...updates } = args;
  await ctx.db.patch(id, updates);
  return await ctx.db.get(id);
}

async function deleteWorkspaceImpl(
  ctx: MutationCtx,
  args: { id: Id<"workspaces"> }
) {
  await ctx.db.patch(args.id, { deletedAt: Date.now() });
}

/** Creates a new workspace with the given owner, instructor, and settings. Admin-only. */
export const createWorkspace = mutation({
  args: createWorkspaceArgs,
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    return await createWorkspaceImpl(ctx, args);
  },
});

/** Updates a workspace's name, description, image, visibility, or owner. Admin-only. */
export const updateWorkspace = mutation({
  args: updateWorkspaceArgs,
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    return await updateWorkspaceImpl(ctx, args);
  },
});

/** Soft-deletes a workspace by setting the deletedAt timestamp. Admin-only. */
export const deleteWorkspace = mutation({
  args: deleteWorkspaceArgs,
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    return await deleteWorkspaceImpl(ctx, args);
  },
});

/** Internal variant of createWorkspace for trusted scripts and other Convex functions. */
export const createWorkspaceInternal = internalMutation({
  args: createWorkspaceArgs,
  handler: async (ctx, args) => {
    return await createWorkspaceImpl(ctx, args);
  },
});

/** Internal variant of updateWorkspace for trusted scripts and other Convex functions. */
export const updateWorkspaceInternal = internalMutation({
  args: updateWorkspaceArgs,
  handler: async (ctx, args) => {
    return await updateWorkspaceImpl(ctx, args);
  },
});

/** Internal variant of deleteWorkspace for trusted scripts and other Convex functions. */
export const deleteWorkspaceInternal = internalMutation({
  args: deleteWorkspaceArgs,
  handler: async (ctx, args) => {
    return await deleteWorkspaceImpl(ctx, args);
  },
});

const setWorkspaceAliasArgs = {
  workspaceId: v.id("workspaces"),
  // When the trimmed alias is empty, the mutation deletes the row
  // (rather than writing an empty string) so subsequent reads fall
  // back to the workspace's default `name`. Always pass a plain
  // string — do not use `v.optional()` — to keep the "clear alias"
  // intent unambiguous.
  alias: v.string(),
} as const;

const setWorkspaceAliasInternalArgs = {
  workspaceId: v.id("workspaces"),
  userId: v.string(),
  alias: v.string(),
} as const;

async function writeAlias(
  ctx: MutationCtx,
  args: { workspaceId: Id<"workspaces">; userId: string; alias: string }
): Promise<{ cleared: boolean; alias: string }> {
  const trimmed = args.alias.trim();

  const existing = await ctx.db
    .query("workspaceAliases")
    .withIndex("by_workspaceId_userId", (q) =>
      q.eq("workspaceId", args.workspaceId).eq("userId", args.userId)
    )
    .first();

  if (trimmed.length === 0) {
    if (existing) {
      await ctx.db.delete(existing._id);
    }
    return { cleared: true, alias: "" };
  }

  if (trimmed.length > 120) {
    throw new Error("Alias must be 120 characters or fewer");
  }

  if (existing) {
    await ctx.db.patch(existing._id, {
      alias: trimmed,
      updatedAt: Date.now(),
    });
    return { cleared: false, alias: trimmed };
  }

  await ctx.db.insert("workspaceAliases", {
    workspaceId: args.workspaceId,
    userId: args.userId,
    alias: trimmed,
    updatedAt: Date.now(),
  });
  return { cleared: false, alias: trimmed };
}

async function setWorkspaceAliasImpl(
  ctx: MutationCtx,
  args: { workspaceId: Id<"workspaces">; alias: string }
) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Unauthorized");
  }
  const workspace = await getWorkspaceIfNotDeleted(ctx, args.workspaceId);
  if (!workspace) {
    throw new Error("Workspace not found");
  }
  const role = await getWorkspaceRole(ctx, workspace, identity.subject);
  // Per-user aliasing is reserved for the workspace's participants
  // (instructor + student). Admins are intentionally excluded so the
  // rename surface cannot be exercised by a platform-wide account
  // that has no business relationship with the workspace.
  if (role !== "instructor" && role !== "student") {
    throw new Error("Not authorized to rename this workspace");
  }
  return await writeAlias(ctx, {
    workspaceId: args.workspaceId,
    userId: identity.subject,
    alias: args.alias,
  });
}

/**
 * Sets or clears the caller's private alias for a workspace.
 *
 * Each participating instructor OR student can rename a workspace
 * they belong to, but the rename is scoped to that user — the other
 * participant's view is unaffected. Pass an empty/whitespace string
 * to clear the alias and revert to the workspace's default `name`.
 * Defaults to the workspace name when no alias row exists for the
 * caller. Platform admins are intentionally rejected; the rename
 * surface is for participants only.
 */
export const setWorkspaceAlias = mutation({
  args: setWorkspaceAliasArgs,
  handler: async (ctx, args) => {
    return await setWorkspaceAliasImpl(ctx, args);
  },
});

/**
 * Internal variant of setWorkspaceAlias for trusted callers
 * (admin scripts, retention re-keys, migrations). Accepts the target
 * `userId` explicitly because server-side internal calls do not
 * carry an end-user identity. Still enforces the participant
 * boundary so a misbehaving caller cannot write aliases for
 * arbitrary userIds.
 */
export const setWorkspaceAliasInternal = internalMutation({
  args: setWorkspaceAliasInternalArgs,
  handler: async (ctx, args) => {
    const workspace = await getWorkspaceIfNotDeleted(ctx, args.workspaceId);
    if (!workspace) {
      throw new Error("Workspace not found");
    }
    const role = await getWorkspaceRole(ctx, workspace, args.userId);
    if (role !== "instructor" && role !== "student") {
      throw new Error("Not authorized to rename this workspace");
    }
    return await writeAlias(ctx, {
      workspaceId: args.workspaceId,
      userId: args.userId,
      alias: args.alias,
    });
  },
});

/** Returns all notes for a workspace. Requires auth. */
export const getWorkspaceNotes = query({
  args: {
    workspaceId: v.id("workspaces"),
    deletedOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return [];
    }

    const workspace = await getWorkspaceIfNotDeleted(ctx, args.workspaceId);
    if (!workspace) {
      return [];
    }

    const role = await getWorkspaceRole(ctx, workspace, user.subject);
    if (!role) {
      return [];
    }

    if (args.deletedOnly) {
      if (role !== "instructor" && role !== "admin") {
        return [];
      }

      return await ctx.db
        .query("workspaceNotes")
        // deletedAt is set with Date.now(); gte(1) selects only defined soft deletes.
        .withIndex("by_workspaceId_and_deletedAt", (q) =>
          q.eq("workspaceId", args.workspaceId).gte("deletedAt", 1)
        )
        .order("desc")
        .collect();
    }

    return await ctx.db
      .query("workspaceNotes")
      .withIndex("by_workspaceId_and_deletedAt", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("deletedAt", undefined)
      )
      .order("asc")
      .collect();
  },
});

/**
 * Metadata-only paginated list of notes for a workspace.
 *
 * PR #convex-egress-2: returns only the fields the Notes list needs
 * (`_id`, `title`, `updatedAt`, `createdBy`, `sessionId`,
 * `isLiveSessionNote`, `deletedAt`) so the large TipTap `content`
 * payload is not re-pushed on every note write. The full content is
 * fetched separately via `getWorkspaceNoteById` when a note is selected.
 *
 * Notes are returned newest-first; the UI can load older notes via the
 * pagination cursor. Callers who are not active participants receive an
 * empty, done page.
 */
export const getWorkspaceNotesPaginated = query({
  args: {
    workspaceId: v.id("workspaces"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return { page: [], continueCursor: "", isDone: true };
    }

    const workspace = await getWorkspaceIfNotDeleted(ctx, args.workspaceId);
    if (!workspace) {
      return { page: [], continueCursor: "", isDone: true };
    }

    const role = await getWorkspaceRole(ctx, workspace, user.subject);
    if (!role) {
      return { page: [], continueCursor: "", isDone: true };
    }

    const result = await ctx.db
      .query("workspaceNotes")
      .withIndex("by_workspaceId_and_deletedAt", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("deletedAt", undefined)
      )
      .order("desc")
      .paginate(args.paginationOpts);

    return {
      ...result,
      page: result.page.map((note) => ({
        _id: note._id,
        title: note.title,
        updatedAt: note.updatedAt,
        createdBy: note.createdBy,
        sessionId: note.sessionId,
        isLiveSessionNote: note.isLiveSessionNote,
        deletedAt: note.deletedAt,
      })),
    };
  },
});

/**
 * Returns the full workspace note for a given ID, including the TipTap
 * `content`. Verifies the caller has access to the note's workspace.
 *
 * PR #convex-egress-2: used by the Notes tab to load the full note body
 * only after the user selects a note from the metadata-only list.
 */
export const getWorkspaceNoteById = query({
  args: { noteId: v.id("workspaceNotes") },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) return null;

    const note = await ctx.db.get(args.noteId);
    if (!note || note.deletedAt) return null;

    const workspace = await getWorkspaceIfNotDeleted(ctx, note.workspaceId);
    if (!workspace) return null;

    const role = await getWorkspaceRole(ctx, workspace, user.subject);
    if (!role) return null;

    return note;
  },
});

/** Creates a new note in a workspace. */
export const createWorkspaceNote = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    title: v.string(),
    content: v.string(),
    // Optional — set when a note is created while a video call is
    // active in the workspace. The Notes tab uses this to render
    // "tagged to current call" affordances and the Notes list filter.
    sessionId: v.optional(v.id("sessions")),
  },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      throw new Error("Unauthorized");
    }

    const workspace = await getWorkspaceIfActive(ctx, args.workspaceId);
    if (!workspace) {
      throw new Error("Workspace not found");
    }

    const role = await getWorkspaceRole(ctx, workspace, user.subject);
    if (!role) {
      throw new Error("Access denied to workspace");
    }

    // PR #4b: reject sessionIds that do not belong to this
    // workspace so a client cannot tag rows to a session the
    // workspace is not associated with.
    await assertSessionBelongsToWorkspace(ctx, args);

    return await ctx.db.insert("workspaceNotes", {
      workspaceId: args.workspaceId,
      title: args.title,
      content: args.content,
      createdBy: user.subject,
      updatedAt: Date.now(),
      sessionId: args.sessionId,
    });
  },
});

/** Updates a workspace note's title, content, and call-tag. */
export const updateWorkspaceNote = mutation({
  args: {
    id: v.id("workspaceNotes"),
    title: v.optional(v.string()),
    content: v.optional(v.string()),
    // Optional — sets the note's `sessionId` to the given session
    // (used by the "Tag to current call" retag button). Always
    // set together with `clearSessionId: false` (or omitted).
    sessionId: v.optional(v.id("sessions")),
    // When true, clears the note's `sessionId` (used by the
    // "Tag to current call" untag toggle in the Notes composer).
    // Boolean instead of `sessionId: null` so callers never have to
    // overload a single optional arg with two distinct meanings.
    clearSessionId: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      throw new Error("Unauthorized");
    }

    const note = await ctx.db.get(args.id);
    if (!note) {
      throw new Error("Note not found");
    }

    const workspace = await getWorkspaceIfNotDeleted(ctx, note.workspaceId);
    if (!workspace) {
      throw new Error("Workspace not found");
    }

    const role = await getWorkspaceRole(ctx, workspace, user.subject);
    if (!role) {
      throw new Error("Access denied to workspace");
    }

    // PR #4b (Greptile R1 P1): the previous handler trusted the
    // client-provided `id` and let any authenticated caller patch any
    // note's title/content/call-tag. After fetching the note, enforce
    // that any retag `sessionId` actually belongs to the note's
    // workspace.
    await assertSessionBelongsToWorkspace(ctx, {
      sessionId: args.sessionId,
      workspaceId: note.workspaceId,
    });

    const { id, clearSessionId, sessionId, ...updates } = args;
    const patch: Record<string, unknown> = { ...updates, updatedAt: Date.now() };
    if (sessionId !== undefined) {
      patch.sessionId = sessionId;
    }
    if (clearSessionId === true) {
      patch.sessionId = undefined;
    }
    await ctx.db.patch(id, patch);
    return await ctx.db.get(id);
  },
});

/** Soft-deletes a workspace note by setting deletedAt. Requires auth and workspace access — anyone in the workspace (instructor or student) can delete any note, including the auto-generated live session notes. Soft-delete is idempotent. */
export const deleteWorkspaceNote = mutation({
  args: { id: v.id("workspaceNotes") },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      throw new Error("Unauthorized");
    }

    const note = await ctx.db.get(args.id);
    if (!note) {
      throw new Error("Note not found");
    }

    const workspace = await getWorkspaceIfNotDeleted(ctx, note.workspaceId);
    if (!workspace) {
      throw new Error("Workspace not found");
    }

    const role = await getWorkspaceRole(ctx, workspace, user.subject);
    if (!role) {
      throw new Error("Not authorized to delete this note");
    }

    await ctx.db.patch(args.id, { deletedAt: Date.now() });
  },
});

/**
 * Creates a comment on a workspace note. Both instructors and
 * students can comment. Requires auth and workspace access.
 *
 * PR workspace-storage-3c: args switched from `storageId` to
 * `b2Key`. Notes are apps/platform-only (apps/web has no notes),
 * so this rename is safe. The `storageId` column on
 * `workspaceNoteComments` is soft-deprecated (kept for symmetry
 * with `workspaceImages` / `workspaceMessages` until a follow-up
 * PR drops it).
 */
export const createNoteComment = mutation({
  args: {
    noteId: v.id("workspaceNotes"),
    content: v.string(),
    b2Key: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      throw new Error("Unauthorized");
    }

    const note = await ctx.db.get(args.noteId);
    if (!note) {
      throw new Error("Note not found");
    }

    const workspace = await ctx.db.get(note.workspaceId);
    if (!workspace) {
      throw new Error("Workspace not found");
    }

    const role = await getWorkspaceRole(ctx, workspace, user.subject);
    if (!role) {
      throw new Error("Not authorized to comment on this note");
    }

    if (args.b2Key !== undefined) {
      await assertB2FileUploadOwnedByCaller(ctx, {
        workspaceId: note.workspaceId,
        b2Key: args.b2Key,
        callerId: user.subject,
      });
    }

    const commentId = await ctx.db.insert("workspaceNoteComments", {
      noteId: args.noteId,
      content: args.content,
      createdBy: user.subject,
      createdAt: Date.now(),
      b2Key: args.b2Key,
    });

    return commentId;
  },
});

/** Soft-deletes a note comment by setting deletedAt. Only the comment author can delete their own comment. Requires auth and workspace access. */
export const deleteNoteComment = mutation({
  args: { id: v.id("workspaceNoteComments") },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      throw new Error("Unauthorized");
    }

    const comment = await ctx.db.get(args.id);
    if (!comment) {
      throw new Error("Comment not found");
    }

    const note = await ctx.db.get(comment.noteId);
    if (!note) {
      throw new Error("Note not found");
    }

    const workspace = await ctx.db.get(note.workspaceId);
    if (!workspace) {
      throw new Error("Workspace not found");
    }

    const role = await getWorkspaceRole(ctx, workspace, user.subject);
    if (!role) {
      throw new Error("Not authorized to delete comments on this note");
    }

    if (comment.createdBy !== user.subject) {
      throw new Error("You can only delete your own comments");
    }

    await ctx.db.patch(args.id, { deletedAt: Date.now() });
  },
});

/** Returns all non-deleted comments for a workspace note, ordered by creation time. Requires auth and workspace access. */
export const getNoteComments = query({
  args: { noteId: v.id("workspaceNotes") },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return [];
    }

    const note = await ctx.db.get(args.noteId);
    if (!note) {
      return [];
    }

    const workspace = await ctx.db.get(note.workspaceId);
    if (!workspace) {
      return [];
    }

    const role = await getWorkspaceRole(ctx, workspace, user.subject);
    if (!role) {
      return [];
    }

    const comments = await ctx.db
      .query("workspaceNoteComments")
      .withIndex("by_noteId", (q) => q.eq("noteId", args.noteId))
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .order("asc")
      .collect();

    // PR workspace-storage-3c (Greptile P1 "Comment attachments
    // disappear"): resolve each comment attachment's B2 key
    // server-side. Pre-3c UI used `comment.imageUrl` directly
    // (which is empty for B2 rows), so attachments rendered as
    // broken images / missing buttons. Resolve once per query,
    // re-use the map across all comments.
    const b2Keys = comments
      .map((c) => c.b2Key)
      .filter((k): k is string => typeof k === "string");
    const urlMap = new Map<string, string>();
    if (b2Keys.length > 0) {
      const resolved = await ctx.runQuery(
        internal.workspaceStorage.resolveWorkspaceB2FileUploadsForKeys,
        { workspaceId: note.workspaceId, b2Keys }
      );
      for (const r of resolved) {
        if (r.ok) urlMap.set(r.b2Key, r.url);
      }
    }

    const authorDisplayNames = await resolveAuthorDisplayNames(
      ctx,
      workspace,
      comments.map((comment) => ({ userId: comment.createdBy }))
    );
    return comments.map((comment) => ({
      ...comment,
      authorDisplayName: authorDisplayNames.get(comment.createdBy) ?? "Student",
      // B2 attachments expose the resolved URL via
      // `attachmentUrl` (separate from the legacy `imageUrl`
      // field which apps/web used and is empty for B2 rows).
      attachmentUrl: comment.b2Key
        ? urlMap.get(comment.b2Key) ?? null
        : null,
    }));
  },
});

/** Embeds an image into a workspace note. Creates a workspaceImage record and updates the note's imageUrl field. Enforces instructor image caps. Requires instructor or admin role. */
export const embedImageInNote = mutation({
  args: {
    noteId: v.id("workspaceNotes"),
    // PR workspace-storage-3c: was `storageId: v.id("_storage")` and
    // minted a `ctx.storage.getUrl` after the Convex storage insert.
    // Now the upload path is B2 — the caller mints a presigned PUT
    // URL via `workspaceStorage.generateWorkspaceUploadUrl`, the
    // upload is recorded via `recordB2FileUpload`, and the
    // resulting `b2Key` is passed in here. The UI resolves the
    // `b2Key` to a signed GET URL at render time via
    // `useWorkspaceImageUrl` (apps/platform) / `imageUrl` URL field.
    b2Key: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      throw new Error("Unauthorized");
    }

    const note = await ctx.db.get(args.noteId);
    if (!note) {
      throw new Error("Note not found");
    }

    const workspace = await ctx.db.get(note.workspaceId);
    if (!workspace) {
      throw new Error("Workspace not found");
    }

    const role = await getWorkspaceRole(ctx, workspace, user.subject);
    if (role !== "instructor" && role !== "admin") {
      throw new Error("Only instructors and admins can embed images in notes");
    }

    // PR workspace-storage-3c: gate on the B2 upload ledger so a
    // participant cannot pass an unrelated `b2Key` (Greptile
    // Security P1). The ledger row is created when
    // `workspaceStorage.recordB2FileUpload` runs (after the PUT
    // succeeds). The returned row also lets us verify the
    // content type is actually an image (Greptile P1 round 4:
    // "Image limits can be bypassed").
    const ledger = await assertB2FileUploadOwnedByCaller(ctx, {
      workspaceId: note.workspaceId,
      b2Key: args.b2Key,
      callerId: user.subject,
    });
    if (
      ledger.contentType !== undefined &&
      !ledger.contentType.toLowerCase().startsWith("image/")
    ) {
      throw new Error(
        "Only image files can be embedded in notes. Use the file share for other types."
      );
    }

    const isAdmin = role === "admin";
    const currentCount = isAdmin
      ? await countActiveWorkspaceImages(ctx, note.workspaceId)
      : (workspace.instructorImageCount ?? 0);
    const cap = isAdmin ? WORKSPACE_IMAGE_CAPS.admin : WORKSPACE_IMAGE_CAPS.instructor;

    if (currentCount >= cap) {
      throw new Error(`Image limit reached (${cap} images allowed)`);
    }

    // PR workspace-storage-3c: the row stores the `b2Key` directly;
    // the UI resolves it to a signed GET URL via
    // `getWorkspaceDownloadUrl` at render time. We still write a
    // placeholder into `imageUrl` for backward compat with apps/web
    // and any consumers that read `imageUrl` directly. `imageUrl`
    // is left empty for B2 rows — UI consumers must check `b2Key`
    // first.
    await ctx.db.insert("workspaceImages", {
      workspaceId: note.workspaceId,
      imageUrl: "",
      b2Key: args.b2Key,
      createdBy: user.subject,
    });

    await ctx.db.patch(note.workspaceId, {
      instructorImageCount: (workspace.instructorImageCount ?? 0) + 1,
    });

    await ctx.db.patch(args.noteId, {
      imageUrl: "",
      updatedAt: Date.now(),
    });

    return args.b2Key;
  },
});

/**
 * Returns all links for a workspace.
 * Returns an empty array for callers who are not active participants.
 */
export const getWorkspaceLinks = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    const result = await getCallerWorkspaceRole(ctx, args.workspaceId);
    if (!result) {
      return [];
    }
    return await ctx.db
      .query("workspaceLinks")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();
  },
});

/**
 * Paginated links for a workspace.
 *
 * PR #convex-egress-3: returns only non-deleted links, newest first,
 * so the Links tab does not re-push the full workspace link array on
 * every create/delete. The legacy {@link getWorkspaceLinks} remains
 * for apps/web.
 */
export const getWorkspaceLinksPaginated = query({
  args: {
    workspaceId: v.id("workspaces"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const result = await getCallerWorkspaceRole(ctx, args.workspaceId);
    if (!result) {
      return { page: [], continueCursor: "", isDone: true };
    }
    return await ctx.db
      .query("workspaceLinks")
      .withIndex("by_workspaceId_and_deletedAt", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("deletedAt", undefined)
      )
      .order("desc")
      .paginate(args.paginationOpts);
  },
});

/**
 * PR #4c-3: returns links tagged to the currently active call
 * (`sessionId` set + non-deleted) for the given workspace. Drives
 * the "Shared during current call" subpanel in the Links tab while
 * a video call is in progress.
 *
 * Why a new query instead of reusing `getWorkspaceLinks`:
 * 1. **Indexed.** Uses the existing `by_workspaceId_sessionId` index
 *    (added in PR #4b) so the read is O(matched links), not
 *    O(workspace links). For a typical call this is single-digit rows.
 * 2. **Auth bound to the session, not the workspace.**
 *    `assertParticipantForSession` rejects callers who supply a
 *    valid-looking `sessionId` that doesn't belong to a workspace
 *    they're a participant on — the same anti-leakage shape used by
 *    `getCallRecordingsForWorkspace` (PR #4c-1) and every
 *    PR #4b write path. A token from a different workspace that
 *    passes `getWorkspaceLinks` auth (participant on workspace X)
 *    cannot pass this query's auth (non-participant on session Y).
 * 3. **No fallback to call-window timestamps.** Pre-PR #4b links
 *    have `sessionId === undefined` and would not match the index.
 *    Documented limitation: links posted before the sessionId
 *    feature shipped cannot appear in this subpanel even if their
 *    `createdAt` overlaps a call window. Resurfacing them would
 *    require a backfill or a window-bounded scan — out of scope.
 *
 * Returned shape matches `getWorkspaceLinks` so callers can use
 * the same row type in the Links list and the subpanel.
 */
export const getSharedLinksForActiveSession = query({
  args: {
    workspaceId: v.id("workspaces"),
    sessionId: v.id("sessions"),
  },
  handler: async (ctx, args) => {
    // Greptile R1 P2: cross-check the supplied workspaceId against
    // the workspace the session actually belongs to. `assertParticipantForSession`
    // returns `{ session, workspace }` from the session's own
    // instructorId/ownerId lookup; if `args.workspaceId` does not
    // match that workspace, the caller has passed a mismatched id
    // (e.g. an old cached value from a workspace switch). Reject
    // explicitly so a misuse surfaces as an error rather than a
    // silent empty result.
    const { workspace } = await assertParticipantForSession(ctx, args);
    if (workspace._id !== args.workspaceId) {
      throw new Error("Workspace does not match this session");
    }

    const rows = await ctx.db
      .query("workspaceLinks")
      .withIndex("by_workspaceId_sessionId", (q) =>
        q
          .eq("workspaceId", args.workspaceId)
          .eq("sessionId", args.sessionId)
      )
      .collect();

    return rows
      .filter((r) => r.deletedAt === undefined)
      .sort((a, b) => b._creationTime - a._creationTime);
  },
});

/** Creates a new link in a workspace. */
export const createWorkspaceLink = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    url: v.string(),
    title: v.optional(v.string()),
    // Optional — set when a link is shared while a video call is
    // active in the workspace. Future PR surfaces this as a
    // "Shared during current call" subpanel in the Links tab.
    sessionId: v.optional(v.id("sessions")),
  },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      throw new Error("Unauthorized");
    }

    const workspace = await getWorkspaceIfActive(ctx, args.workspaceId);
    if (!workspace) {
      throw new Error("Workspace not found");
    }

    const role = await getWorkspaceRole(ctx, workspace, user.subject);
    if (!role) {
      throw new Error("Access denied to workspace");
    }

    // PR #4b: reject sessionIds that do not belong to this
    // workspace.
    await assertSessionBelongsToWorkspace(ctx, args);

    return await ctx.db.insert("workspaceLinks", {
      workspaceId: args.workspaceId,
      url: args.url,
      title: args.title,
      createdBy: user.subject,
      sessionId: args.sessionId,
    });
  },
});

/** Soft-deletes a workspace link by setting deletedAt. Any active participant can delete links. */
export const deleteWorkspaceLink = mutation({
  args: { id: v.id("workspaceLinks") },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      throw new Error("Unauthorized");
    }

    const link = await ctx.db.get(args.id);
    if (!link) {
      throw new Error("Link not found");
    }

    const workspace = await getWorkspaceIfNotDeleted(ctx, link.workspaceId);
    if (!workspace) {
      throw new Error("Workspace not found");
    }

    const role = await getWorkspaceRole(ctx, workspace, user.subject);
    if (role === "admin" || role === "instructor" || role === "student") {
      await ctx.db.patch(args.id, { deletedAt: Date.now() });
    } else {
      throw new Error("Access denied");
    }
  },
});

/** Returns images for a workspace, filtered by role (instructors see all, students see own and instructor's). Requires auth. */
export const getWorkspaceImages = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return [];
    }
    const workspace = await getWorkspaceIfNotDeleted(ctx, args.workspaceId);
    if (!workspace) {
      return [];
    }
    const role = await getWorkspaceRole(ctx, workspace, user.subject);
    if (!role) {
      return [];
    }
    const images = await ctx.db
      .query("workspaceImages")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();

    // PR workspace-storage-3c (Greptile P1 "Gallery URLs never
    // appear"): resolve every B2 key server-side in a single
    // batched internal query. Legacy rows still call
    // `ctx.storage.getUrl`. The 1-hour TTL matches the gallery's
    // scroll-session lifetime; the UI hook refreshes proactively
    // when the cached URL is within 5 minutes of expiry.
    const b2Keys = images
      .map((img) => img.b2Key)
      .filter((k): k is string => typeof k === "string");
    const urlMap = new Map<string, string>();
    if (b2Keys.length > 0) {
      const resolved = await ctx.runQuery(
        internal.workspaceStorage.resolveWorkspaceB2FileUploadsForKeys,
        { workspaceId: args.workspaceId, b2Keys }
      );
      for (const r of resolved) {
        if (r.ok) urlMap.set(r.b2Key, r.url);
      }
    }

    const imagesWithUrls = await Promise.all(
      images.map(async (img) => {
        if (img.b2Key !== undefined) {
          return { ...img, imageUrl: urlMap.get(img.b2Key) ?? "" };
        }
        let imageUrl = img.imageUrl;
        if (img.storageId) {
          const url = await ctx.storage.getUrl(img.storageId as Id<"_storage">);
          if (url) {
            imageUrl = url;
          }
        }
        return { ...img, imageUrl };
      })
    );

    // Newest first so the Images tab shows the most recent uploads
    // without needing a client-side sort. `_creationTime` is a system
    // field populated by Convex at insert time, so this is monotonic.
    imagesWithUrls.sort((a, b) => b._creationTime - a._creationTime);

    if (role === "instructor") {
      return imagesWithUrls;
    }

    if (!workspace.instructorId) {
      return imagesWithUrls.filter((img) => img.createdBy === user.subject);
    }

    const instructor = await ctx.db.get(workspace.instructorId);
    const instructorUserId = instructor?.userId;

    return imagesWithUrls.filter(
      (img) => img.createdBy === user.subject || img.createdBy === instructorUserId
    );
  },
});

/**
 * Paginated images for a workspace, newest first.
 *
 * PR #convex-egress-3: returns only non-deleted images, generates
 * signed URLs only for the visible page, and applies the same role
 * filter as {@link getWorkspaceImages}. The legacy `getWorkspaceImages`
 * remains for apps/web.
 *
 * Optional `uploadedBy` filter narrows results to a specific uploader role:
 * `me`, `instructor`, or `student`. The result includes a `uploaderRole`
 * label so the Images tab can display each image's source without an
 * extra round-trip.
 */
export const getWorkspaceImagesPaginated = query({
  args: {
    workspaceId: v.id("workspaces"),
    paginationOpts: paginationOptsValidator,
    uploadedBy: v.optional(
      v.union(
        v.literal("all"),
        v.literal("me"),
        v.literal("instructor"),
        v.literal("student")
      )
    ),
  },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return { page: [], continueCursor: "", isDone: true };
    }
    const workspace = await getWorkspaceIfNotDeleted(ctx, args.workspaceId);
    if (!workspace) {
      return { page: [], continueCursor: "", isDone: true };
    }
    const role = await getWorkspaceRole(ctx, workspace, user.subject);
    if (!role) {
      return { page: [], continueCursor: "", isDone: true };
    }

    const uploadedBy = args.uploadedBy ?? "all";
    const numRequested = args.paginationOpts.numItems as number;
    const instructor = workspace.instructorId
      ? await ctx.db.get(workspace.instructorId)
      : null;
    const instructorUserId = instructor?.userId;

    const uploaderRoleCache = new Map<
      string,
      "instructor" | "student" | "admin" | "other"
    >();
    const resolveUploaderRole = async (
      createdBy: string
    ): Promise<"instructor" | "student" | "admin" | "other"> => {
      if (createdBy === user.subject) return role;
      if (createdBy === instructorUserId) return "instructor";
      const cached = uploaderRoleCache.get(createdBy);
      if (cached) return cached;
      const r = await getWorkspaceRole(ctx, workspace, createdBy);
      const resolved = r ?? "other";
      uploaderRoleCache.set(createdBy, resolved);
      return resolved;
    };

    const isVisible = async (img: Doc<"workspaceImages">): Promise<boolean> => {
      // Non-instructors only see their own images and the instructor's images.
      if (role !== "instructor") {
        if (img.createdBy !== user.subject && img.createdBy !== instructorUserId) {
          return false;
        }
      }

      if (uploadedBy === "all") return true;
      if (uploadedBy === "me") return img.createdBy === user.subject;
      const r = await resolveUploaderRole(img.createdBy);
      return r === uploadedBy;
    };

    const filterVisible = async (
      images: Doc<"workspaceImages">[]
    ): Promise<Doc<"workspaceImages">[]> => {
      const visible: Doc<"workspaceImages">[] = [];
      for (const img of images) {
        if (await isVisible(img)) visible.push(img);
      }
      return visible;
    };

    let result = await ctx.db
      .query("workspaceImages")
      .withIndex("by_workspaceId_and_deletedAt", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("deletedAt", undefined)
      )
      .order("desc")
      .paginate(args.paginationOpts);

    let visiblePage = await filterVisible(result.page);

    // Because the caller role and uploader filter are not part of the index,
    // keep fetching pages until we fill the requested page size or exhaust the
    // index. Cap the number of pages to prevent runaway scans.
    if (role !== "instructor" || uploadedBy !== "all") {
      const maxPages = 10;
      let pagesFetched = 1;
      while (
        visiblePage.length < numRequested &&
        !result.isDone &&
        pagesFetched < maxPages
      ) {
        result = await ctx.db
          .query("workspaceImages")
          .withIndex("by_workspaceId_and_deletedAt", (q) =>
            q.eq("workspaceId", args.workspaceId).eq("deletedAt", undefined)
          )
          .order("desc")
          .paginate({
            numItems: numRequested - visiblePage.length,
            cursor: result.continueCursor,
          });
        const nextPage = await filterVisible(result.page);
        visiblePage = [...visiblePage, ...nextPage];
        pagesFetched += 1;
      }
    }

    // PR workspace-storage-3c (Greptile P1 "Gallery URLs never
    // appear"): resolve B2 keys server-side in one batched call so
    // the first page render already has URLs. The same map is
    // reused by the next page's resolution on subsequent paginate
    // requests via the per-call scope here (callers re-issue this
    // query on page change).
    const b2Keys = visiblePage
      .map((img) => img.b2Key)
      .filter((k): k is string => typeof k === "string");
    const urlMap = new Map<string, string>();
    if (b2Keys.length > 0) {
      const resolved = await ctx.runQuery(
        internal.workspaceStorage.resolveWorkspaceB2FileUploadsForKeys,
        { workspaceId: args.workspaceId, b2Keys }
      );
      for (const r of resolved) {
        if (r.ok) urlMap.set(r.b2Key, r.url);
      }
    }

    const imagesWithUrls = await Promise.all(
      visiblePage.map(async (img) => {
        if (img.b2Key !== undefined) {
          return {
            ...img,
            imageUrl: urlMap.get(img.b2Key) ?? "",
            uploaderRole: await resolveUploaderRole(img.createdBy),
          };
        }
        let imageUrl = img.imageUrl;
        if (img.storageId) {
          const url = await ctx.storage.getUrl(img.storageId as Id<"_storage">);
          if (url) {
            imageUrl = url;
          }
        }
        return {
          ...img,
          imageUrl,
          uploaderRole: await resolveUploaderRole(img.createdBy),
        };
      })
    );

    return {
      page: imagesWithUrls,
      continueCursor: result.continueCursor,
      isDone: result.isDone,
    };
  },
});

/**
 * Creates an image in a workspace, enforcing role-based upload
 * caps. Requires auth.
 *
 * PR workspace-storage-3c: accepts EITHER `storageId` (the legacy
 * Convex-storage path that `apps/web` still uses) OR `b2Key` (the
 * new B2 path that `apps/platform` uses after the cutover flag
 * flips). Exactly one must be set. The schema fields are separate
 * optional columns (`workspaceImages.storageId`,
 * `workspaceImages.b2Key`) so a single mutation can write either
 * kind of row.
 */
export const createWorkspaceImage = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    imageUrl: v.string(),
    // Legacy Convex-storage path (apps/web). Soft-deprecated in
    // PR 3c — see the schema field comment on `workspaceImages`.
    storageId: v.optional(v.string()),
    // New B2 path (apps/platform). After PR 3c flips the cutover
    // flag, every new write goes here.
    b2Key: v.optional(v.string()),
    // Optional — set when an image is uploaded while a video call
    // is active in the workspace. Carried through from
    // `uploadSingleImage` and the "Paste from clipboard" paste
    // handler on the Images tab.
    sessionId: v.optional(v.id("sessions")),
  },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      throw new Error("Unauthorized");
    }

    if (args.storageId === undefined && args.b2Key === undefined) {
      throw new Error("Either storageId or b2Key must be provided");
    }
    if (args.storageId !== undefined && args.b2Key !== undefined) {
      throw new Error("Provide storageId OR b2Key, not both");
    }

    const workspace = await getWorkspaceIfActive(ctx, args.workspaceId);
    if (!workspace) {
      throw new Error("Workspace not found");
    }

    const role = await getWorkspaceRole(ctx, workspace, user.subject);
    if (!role) {
      throw new Error("Not authorized to add images to this workspace");
    }

    // PR #4b: reject sessionIds that do not belong to this
    // workspace.
    await assertSessionBelongsToWorkspace(ctx, args);

    // PR workspace-storage-3c: gate the B2 path on the upload
    // ledger (same security shape as `createWorkspaceImageAndMessage`).
    let ledgerContentType: string | undefined;
    if (args.b2Key !== undefined) {
      const ledger = await assertB2FileUploadOwnedByCaller(ctx, {
        workspaceId: args.workspaceId,
        b2Key: args.b2Key,
        callerId: user.subject,
      });
      ledgerContentType = ledger.contentType;
    }

    // PR workspace-storage-3c (Greptile round 4 P1, confidence
    // 0/5, "Image limits can be bypassed"): a non-image upload
    // (e.g. a PDF, video) was able to consume an image slot via
    // the B2 path because the pre-3c mutation only enforced the
    // cap, not the content type. The ledger now persists
    // `contentType` (the value used to mint the B2 PUT
    // signature, which B2 enforces on the actual PUT). Reject
    // any non-image content type before counting toward the
    // image cap.
    if (
      args.b2Key !== undefined &&
      ledgerContentType !== undefined &&
      !ledgerContentType.toLowerCase().startsWith("image/")
    ) {
      throw new Error(
        "Only image files can be uploaded to the image gallery. Use the file share for other types."
      );
    }

    const isStudent = role === "student";
    const isAdmin = role === "admin";
    const studentCount = (workspace as any).studentImageCount ?? 0;
    const adminCount = isAdmin ? await countActiveWorkspaceImages(ctx, args.workspaceId) : 0;
    const currentCount = isStudent
      ? studentCount
      : isAdmin
        ? adminCount
        : (workspace.instructorImageCount ?? 0);
    const cap = isStudent
      ? WORKSPACE_IMAGE_CAPS.student
      : isAdmin
        ? WORKSPACE_IMAGE_CAPS.admin
        : WORKSPACE_IMAGE_CAPS.instructor;

    if (currentCount >= cap) {
      throw new Error(
        `Image limit reached (${cap} ${role} images allowed per workspace)`
      );
    }

    const imageId = await ctx.db.insert("workspaceImages", {
      workspaceId: args.workspaceId,
      imageUrl: args.imageUrl,
      storageId: args.storageId,
      b2Key: args.b2Key,
      createdBy: user.subject,
      sessionId: args.sessionId,
    });

    const nextStudentCount = isStudent ? studentCount + 1 : studentCount;
    await ctx.db.patch(args.workspaceId, {
      studentImageCount: nextStudentCount,
      instructorImageCount: role === "instructor"
        ? (workspace.instructorImageCount ?? 0) + 1
        : workspace.instructorImageCount ?? 0,
    });

    return imageId;
  },
});

/**
 * Records the binding between a freshly uploaded storage blob and
 * the caller + workspace. The client calls this immediately after
 * the upload completes and before passing the storage id to
 * {@link createWorkspaceImageAndMessage} / {@link createWorkspaceFileMessage}.
 *
 * The binding is what prevents a workspace participant from passing
 * an unrelated blob's storage id to the create mutations (Greptile
 * Security P1). Convex storage does not track the uploader itself,
 * so we maintain a `fileUploads` ledger row per upload that ties
 * the storage id to the authenticated user + workspace. The create
 * mutations refuse to write a chat row whose storage id has no
 * matching ledger row.
 *
 * Auth required. Caller must be a member of the workspace. The
 * storage id must exist in Convex storage and must not already be
 * bound (one blob cannot be claimed twice).
 */
export const recordFileUpload = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      throw new Error("Unauthorized");
    }

    const workspace = await getWorkspaceIfActive(ctx, args.workspaceId);
    if (!workspace) {
      throw new Error("Workspace not found");
    }

    const role = await getWorkspaceRole(ctx, workspace, user.subject);
    if (!role) {
      throw new Error("Not authorized to upload files to this workspace");
    }

    const metadata = await ctx.db.system.get("_storage", args.storageId);
    if (!metadata) {
      throw new Error("Uploaded file not found in storage");
    }

    // PR #B Greptile Security P1 (round 7): reject bindings to
    // blobs that were not uploaded very recently. The ledger
    // alone cannot prove ownership (the caller could pass an
    // unrelated, previously-unbound storage id they discovered
    // through a chat URL). We bound the attack window by
    // requiring the blob's storage `_creationTime` to be within
    // `MAX_BINDING_AGE_MS` of now. The client calls
    // recordFileUpload immediately after the upload returns, so
    // a legitimate binding is well under this threshold. Note:
    // Convex storage metadata exposes `_creationTime`, not
    // `uploadedAt` — see `ctx.db.system.get("_storage", ...)`.
    const ageMs = Date.now() - metadata._creationTime;
    if (ageMs < 0 || ageMs > MAX_BINDING_AGE_MS) {
      throw new Error(
        "Storage id cannot be bound: the upload is too old. Re-upload the file and try again."
      );
    }

    const existing = await ctx.db
      .query("fileUploads")
      .withIndex("by_storageId", (q) => q.eq("storageId", args.storageId))
      .first();
    if (existing) {
      // A second uploader trying to claim the same blob is treated as
      // a binding conflict: the first claim wins, and the second is
      // rejected. This is what makes the binding non-replayable.
      throw new Error("Storage id is already bound to an upload");
    }

    await ctx.db.insert("fileUploads", {
      storageId: args.storageId,
      uploaderId: user.subject,
      workspaceId: args.workspaceId,
      uploadedAt: Date.now(),
    });
  },
});

/**
 * Creates an image in a workspace AND a chat message with the image
 * reference. Enforces role-based upload caps. Requires auth.
 *
 * PR workspace-storage-3c: takes a B2 key (was a Convex storage id).
 * The chat message `content` stores the `b2Key` for B2 rows (was a
 * resolved URL for legacy rows). The UI resolver hook converts
 * `b2Key` → signed GET URL at render time, so a chat history query
 * can render images without round-tripping to Convex for every
 * message.
 */
export const createWorkspaceImageAndMessage = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    b2Key: v.string(),
    // Optional — when set, the sessionId is written to BOTH the
    // `workspaceImages` row and the chat `workspaceMessages` row so
    // the same call surfaces consistently in both tabs.
    sessionId: v.optional(v.id("sessions")),
  },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      throw new Error("Unauthorized");
    }

    const workspace = await getWorkspaceIfActive(ctx, args.workspaceId);
    if (!workspace) {
      throw new Error("Workspace not found");
    }

    const role = await getWorkspaceRole(ctx, workspace, user.subject);
    if (!role) {
      throw new Error("Not authorized to add images to this workspace");
    }

    // PR #4b: reject sessionIds that do not belong to this
    // workspace. The same `sessionId` is written to BOTH the
    // `workspaceImages` row and the chat `workspaceMessages` row.
    await assertSessionBelongsToWorkspace(ctx, args);

    // PR workspace-storage-3c: gate on the B2 upload ledger so a
    // participant cannot pass an unrelated `b2Key` (Greptile
    // Security P1).
    await assertB2FileUploadOwnedByCaller(ctx, {
      workspaceId: args.workspaceId,
      b2Key: args.b2Key,
      callerId: user.subject,
    });

    const isStudent = role === "student";
    const isAdmin = role === "admin";
    const studentCount = (workspace as any).studentImageCount ?? 0;
    const adminCount = isAdmin ? await countActiveWorkspaceImages(ctx, args.workspaceId) : 0;
    const currentCount = isStudent
      ? studentCount
      : isAdmin
        ? adminCount
        : (workspace.instructorImageCount ?? 0);
    const cap = isStudent
      ? WORKSPACE_IMAGE_CAPS.student
      : isAdmin
        ? WORKSPACE_IMAGE_CAPS.admin
        : WORKSPACE_IMAGE_CAPS.instructor;

    if (currentCount >= cap) {
      throw new Error(
        `Image limit reached (${cap} ${role} images allowed per workspace)`
      );
    }

    const imageId = await ctx.db.insert("workspaceImages", {
      workspaceId: args.workspaceId,
      imageUrl: "",
      b2Key: args.b2Key,
      createdBy: user.subject,
      sessionId: args.sessionId,
    });

    const nextStudentCount = isStudent ? studentCount + 1 : studentCount;
    await ctx.db.patch(args.workspaceId, {
      studentImageCount: nextStudentCount,
      instructorImageCount: role === "instructor"
        ? (workspace.instructorImageCount ?? 0) + 1
        : workspace.instructorImageCount ?? 0,
    });

    let senderRole: "instructor" | "student" | "admin" | undefined;
    if (isAdmin) {
      senderRole = "admin";
    } else if (role === "instructor") {
      senderRole = "instructor";
    } else {
      senderRole = "student";
    }

    await ctx.db.insert("workspaceMessages", {
      workspaceId: args.workspaceId,
      userId: user.subject,
      // PR workspace-storage-3c: the chat message stores the
      // `b2Key`; the UI resolves it to a signed GET URL at render
      // time via `getWorkspaceDownloadUrl`. Legacy rows stored
      // `ctx.storage.getUrl(...)` URLs directly — UI checks for
      // the URL prefix (`https://`) to distinguish.
      content: args.b2Key,
      type: "image",
      senderRole,
      sessionId: args.sessionId,
      b2Key: args.b2Key,
    });

    return imageId;
  },
});

/** Returns workspace notes and images for export. Requires auth. */
export const getWorkspaceExportData = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    const result = await getCallerWorkspaceRole(ctx, args.workspaceId);
    if (!result) {
      return null;
    }

    const { workspace } = result;

    const notes = await ctx.db
      .query("workspaceNotes")
      .withIndex("by_workspaceId_and_deletedAt", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("deletedAt", undefined)
      )
      .collect();

    const images = await ctx.db
      .query("workspaceImages")
      .withIndex("by_workspaceId_and_deletedAt", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("deletedAt", undefined)
      )
      .collect();

    // PR workspace-storage-3c (Greptile P1 "Exports omit B2 images"):
    // resolve every B2 key server-side. The export trigger task
    // downloads each `imageUrl` via the wrapped Trigger.dev
    // download host and zips them — passing a `b2Key` literal as
    // the URL made the trigger's HTTP fetch return the key string
    // instead of the actual image. Resolve here so the trigger
    // receives a real signed URL.
    const b2Keys = images
      .map((img) => img.b2Key)
      .filter((k): k is string => typeof k === "string");
    const urlMap = new Map<string, string>();
    if (b2Keys.length > 0) {
      const resolved = await ctx.runQuery(
        internal.workspaceStorage.resolveWorkspaceB2FileUploadsForKeys,
        { workspaceId: args.workspaceId, b2Keys }
      );
      for (const r of resolved) {
        if (r.ok) urlMap.set(r.b2Key, r.url);
      }
    }

    const imagesWithUrls = await Promise.all(
      images.map(async (img) => {
        let imageUrl: string | undefined;
        if (img.b2Key !== undefined) {
          imageUrl = urlMap.get(img.b2Key);
        } else if (img.storageId) {
          imageUrl = (await ctx.storage.getUrl(img.storageId as Id<"_storage">)) ?? undefined;
        } else {
          imageUrl = img.imageUrl;
        }
        // The export trigger task requires a real URL; if the
        // ledger lookup missed (cancelled / never-completed),
        // surface `null` so the trigger task skips this image
        // rather than embedding a broken entry. The trigger task
        // reads `imageUrl` directly, so keep the field name
        // stable across legacy + B2 rows.
        return {
          imageUrl: imageUrl ?? null,
          b2Key: img.b2Key,
          storageId: img.storageId,
          createdBy: img.createdBy,
          createdAt: img._creationTime,
        };
      })
    );

    return {
      workspaceName: workspace.name || "Workspace",
      notes: notes.map((n) => ({
        title: n.title,
        content: n.content,
        updatedAt: n.updatedAt,
      })),
      images: imagesWithUrls,
    };
  },
});

/** Soft-deletes a workspace image and decrements the role-based image counter. */
export const deleteWorkspaceImage = mutation({
  args: { id: v.id("workspaceImages") },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      throw new Error("Unauthorized");
    }

    const image = await ctx.db.get(args.id);
    if (!image) return;

    const { role, workspace } = await requireCallerWorkspaceRole(ctx, image.workspaceId);
    if (role !== "admin" && role !== "instructor" && image.createdBy !== user.subject) {
      throw new Error("Access denied");
    }

    await ctx.db.patch(args.id, { deletedAt: Date.now() });

    // Derive the creator's role at deletion time using the same helper
    // used during creation. This correctly handles admin workspaces
    // where the owner is an admin (not a student).
    const imageCreatorRole = await getWorkspaceRole(ctx, workspace, image.createdBy);
    if (imageCreatorRole === "student") {
      const cur = workspace.studentImageCount ?? 0;
      await ctx.db.patch(workspace._id, {
        studentImageCount: Math.max(0, cur - 1),
      });
    } else if (imageCreatorRole === "instructor") {
      await ctx.db.patch(workspace._id, {
        instructorImageCount: Math.max(0, (workspace.instructorImageCount ?? 0) - 1),
      });
    }
  },
});

/**
 * Soft-deletes a chat file or image message uploaded via the workspace
 * chat input. Sets `deletedAt`; the storage blob and row are hard-deleted
 * by `hardDeleteExpiredChatFiles` after
 * `CHAT_FILE_RETENTION_DAYS`. The cap check
 * (`createWorkspaceFileMessage` / `createWorkspaceImageAndMessage`) is
 * re-evaluated against `countWorkspaceFilesByRole`, which now filters
 * out soft-deleted messages, so freeing a slot takes effect immediately.
 *
 * Auth: admin, the workspace instructor, or the original uploader.
 * Idempotent: a no-op if the message is already soft-deleted or is not
 * a `type: "file"` / `"image"` message (we deliberately don't allow
 * text messages to be "deleted" — those are part of the audit trail
 * for the mentorship record).
 */
export const deleteWorkspaceFileMessage = mutation({
  args: { id: v.id("workspaceMessages") },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      throw new Error("Unauthorized");
    }

    const message = await ctx.db.get(args.id);
    if (!message) return;
    if (message.type !== "file" && message.type !== "image") {
      throw new Error("Only file or image messages can be deleted via this mutation.");
    }
    if (message.deletedAt !== undefined) return;

    const { role } = await requireCallerWorkspaceRole(ctx, message.workspaceId);
    const canDelete =
      role === "admin" ||
      role === "instructor" ||
      message.userId === user.subject;
    if (!canDelete) {
      throw new Error("Only the uploader, the instructor, or an admin can delete this file.");
    }

    await ctx.db.patch(args.id, { deletedAt: Date.now() });
  },
});

/**
 * Restores a soft-deleted file/image message within the
 * {@link CHAT_FILE_RETENTION_MS} grace window. Used by the admin
 * recovery flow promised by {@link DeleteChatFileDialog}: an admin
 * can re-open a deleted file before the daily retention cron
 * hard-deletes the blob.
 *
 * Auth: admin only. Backed by the same soft-delete index
 * (`by_deletedAt`) so the lookup is cheap.
 *
 * Idempotent: a no-op when `deletedAt` is already undefined.
 */
export const restoreWorkspaceFileMessage = mutation({
  args: { id: v.id("workspaceMessages") },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      throw new Error("Unauthorized");
    }

    const existing = await ctx.db.get(args.id);
    if (!existing) return;

    const { role } = await requireCallerWorkspaceRole(ctx, existing.workspaceId);
    if (role !== "admin") {
      throw new Error("Only admins can restore deleted chat files.");
    }

    if (existing.deletedAt === undefined) return;
    // PR #B: refuse to clear `deletedAt = -1`, which is the
    // retention cron's in-flight claim sentinel
    // (`convex/cleanup/chatFileRetention.ts:CLAIM_SENTINEL`).
    // Clearing the sentinel would let a restored message outlive
    // its deleted blob once the action runs `ctx.storage.delete`.
    if ((existing.deletedAt as number) < 0) return;
    await ctx.db.patch(args.id, { deletedAt: undefined });
  },
});

/**
 * Returns all messages for a workspace in chronological order.
 * Returns an empty array for callers who are not active participants.
 *
 * @deprecated Use {@link getWorkspaceMessagesPaginated} for new code;
 *   kept for apps/web which has not yet been migrated.
 */
export const getWorkspaceMessages = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    const result = await getCallerWorkspaceRole(ctx, args.workspaceId);
    if (!result) {
      return [];
    }
    const messages = await ctx.db
      .query("workspaceMessages")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", args.workspaceId))
      .order("asc")
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .collect();

    // PR workspace-storage-3c (Greptile P1 "Chat treats keys as
    // URLs"): resolve each `image` / `file` message's B2 key
    // server-side. Pre-3c the `content` field stored the literal
    // `b2Key` for new rows, and the chat parser
    // (`apps/platform/components/workspace/chat/utils.tsx:parseFileMessage`)
    // returned `{ url: <b2Key literal> }`, which `<Image src=…>`
    // then failed to fetch. Resolve here so the parser sees a
    // real signed URL. Legacy Convex-storage rows fall through to
    // the existing `ctx.storage.getUrl` path.
    //
    // PR workspace-storage-3c follow-up: legacy resource-share rows
    // posted before the follow-up fix did not stamp `b2Key` on the
    // message — the b2Key sits inside `content` as
    // `${encodedFileName}|${b2Key}`. Extract those too so the
    // resource-share chat messages still resolve server-side.
    const b2Keys = new Set<string>();
    for (const m of messages) {
      if (m.type !== "image" && m.type !== "file") continue;
      if (typeof m.b2Key === "string") {
        b2Keys.add(m.b2Key);
        continue;
      }
      const separatorIndex = m.content.indexOf("|");
      const urlPortion =
        separatorIndex >= 0 ? m.content.slice(separatorIndex + 1) : m.content;
      if (
        urlPortion.length > 0 &&
        !urlPortion.startsWith("http://") &&
        !urlPortion.startsWith("https://") &&
        !urlPortion.startsWith("https:/")
      ) {
        b2Keys.add(urlPortion);
      }
    }
    const urlMap = new Map<string, string>();
    if (b2Keys.size > 0) {
      // 4-hour TTL: covers an active chat session (call + chat
      // co-attended) without re-querying, while keeping the
      // "leaked URL outlives permission change" window comparable
      // to the gallery's 1-hour default. A participant who loses
      // workspace access mid-window still has at most 4 hours of
      // read access via any URL they captured, vs the gallery's
      // 1 hour. Clamped to `min(retention, 24h)` server-side.
      const resolved = await ctx.runQuery(
        internal.workspaceStorage.resolveWorkspaceB2FileUploadsForKeys,
        { workspaceId: args.workspaceId, b2Keys: [...b2Keys], expiresInSeconds: 4 * 60 * 60 }
      );
      for (const r of resolved) {
        if (r.ok) urlMap.set(r.b2Key, r.url);
      }
    }

    // PR workspace-storage-3c follow-up (round 6 Greptile P1
    // "Retention denial bypassed"): compute the retention state
    // once so the chat resolver's storageId fallback can match
    // the B2 resolver's refusal for past-retention workspaces.
    // Use `>=` (not `>`) so the boundary matches the B2 resolver's
    // `Math.floor(remainingSeconds) === 0` check — when exactly
    // at the deadline the B2 resolver rounds to zero and refuses;
    // chat must agree.
    const isPastRetention =
      result.workspace.deletedAt !== undefined ||
      (result.workspace.endedAt !== undefined &&
        Date.now() - result.workspace.endedAt >= WORKSPACE_RETENTION_MS);

    const authorDisplayNames = await resolveAuthorDisplayNames(
      ctx,
      result.workspace,
      messages.map((message) => ({ userId: message.userId, role: message.senderRole }))
    );
    return await Promise.all(
      messages.map(async (message) => {
        const resolvedUrl = await resolveChatMessageUrl(ctx, message, urlMap, isPastRetention);
        return {
          ...message,
          imageUrl: message.type === "image" ? resolvedUrl : undefined,
          fileUrl: message.type === "file" ? resolvedUrl : undefined,
          authorDisplayName: authorDisplayNames.get(message.userId) ?? "Student",
        };
      })
    );
  },
});

/**
 * PR workspace-storage-3c (Greptile P1 "Chat treats keys as URLs"):
 * server-side URL resolver for chat messages. Returns the actual
 * signed URL for B2 rows, the `ctx.storage` URL for legacy rows,
 * or `undefined` for plain text messages.
 *
 * PR workspace-storage-3c follow-up: resource shares posted via
 * `shareResourceToChat` (pre-PR-3c-fix) embed the resource's
 * `b2Key` inside `content` as
 * `${encodeURIComponent(fileName)}|${b2Key}` without stamping
 * the `b2Key` column on the row. The caller populates `b2UrlMap`
 * with both the column-stamped keys AND the content-extracted
 * keys so this lookup returns the resolved URL for either case.
 *
 * PR workspace-storage-3c follow-up (round 5 Greptile P1):
 * migrated messages (PR 2's `propagateMigratedB2KeyToMessages`)
 * carry both `storageId` AND `b2Key`. If the B2 ledger entry has
 * not yet been recorded (migration partially applied), the b2Key
 * lookup misses and we fall through to `ctx.storage.getUrl` so the
 * attachment remains viewable.
 *
 * PR workspace-storage-3c follow-up (round 6 Greptile P1):
 * the storageId fallback must respect retention. The B2 resolver
 * refuses URLs once a workspace is past its 18-month retention
 * window (workspace_past_retention / workspace_deleted); the
 * chat resolver's storageId fallback would bypass that check by
 * going straight to `ctx.storage.getUrl`. Gate the fallback on
 * `isPastRetention` so retention denials propagate.
 */
async function resolveChatMessageUrl(
  ctx: QueryCtx,
  message: Doc<"workspaceMessages">,
  b2UrlMap: Map<string, string>,
  isPastRetention: boolean
): Promise<string | undefined> {
  if (message.type !== "image" && message.type !== "file") return undefined;
  if (typeof message.b2Key === "string") {
    const resolved = b2UrlMap.get(message.b2Key);
    if (resolved) return resolved;
    // Migrated row whose B2 ledger entry isn't yet recorded —
    // fall through to the legacy Convex-storage URL rather than
    // rendering "Attachment unavailable" for a still-viewable
    // message. Skipped past retention to match the B2 resolver's
    // refusal (otherwise a captured legacy URL outlives the
    // retention sweep).
    if (message.storageId && !isPastRetention) {
      return (await ctx.storage.getUrl(message.storageId as Id<"_storage">)) ?? undefined;
    }
    return undefined;
  }
  if (message.storageId && !isPastRetention) {
    return (await ctx.storage.getUrl(message.storageId as Id<"_storage">)) ?? undefined;
  }
  // Legacy resource share rows: extract the b2Key portion of
  // `content` and look it up in the pre-populated `b2UrlMap`.
  // Absolute-URL portions are the legacy-Convex-storage path and
  // pass through unchanged.
  const separatorIndex = message.content.indexOf("|");
  const urlPortion =
    separatorIndex >= 0
      ? message.content.slice(separatorIndex + 1)
      : message.content;
  if (
    urlPortion.startsWith("http://") ||
    urlPortion.startsWith("https://") ||
    urlPortion.startsWith("https:/")
  ) {
    return urlPortion;
  }
  if (urlPortion.length > 0) {
    return b2UrlMap.get(urlPortion);
  }
  return undefined;
}

/**
 * Returns a paginated list of workspace messages, newest first.
 * Callers who are not active participants receive an empty, done page.
 *
 * PR #convex-egress-1: pagination replaces the unbounded
 * `getWorkspaceMessages` subscription in apps/platform to reduce Convex
 * Data Egress. The query orders by `_creationTime` descending so the
 * first page is the most recent messages; the UI reverses the
 * concatenated results for chronological display.
 *
 * PR #B: filters out soft-deleted messages (`deletedAt !== undefined`)
 * after pagination. The filter may cause a page to have slightly fewer
 * rows than `paginationOpts.numItems` requested when the page boundary
 * crosses a soft-deleted message; the next page is unaffected.
 */
export const getWorkspaceMessagesPaginated = query({
  args: {
    workspaceId: v.id("workspaces"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const result = await getCallerWorkspaceRole(ctx, args.workspaceId);
    if (!result) {
      return { page: [], continueCursor: "", isDone: true };
    }
    // PR #B: filter out soft-deleted messages in the index lookup
    // itself (Greptile P2: "Filtering creates empty history pages").
    // The new `by_workspaceId_deletedAt` index lets us scope to
    // `deletedAt = undefined` so a page of all-deleted rows
    // does not appear empty to the caller. Convex indexes missing
    // fields as a sentinel value; the `q.eq("deletedAt", undefined)`
    // here intentionally targets only rows whose `deletedAt` field
    // is absent (i.e. live, undeleted messages).
    const paginated = await ctx.db
      .query("workspaceMessages")
      .withIndex("by_workspaceId_deletedAt", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("deletedAt", undefined)
      )
      .order("desc")
      .paginate(args.paginationOpts);

    // PR workspace-storage-3c (Greptile P1 "Chat treats keys as
    // URLs"): same server-side resolution as
    // `getWorkspaceMessages`. Run once per page so each
    // `useInfiniteQuery` page-load pays the cost; previous pages
    // remain cached with their already-resolved URLs.
    //
    // PR workspace-storage-3c follow-up: same content extraction
    // for legacy resource-share rows as `getWorkspaceMessages`
    // (the b2Key sits inside `content` for rows posted before the
    // follow-up fix to `shareResourceToChat`).
    //
    // PR workspace-storage-3c follow-up (round 5 Greptile P1):
    // do NOT skip rows with `storageId` here — migrated messages
    // (PR 2's `propagateMigratedB2KeyToMessages`) carry BOTH
    // `storageId` and `b2Key`, and the resolver falls through to
    // `ctx.storage.getUrl` if the B2 ledger lookup misses.
    const b2Keys = new Set<string>();
    for (const m of paginated.page) {
      if (m.type !== "image" && m.type !== "file") continue;
      if (typeof m.b2Key === "string") {
        b2Keys.add(m.b2Key);
        continue;
      }
      const separatorIndex = m.content.indexOf("|");
      const urlPortion =
        separatorIndex >= 0 ? m.content.slice(separatorIndex + 1) : m.content;
      if (
        urlPortion.length > 0 &&
        !urlPortion.startsWith("http://") &&
        !urlPortion.startsWith("https://") &&
        !urlPortion.startsWith("https:/")
      ) {
        b2Keys.add(urlPortion);
      }
    }
    const urlMap = new Map<string, string>();
    if (b2Keys.size > 0) {
      // 4-hour TTL: covers an active chat session (call + chat
      // co-attended) without re-querying, while keeping the
      // "leaked URL outlives permission change" window comparable
      // to the gallery's 1-hour default. A participant who loses
      // workspace access mid-window still has at most 4 hours of
      // read access via any URL they captured, vs the gallery's
      // 1 hour. Clamped to `min(retention, 24h)` server-side.
      const resolved = await ctx.runQuery(
        internal.workspaceStorage.resolveWorkspaceB2FileUploadsForKeys,
        { workspaceId: args.workspaceId, b2Keys: [...b2Keys], expiresInSeconds: 4 * 60 * 60 }
      );
      for (const r of resolved) {
        if (r.ok) urlMap.set(r.b2Key, r.url);
      }
    }

    // PR workspace-storage-3c follow-up (round 6 Greptile P1
    // "Retention denial bypassed"): match the B2 resolver's
    // past-retention refusal in the chat query so the storageId
    // fallback does not produce a URL for a workspace the B2
    // resolver has already declined.
    const isPastRetention =
      result.workspace.deletedAt !== undefined ||
      (result.workspace.endedAt !== undefined &&
        Date.now() - result.workspace.endedAt > WORKSPACE_RETENTION_MS);

    const authorDisplayNames = await resolveAuthorDisplayNames(
      ctx,
      result.workspace,
      paginated.page.map((message) => ({ userId: message.userId, role: message.senderRole }))
    );
    return {
      ...paginated,
      page: await Promise.all(
        paginated.page.map(async (message) => {
          const resolvedUrl = await resolveChatMessageUrl(ctx, message, urlMap, isPastRetention);
          return {
            ...message,
            imageUrl: message.type === "image" ? resolvedUrl : undefined,
            fileUrl: message.type === "file" ? resolvedUrl : undefined,
            authorDisplayName: authorDisplayNames.get(message.userId) ?? "Student",
          };
        })
      ),
    };
  },
});

/**
 * Returns the number of file messages in a workspace, broken down by
 * sender role. Callers who are not active participants receive zeros.
 *
 * PR #convex-egress-1: drives the remaining-file-slots UI in the chat
 * composer without needing the full paginated message list.
 */
export const getWorkspaceFileCounts = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    const result = await getCallerWorkspaceRole(ctx, args.workspaceId);
    if (!result) {
      return { student: 0, instructor: 0, admin: 0 };
    }

    const [student, instructor, admin] = await Promise.all([
      countWorkspaceFilesByRole(ctx, args.workspaceId, "student"),
      countWorkspaceFilesByRole(ctx, args.workspaceId, "instructor"),
      countWorkspaceFilesByRole(ctx, args.workspaceId, "admin"),
    ]);

    return { student, instructor, admin };
  },
});

/**
 * Creates a message in a workspace with automatic sender role detection.
 * The caller's user id is derived from the auth identity; never pass it
 * from the client.
 */
export const createWorkspaceMessage = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    content: v.string(),
    type: v.optional(v.union(v.literal("text"), v.literal("image"), v.literal("file"))),
    // Optional — set when a chat message is posted while a video
    // call is active in the workspace. The Chat tab renders an
    // in-call banner and individual messages tagged to the active
    // session display a 🔴 dot.
    sessionId: v.optional(v.id("sessions")),
  },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      throw new Error("Unauthorized");
    }

    const workspace = await getWorkspaceIfActive(ctx, args.workspaceId);
    if (!workspace) {
      throw new Error("Workspace not found");
    }

    const isUserAdmin = await isAdmin(ctx, user.subject);
    let senderRole: "instructor" | "student" | "admin" | undefined;

    if (isUserAdmin) {
      senderRole = "admin";
    } else if (workspace.instructorId) {
      const instructor = await ctx.db
        .query("instructors")
        .withIndex("by_userId", (q: any) => q.eq("userId", user.subject))
        .first();
      if (instructor && instructor._id === workspace.instructorId) {
        senderRole = "instructor";
      } else if (workspace.ownerId === user.subject) {
        senderRole = "student";
      }
    } else if (workspace.ownerId === user.subject) {
      senderRole = "student";
    }

    if (!senderRole) {
      throw new Error("Access denied to workspace");
    }

    // PR #4b: reject sessionIds that do not belong to this
    // workspace.
    await assertSessionBelongsToWorkspace(ctx, args);

    const { sessionId, ...rest } = args;
    const messageId = await ctx.db.insert("workspaceMessages", {
      ...rest,
      type: args.type ?? "text",
      userId: user.subject,
      senderRole,
      sessionId,
    });

    if (isUserAdmin) {
      await logWorkspaceAudit(ctx, args.workspaceId, user.subject, "send_message");
    }

    return messageId;
  },
});

/**
 * PR platform-call-bugs round 7 P1+Security: mints a short-
 * lived nonce that the client must present when calling
 * {@link recordCallPresenceMessage}. The nonce is bound to
 * (workspaceId, sessionId, callerId, kind) with a 30-second
 * TTL; the record mutation consumes it on use. A malicious
 * workspace participant cannot post fake "joined" / "left"
 * notices without first calling this mutation, which itself
 * verifies the caller is a real workspace participant via
 * the same checks {@link recordCallPresenceMessage} performs.
 *
 * The nonce is a single-shot token: if the same nonce is
 * reused (e.g., Daily fires `participant-joined` twice for a
 * flaky WebSocket), the second `recordCallPresenceMessage`
 * call fails fast rather than writing a duplicate system row.
 * The client mints a fresh nonce each time it intends to
 * post a notice, which the record mutation enforces.
 *
 * Cleanup: a daily cron (`expireCallPresenceNonces` in
 * `convex/mutations/expireCallPresenceNonces.ts`) marks
 * stale rows as expired so they can be inspected for
 * diagnostics; the record mutation rejects expired nonces.
 */
export const prepareCallPresenceMessage = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    sessionId: v.id("sessions"),
    kind: v.union(v.literal("joined"), v.literal("left")),
  },
  handler: async (ctx, args): Promise<Id<"callPresenceNonces">> => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      throw new Error("Unauthorized");
    }

    const workspace = await getWorkspaceIfActive(ctx, args.workspaceId);
    if (!workspace) {
      throw new Error("Workspace not found");
    }

    const role = await getWorkspaceRole(ctx, workspace, user.subject);
    if (!role) {
      throw new Error("Access denied to workspace");
    }

    // Reject sessionIds that do not belong to this workspace.
    await assertSessionBelongsToWorkspace(ctx, args);

    const now = Date.now();
    return await ctx.db.insert("callPresenceNonces", {
      workspaceId: args.workspaceId,
      sessionId: args.sessionId,
      callerId: user.subject,
      kind: args.kind,
      issuedAt: now,
      // 30s TTL. The record mutation is expected to be called
      // synchronously after Daily's `participant-joined` /
      // `participant-left` event, so 30s leaves a comfortable
      // window for Convex RTT without making the nonce usable
      // for unrelated forged events.
      expiresAt: now + 30_000,
      consumed: false,
    });
  },
});

/**
 * PR platform-call-bugs: posts a system message to a workspace's
 * chat on behalf of a participant-joined / -left event from the
 * Daily.co video call. The row is NOT authored by a user — it
 * surfaces in the Chat tab as a muted, centered notice so both
 * parties see who joined / left the call mid-session.
 *
 * Security note (Greptile round 3 P1): the actor's display name is
 * resolved server-side from the caller's `users` row, NOT taken
 * from the client. A malicious participant cannot impersonate
 * someone else by passing a forged name — the rendered content
 * always reflects the caller's real `firstName`/`lastName`.
 *
 * Greptile round 7 P1+Security: the mutation now also requires
 * a `nonceId` minted by {@link prepareCallPresenceMessage}. This
 * two-call protocol closes the forgery gap that allowed any
 * workspace participant to call this mutation with arbitrary
 * `kind` values to post fake "joined" / "left" notices. Without
 * a valid nonce, the mutation refuses. The nonce is consumed on
 * use so the same nonce cannot be replayed.
 *
 * `userId` is the Convex auth identity of the caller (also used
 * to look up the display name + auth/audit). `senderRole` is
 * intentionally left undefined — system messages are not
 * role-tagged so the Chat list's avatar / bubble styling skips
 * them entirely.
 */
export const recordCallPresenceMessage = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    sessionId: v.id("sessions"),
    kind: v.union(v.literal("joined"), v.literal("left")),
    nonceId: v.id("callPresenceNonces"),
  },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      throw new Error("Unauthorized");
    }

    // Greptile round 7 P1+Security: verify the nonce FIRST. A
    // missing/expired/replayed nonce short-circuits before any
    // workspace lookup, so an attacker cannot probe workspace
    // state through this mutation.
    const nonce = await ctx.db.get(args.nonceId);
    if (!nonce) {
      throw new Error("Invalid call presence nonce");
    }
    if (nonce.consumed) {
      throw new Error("Call presence nonce already used");
    }
    if (nonce.expiresAt < Date.now()) {
      throw new Error("Call presence nonce expired");
    }
    if (nonce.callerId !== user.subject) {
      // The nonce was minted by a different caller; refuse so a
      // stolen nonce id cannot be presented by another session.
      throw new Error("Call presence nonce does not belong to caller");
    }
    if (nonce.workspaceId !== args.workspaceId) {
      throw new Error("Call presence nonce workspace mismatch");
    }
    if (nonce.sessionId !== args.sessionId) {
      throw new Error("Call presence nonce session mismatch");
    }
    if (nonce.kind !== args.kind) {
      throw new Error("Call presence nonce kind mismatch");
    }

    const workspace = await getWorkspaceIfActive(ctx, args.workspaceId);
    if (!workspace) {
      throw new Error("Workspace not found");
    }

    // Sender-role resolution is intentionally skipped — system rows
    // are NOT attributed to any user, and the Chat tab renders them
    // without a sender name. We still need to verify the caller is a
    // workspace participant so a malicious client can't post fake
    // join / leave notices to a workspace they don't belong to.
    const role = await getWorkspaceRole(ctx, workspace, user.subject);
    if (!role) {
      throw new Error("Access denied to workspace");
    }

    // PR #4b: reject sessionIds that do not belong to this
    // workspace. Same helper as the user-authored chat mutations
    // — it cross-checks `session.instructorId` and `session.studentId`
    // against `workspace.instructorId` / `workspace.ownerId`.
    await assertSessionBelongsToWorkspace(ctx, args);

    // Greptile round 3 P1: resolve the actor's display name from
    // the server-side `users` row keyed by the caller's auth
    // identity. Never trust a client-supplied name.
    //
    // Greptile round 5 P2: Convex auth identities can resolve to
    // either `users.clerkId` (newer flow) or `users.userId`
    // (legacy flow / records where the Clerk ID differs from the
    // userId — e.g. migrated rows that store a prefixed clerkId).
    // Look up by both indexes and prefer the first hit. If neither
    // matches, fall back to a generic label so we still emit a
    // meaningful system notice rather than refusing the write.
    //
    // Greptile round 7 P1: the previous dual-lookup picked whichever
    // row matched `by_clerkId` first, even when the workspace is
    // actually linked to a different `users` row for the same Clerk
    // account. In setups where one Clerk account maps to multiple
    // `users` rows (primary + secondary identity records, migrated
    // rows, split-onboarded accounts), `by_clerkId` could return the
    // wrong row and attribute the notice to the wrong participant's
    // identity. Anchor the lookup to the workspace/session linkage
    // (the canonical Convex userId) so the resolved row is always
    // the participant the workspace is actually paired with:
    //
    //   - Student role: `workspace.ownerId` is the canonical
    //     userId, so look up `users.by_userId.eq(workspace.ownerId)`.
    //   - Instructor role: `workspace.instructorId` is the
    //     instructor record `_id`; fetch the instructor and look
    //     up the user by `instructor.userId`.
    //   - Admin role: the workspace pairing is not user-specific,
    //     so fall back to the dual-lookup against the auth
    //     subject.
    //
    // If the workspace-context lookup misses (e.g., admin role or
    // an unmigrated record), fall back to the auth-subject dual-
    // lookup so a notice is still emitted rather than silently
    // failing.
    let userRow =
      role === "student"
        ? await ctx.db
            .query("users")
            .withIndex("by_userId", (q) => q.eq("userId", workspace.ownerId))
            .first()
        : role === "instructor" && workspace.instructorId
          ? await (async () => {
              const instructor = await ctx.db.get(workspace.instructorId!);
              if (!instructor || !instructor.userId) return null;
              return await ctx.db
                .query("users")
                .withIndex("by_userId", (q) => q.eq("userId", instructor.userId!))
                .first();
            })()
          : null;
    if (!userRow) {
      userRow =
        (await ctx.db
          .query("users")
          .withIndex("by_clerkId", (q) => q.eq("clerkId", user.subject))
          .first()) ??
        (await ctx.db
          .query("users")
          .withIndex("by_userId", (q) => q.eq("userId", user.subject))
          .first());
    }
    const resolvedName =
      [userRow?.firstName, userRow?.lastName]
        .filter(Boolean)
        .join(" ")
        .trim() ||
      userRow?.email?.split("@")[0]?.trim() ||
      "A participant";

    const content =
      args.kind === "joined"
        ? `${resolvedName} joined the call`
        : `${resolvedName} left the call`;

    // Consume the nonce atomically with the message insert.
    // Convex mutations are transactional, so a crash between
    // the patch and the insert rolls back both writes and the
    // nonce stays usable (the client will mint a fresh one on
    // retry).
    await ctx.db.patch(args.nonceId, { consumed: true });

    return await ctx.db.insert("workspaceMessages", {
      workspaceId: args.workspaceId,
      userId: user.subject,
      content,
      type: "system",
      systemEventKind: args.kind,
      sessionId: args.sessionId,
      // senderRole intentionally omitted — system rows are not
      // attributed to any role. The Chat tab uses the absence of
      // senderRole + `type === "system"` to decide on the muted,
      // centered rendering branch.
    });
  },
});

/**
 * Creates a downloadable file message in a workspace with role-based
 * file caps. Requires auth.
 *
 * PR workspace-storage-3c: takes a B2 key (was a Convex storage id).
 * The chat message `content` stores the encoded file name and the
 * `b2Key` (was a URL). The UI resolver hook (`useWorkspaceFileUrl`)
 * detects the URL-prefix and resolves B2 keys via
 * `getWorkspaceDownloadUrl`.
 */
export const createWorkspaceFileMessage = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    b2Key: v.string(),
    fileName: v.string(),
    // Optional — set when a file message is posted while a video
    // call is active in the workspace. Same semantics as
    // `createWorkspaceMessage.sessionId`.
    sessionId: v.optional(v.id("sessions")),
  },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      throw new Error("Unauthorized");
    }

    const workspace = await getWorkspaceIfActive(ctx, args.workspaceId);
    if (!workspace) {
      throw new Error("Workspace not found");
    }

    const role = await getWorkspaceRole(ctx, workspace, user.subject);
    if (!role) {
      throw new Error("Not authorized to add files to this workspace");
    }

    // PR #4b: reject sessionIds that do not belong to this
    // workspace.
    await assertSessionBelongsToWorkspace(ctx, args);

    // PR workspace-storage-3c: gate on the B2 upload ledger so a
    // participant cannot pass an unrelated `b2Key` (Greptile
    // Security P1).
    await assertB2FileUploadOwnedByCaller(ctx, {
      workspaceId: args.workspaceId,
      b2Key: args.b2Key,
      callerId: user.subject,
    });

    if (role !== "admin") {
      const currentCount = await countWorkspaceFilesByRole(ctx, args.workspaceId, role);
      const cap = WORKSPACE_FILE_CAPS[role];
      if (currentCount >= cap) {
        throw new Error(`File limit reached (${cap} ${role} files allowed per workspace).`);
      }
    }

    await ctx.db.insert("workspaceMessages", {
      workspaceId: args.workspaceId,
      userId: user.subject,
      // PR workspace-storage-3c: store the encoded file name and
      // the `b2Key` (was a URL). The chat renderer
      // (`useWorkspaceFileUrl`) splits on `|`, checks the right
      // side for an `https://` prefix — if found, it's a legacy URL
      // (apps/web); otherwise it's a `b2Key` and the hook calls
      // `getWorkspaceDownloadUrl` to resolve.
      content: `${encodeURIComponent(args.fileName)}|${args.b2Key}`,
      type: "file",
      senderRole: role,
      sessionId: args.sessionId,
      b2Key: args.b2Key,
    });

    if (role === "admin") {
      await logWorkspaceAudit(ctx, args.workspaceId, user.subject, "send_message");
    }
  },
});

/** Creates a workspace export record and triggers a Trigger.dev task for zip format. Requires auth. */
export const createWorkspaceExport = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    userId: v.string(),
    format: v.literal("zip"),
    imageIds: v.optional(v.array(v.id("workspaceImages"))),
  },
  returns: v.object({
    exportId: v.id("workspaceExports"),
    errorMessage: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      throw new Error("Unauthorized");
    }

    const workspace = await getWorkspaceIfActive(ctx, args.workspaceId);
    if (!workspace) {
      throw new Error("Workspace not found");
    }

    const role = await getWorkspaceRole(ctx, workspace, user.subject);
    if (!role) {
      throw new Error("Not authorized to export this workspace");
    }

    // PR #4b-fix: derive userId from the auth identity, never from
    // the client. Convex auth guideline #182. The arg is kept for
    // backwards compatibility with existing callers (it is ignored
    // if it disagrees with the auth identity) but new callers should
    // omit it. Matches the no-arg pattern in
    // `createWorkspaceMessage`/`createWorkspaceFileMessage`.
    if (args.userId !== user.subject) {
      // Note: do NOT throw — that would break existing callers who
      // legitimately pass a Clerk userId from a useQuery. Instead,
      // store the auth subject and let the audit log flag the
      // mismatch.
      console.warn(
        "createWorkspaceExport: client-supplied userId disagrees with auth subject",
        { client: args.userId, auth: user.subject, workspaceId: args.workspaceId }
      );
    }

    const exportId = await ctx.db.insert("workspaceExports", {
      workspaceId: args.workspaceId,
      userId: user.subject,
      format: args.format,
      status: "pending",
    });

    const triggerSecretKey = process.env.TRIGGER_SECRET_KEY ?? process.env.TRIGGER_API_KEY;

    const taskMap: Record<string, string> = {
      zip: "process-workspace-export",
    };

    const taskName = taskMap[args.format];

    const errorMessageMissingKey =
      "TRIGGER_SECRET_KEY (or TRIGGER_API_KEY) is not set in the Convex environment variables.";

    if (!triggerSecretKey) {
      // PR #4b-fix: do not silently leave the row in "pending" when
      // the trigger credentials are missing. Surface a clear failure
      // so the UI shows "Export could not start" instead of
      // polling forever.
      await ctx.db.patch(exportId, {
        status: "failed",
        errorMessage: errorMessageMissingKey,
      });
      return { exportId, errorMessage: errorMessageMissingKey };
    }

    if (taskName) {
      try {
        const response = await fetch(`https://api.trigger.dev/api/v1/tasks/${taskName}/trigger`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${triggerSecretKey}`,
          },
          body: JSON.stringify({
            payload: {
              workspaceId: args.workspaceId,
              exportId: String(exportId),
              imageIds: args.imageIds,
            },
          }),
        });

        if (!response.ok) {
          const errorMessage = `Trigger.dev request failed: ${response.status}`;
          await ctx.db.patch(exportId, {
            status: "failed",
            errorMessage,
          });
          return { exportId, errorMessage };
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        await ctx.db.patch(exportId, {
          status: "failed",
          errorMessage,
        });
        console.error("Failed to trigger export task:", error);
        return { exportId, errorMessage };
      }
    }

    return { exportId };
  },
});

/**
 * PR #4b-fix: gate `cancelWorkspaceExport` to the owner or a workspace
 * participant. Previously any authenticated user could cancel any
 * other user's export by passing an id scraped from the wire. Now:
 * - The export's `userId` must match the caller's `identity.subject`,
 *   OR
 * - The caller has a workspace role on the export's workspace
 *   (instructor or student paired with the workspace's instructor).
 *
 * Both paths are indexed lookups so the cost is constant. Mirrors
 * the auth pattern in `assertParticipantForSession`.
 */
export const cancelWorkspaceExport = mutation({
  args: { id: v.id("workspaceExports") },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      throw new Error("Unauthorized");
    }
    const exportDoc = await ctx.db.get(args.id);
    if (!exportDoc) {
      throw new Error("Export not found");
    }
    if (exportDoc.userId !== user.subject) {
      // Allow cancellation even if the workspace is soft-deleted/ended — the
      // export record may still exist and a participant may need to clean
      // it up. The role check below still enforces authorization.
      const workspace = await ctx.db.get(exportDoc.workspaceId);
      if (!workspace) {
        throw new Error("Export's workspace not found");
      }
      const role = await getWorkspaceRole(ctx, workspace, user.subject);
      if (!role) {
        throw new Error("Not authorized to cancel this export");
      }
    }
    await ctx.db.patch(args.id, { status: "failed" });
  },
});

/**
 * Returns the 10 most recent exports for a workspace.
 * Returns an empty array for callers who are not active participants.
 */
export const getWorkspaceExports = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return [];
    }

    // Allow participants to see exports even after a workspace is
    // soft-deleted/ended, so they can monitor or cancel in-flight exports.
    // Mirrors the co-participant path in `cancelWorkspaceExport`.
    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace) {
      return [];
    }
    const role = await getWorkspaceRole(ctx, workspace, user.subject);
    if (!role) {
      return [];
    }

    return await ctx.db
      .query("workspaceExports")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", args.workspaceId))
      .order("desc")
      .take(10);
  },
});

/**
 * Returns all retention notifications for a workspace.
 * Returns an empty array for callers who are not active participants.
 */
export const getWorkspaceRetentionNotifications = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    const result = await getCallerWorkspaceRole(ctx, args.workspaceId);
    if (!result) {
      return [];
    }
    return await ctx.db
      .query("workspaceRetentionNotifications")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();
  },
});

/** Returns unacknowledged retention notifications for the current user across all workspaces. */
export const getUnacknowledgedRetentionNotifications = query({
  args: {},
  handler: async (ctx) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return [];
    }

    const notifications = await ctx.db
      .query("workspaceRetentionNotifications")
      .withIndex("by_userId", (q) => q.eq("userId", user.subject))
      .filter((q) => q.eq(q.field("acknowledgedAt"), undefined))
      .collect();

    return notifications;
  },
});

/** Creates a retention notification (expiry warning or deleted). */
export const createRetentionNotification = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    userId: v.string(),
    notificationType: v.union(v.literal("expiry_warning"), v.literal("deleted")),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("workspaceRetentionNotifications", {
      ...args,
      sentAt: Date.now(),
    });
  },
});

/** Marks a retention notification as acknowledged. */
export const acknowledgeNotification = mutation({
  args: { id: v.id("workspaceRetentionNotifications") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { acknowledgedAt: Date.now() });
    return await ctx.db.get(args.id);
  },
});

/** Permanently deletes all notes, links, images, messages, and per-user aliases in a workspace and resets image counters. */
export const deleteAllWorkspaceContent = internalMutation({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    const notes = await ctx.db
      .query("workspaceNotes")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();
    for (const note of notes) {
      await ctx.db.delete(note._id);
    }

    const links = await ctx.db
      .query("workspaceLinks")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();
    for (const link of links) {
      await ctx.db.delete(link._id);
    }

    const images = await ctx.db
      .query("workspaceImages")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();
    for (const image of images) {
      await ctx.db.delete(image._id);
    }

    const messages = await ctx.db
      .query("workspaceMessages")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();
    for (const message of messages) {
      await ctx.db.delete(message._id);
    }

    const aliases = await ctx.db
      .query("workspaceAliases")
      .withIndex("by_workspaceId_userId", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();
    for (const alias of aliases) {
      await ctx.db.delete(alias._id);
    }

    await ctx.db.patch(args.workspaceId, {
      studentImageCount: 0,
      instructorImageCount: 0,
    });

    return {
      deleted: {
        notes: notes.length,
        links: links.length,
        images: images.length,
        messages: messages.length,
        aliases: aliases.length,
      },
    };
  },
});

// PR workspace-storage-3c: the legacy
// `getImagesNeedingMigration` / `migrateWorkspaceImage` /
// `migrateWorkspaceImageInternal` admin toolchain is removed. It
// uploaded base64-encoded image rows to Convex Storage. After PR
// 3c, the only upload path is B2 (via
// `workspaceStorage.generateWorkspaceUploadUrl`) and the apps
// write `b2Key` directly to `workspaceImages`. There are no
// pre-PR-1 base64 rows left in production (PR 1 ran over a year
// ago and the daily PR 3a cleanup cron has flushed any stragglers
// to B2). The admin toolchain was never used by `apps/web` either.

/**
 * Idempotently creates (or returns) the single live session note
 * for a given session. The mutation is called from
 * `convex/sessions.ts:markCallStarted` after the call is marked
 * started, so reconnect-after-disconnect cannot create a duplicate.
 *
 * Idempotency is enforced via the
 * `by_sessionId_isLiveSessionNote` schema index: we look up the
 * existing live-session-note row for `(sessionId, true)` and return
 * it without writing if present.
 *
 * To avoid generating a new note every time a call is restarted in
 * the same lesson (e.g., network hiccups or technical issues), we
 * also reuse a recent live session note for the same workspace if one
 * was created within the last 12 hours. The reused note is re-tagged
 * to the current session so the Notes tab continues to pin it.
 *
 * `createdBy` is set to a fixed system marker (`"system"`) because
 * this row is created by `markCallStarted` on behalf of either party,
 * not by a specific user. The Notes composer hides the "delete" /
 * "edit" affordances on rows where `createdBy === "system"` (handled
 * client-side via the existing UI guards on a system-authored note).
 */
export const createLiveSessionNote = internalMutation({
  args: {
    sessionId: v.id("sessions"),
    workspaceId: v.id("workspaces"),
  },
  handler: async (ctx, args): Promise<Id<"workspaceNotes">> => {
    const existing = await ctx.db
      .query("workspaceNotes")
      .withIndex("by_sessionId_isLiveSessionNote", (q) =>
        q.eq("sessionId", args.sessionId).eq("isLiveSessionNote", true)
      )
      .first();

    if (existing) {
      return existing._id;
    }

    const session = await ctx.db.get(args.sessionId);
    if (!session) {
      throw new Error("Session not found");
    }

    const LIVE_SESSION_NOTE_REUSE_WINDOW_MS = 12 * 60 * 60 * 1000;
    const recentWindowStart = Date.now() - LIVE_SESSION_NOTE_REUSE_WINDOW_MS;
    const recentNote = await ctx.db
      .query("workspaceNotes")
      .withIndex("by_workspaceId_isLiveSessionNote_deletedAt", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("isLiveSessionNote", true).eq("deletedAt", undefined)
      )
      .filter((q) => q.gt(q.field("_creationTime"), recentWindowStart))
      .first();

    if (recentNote) {
      await ctx.db.patch(recentNote._id, {
        sessionId: args.sessionId,
        updatedAt: Date.now(),
      });
      return recentNote._id;
    }

    const startedAt = session.callStartedAt ?? Date.now();
    const dateLabel = new Date(startedAt).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    const title = `Live notes — ${dateLabel}`;

    return await ctx.db.insert("workspaceNotes", {
      workspaceId: args.workspaceId,
      title,
      content: "",
      createdBy: "system",
      updatedAt: Date.now(),
      sessionId: args.sessionId,
      isLiveSessionNote: true,
    });
  },
});

/**
 * Returns the live session note for a given session, if one exists
 * AND the caller has access to the workspace the note lives in.
 * Used by the Notes tab to pin it at the top while the call is
 * active. Returns null if no live note has been created yet (e.g.,
 * `markCallStarted` has not yet been called) or the caller is not
 * a participant in the session.
 *
 * PR #4b (Greptile R1 P1): the previous handler returned the live
 * note to any authenticated user, allowing a non-participant to
 * read content tagged to a call they are not in. We now look up
 * the note's workspace and require the caller to have a role on
 * it (or be an admin).
 */
export const getLiveSessionNote = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) return null;

    const note = await ctx.db
      .query("workspaceNotes")
      .withIndex("by_sessionId_isLiveSessionNote", (q) =>
        q.eq("sessionId", args.sessionId).eq("isLiveSessionNote", true)
      )
      .first();
    if (!note) return null;

    const workspace = await ctx.db.get(note.workspaceId);
    if (!workspace) return null;

    const role = await getWorkspaceRole(ctx, workspace, user.subject);
    if (!role) return null;

    return note;
  },
});

export const getWorkspaceImage = internalQuery({
  args: { imageId: v.id("workspaceImages") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.imageId);
  },
});

export const isAdminQuery = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();
    return (user?.role ?? "") === "admin";
  },
});

export const canAccessWorkspaceQuery = internalQuery({
  args: { workspaceId: v.id("workspaces"), userId: v.string() },
  handler: async (ctx, args) => {
    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace) return false;

    const user = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();
    if (user?.role === "admin") return true;

    if (workspace.ownerId === args.userId) return true;

    if (workspace.instructorId) {
      const instructor = await ctx.db
        .query("instructors")
        .withIndex("by_userId", (q) => q.eq("userId", args.userId))
        .first();
      if (instructor && instructor._id === workspace.instructorId) {
        return true;
      }
    }

    return false;
  },
});

/**
 * PR #4c-1: thin public query wrapper around the internal
 * `assertParticipantForSession` helper. The Next.js recording
 * route calls this via `fetchQuery` to gate access before issuing
 * a signed B2 URL.
 *
 * Returns `null` when the caller is unauthenticated, the session
 * is missing, or the caller is not a participant on the session —
 * keeping the route layer free of thrown-error gymnastics.
 *
 * `callEndedAt`, `recordingUrl`, and `contentType` are surfaced so
 * the route can short-circuit (404) when the call has no recording
 * attached and so the route can sign the URL with the actual
 * content-type Daily delivered (typically `video/mp4`, but the
 * S3 key may end in `.mov`/`.webm` depending on the room config).
 *
 * PR #4c-1 Greptile R1 P1 fix: the helper throws on auth
 * failures; we catch the auth-failure messages and return `null`
 * so the route's `if (!participant) → 403` branch fires for
 * forbidden callers instead of bubbling up as a 500.
 */
export const getSessionParticipantForRecording = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    try {
      const { session, workspace, role } = await assertParticipantForSession(
        ctx,
        { sessionId: args.sessionId }
      );
      const recordingS3Key =
        session.recordingTransferStatus === "ready" ||
        session.recordingTransferStatus === undefined
          ? session.recordingUrl ?? null
          : null;
      return {
        sessionId: session._id,
        workspaceId: workspace._id,
        role,
        recordingS3Key,
        contentType: recordingS3Key
          ? recordingContentType(recordingS3Key)
          : "video/mp4",
        callStartedAt: session.callStartedAt ?? null,
        callEndedAt: session.callEndedAt ?? null,
        isAdhoc: session.isAdhoc ?? false,
      };
    } catch (err) {
      if (
        err instanceof Error &&
        [
          "Unauthorized",
          "Session not found",
          "Forbidden",
          "No workspace matches this session",
          "No active workspace matches this session",
          "No retained workspace matches this session",
          "No unambiguous workspace matches this session",
          "Session is not paired with an instructor",
          "Instructor not found",
        ].includes(err.message)
      ) {
        return null;
      }
      throw err;
    }
  },
});

/**
 * Maps the B2 object key's extension to the MIME type we should
 * sign the streaming URL with. Daily.co defaults to MP4 but can
 * produce MOV (older mac clients) or WebM depending on room
 * config, so we read the extension off the key instead of
 * hardcoding MP4 — Greptile R4 P2 flagged the route's previous
 * hardcoded `video/mp4` as wrong for non-MP4 recordings.
 *
 * Unknown extensions fall back to `video/mp4` (browsers can still
 * play it through HTMLVideoElement.transcode heuristics), and the
 * caller can re-fetch with the correct type if B2 reports a 415.
 */
function recordingContentType(key: string): string {
  const lower = key.toLowerCase();
  if (lower.endsWith(".mov")) return "video/quicktime";
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".mp4") || lower.endsWith(".m4v")) return "video/mp4";
  if (lower.endsWith(".mkv")) return "video/x-matroska";
  return "video/mp4";
}
