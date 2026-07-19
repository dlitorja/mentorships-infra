import { query, mutation, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { assertParticipantForSession, assertSessionBelongsToWorkspace } from "./workspaces";

const MAX_WORKSPACE_FILE_BYTES = 50 * 1024 * 1024;
const WORKSPACE_IMAGE_CAPS = {
  student: 75,
  instructor: 150,
  admin: 9999,
} as const;

// File-attachment caps mirror the per-role caps enforced by
// `createWorkspaceFileMessage` (`workspaces.ts:1487`). Keeping them
// in sync here means `shareResourceToChat` and the chat uploader
// draw from the same source of truth — share a non-image resource
// and the user's quota is consumed in exactly the same way as if
// they had uploaded the file directly to the chat.
const WORKSPACE_FILE_CAPS = {
  student: 25,
  instructor: 50,
} as const;

type WorkspaceRole = "instructor" | "student" | "admin" | null;

async function isAdmin(ctx: any, userId: string): Promise<boolean> {
  const user = await ctx.db
    .query("users")
    .withIndex("by_userId", (q: any) => q.eq("userId", userId))
    .first();
  return user?.role === "admin";
}

async function getWorkspaceRole(
  ctx: any,
  workspace: { instructorId?: Id<"instructors">; ownerId: string; type?: string },
  userId: string
): Promise<WorkspaceRole> {
  const userIsAdmin = await isAdmin(ctx, userId);
  if (userIsAdmin) {
    return "admin";
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

  return null;
}

async function countActiveWorkspaceImages(ctx: any, workspaceId: Id<"workspaces">): Promise<number> {
  let count = 0;
  for await (const img of ctx.db.query("workspaceImages").withIndex("by_workspaceId", (q: any) => q.eq("workspaceId", workspaceId))) {
    if (!img.deletedAt) count++;
  }
  return count;
}

/**
 * PR #5: typed helper for resource-ownership checks. Mirrors the
 * shape of `assertSessionBelongsToWorkspace` (`workspaces.ts`) so
 * every mutation in this file uses a single, typed check instead of
 * re-implementing the role + ownership inline.
 *
 * Behavior:
 * - Rejects unauthenticated callers.
 * - Rejects when the resource doesn't exist.
 * - When `expectedWorkspaceId` is supplied, rejects mismatches
 *   (`resource.workspaceId !== expectedWorkspaceId`). Mutations that
 *   derive the workspaceId from another row (e.g. `embedResourceInNote`
 *   from the note) pass `expectedWorkspaceId` so the resource's
 *   workspace is verified to match the parent row's. Mutations that
 *   only know the `resourceId` (e.g. `deleteInstructorResource`,
 *   `updateInstructorResource`) omit it and the helper uses the
 *   resource's own `workspaceId`.
 * - Requires the caller to be the workspace's instructor OR an admin
 *   (same role shape as the existing inline checks).
 * - Requires the caller's `instructor._id` to match `resource.instructorId`
 *   so an admin acting on a workspace can't mutate another instructor's
 *   resources without explicit delegation.
 *
 * Returns `{ resource, workspace }` so callers don't re-fetch.
 */
export async function assertResourceBelongsToInstructor(
  ctx: MutationCtx,
  args: {
    resourceId: Id<"instructorResources">;
    expectedWorkspaceId?: Id<"workspaces">;
  }
): Promise<{
  resource: Doc<"instructorResources">;
  workspace: Doc<"workspaces">;
  identity: { subject: string };
  role: WorkspaceRole;
}> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Unauthorized");
  }
  const resource = await ctx.db.get(args.resourceId);
  if (!resource) {
    throw new Error("Resource not found");
  }
  if (
    args.expectedWorkspaceId !== undefined &&
    resource.workspaceId !== args.expectedWorkspaceId
  ) {
    throw new Error("Resource does not belong to this workspace");
  }
  const workspace = await ctx.db.get(resource.workspaceId);
  if (!workspace) {
    throw new Error("Workspace not found");
  }
  const role = await getWorkspaceRole(ctx, workspace, identity.subject);
  if (role !== "instructor" && role !== "admin") {
    throw new Error("Only instructors and admins can modify resources");
  }
  // Greptile R0 (PR #5): the original `deleteInstructorResource` had
  // no admin bypass — only the owning instructor could mutate a
  // resource. The PR #5 helper silently widened that to admins. Apply
  // the instructorId check unconditionally (admins and instructors
  // alike) so a platform admin cannot mutate another instructor's
  // resources. An admin acting on a workspace must also be the owning
  // instructor of the resource. Matches the JSDoc on this helper.
  const instructor = await ctx.db
    .query("instructors")
    .withIndex("by_userId", (q: any) => q.eq("userId", identity.subject))
    .first();
  if (!instructor || resource.instructorId !== instructor._id) {
    throw new Error("Not authorized for this resource");
  }
  return { resource, workspace, identity: { subject: identity.subject }, role };
}

/** Returns all instructor resources for the current user's instructor record in a workspace. */
export const getInstructorResources = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return [];
    }

    const instructor = await ctx.db
      .query("instructors")
      .withIndex("by_userId", (q: any) => q.eq("userId", user.subject))
      .first();
    if (!instructor) {
      return [];
    }

    const resources = await ctx.db
      .query("instructorResources")
      .withIndex("by_instructorId", (q: any) => q.eq("instructorId", instructor._id))
      .collect();

    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace) {
      return [];
    }

    const filtered = resources.filter(r => r.workspaceId === args.workspaceId);
    if (workspace.instructorId !== instructor._id) {
      return [];
    }

    const enriched = await Promise.all(
      filtered.map(async (r) => {
        const url = await ctx.storage.getUrl(r.storageId);
        return {
          ...r,
          url: url ?? null,
        };
      })
    );

    return enriched;
  },
});

/** Uploads a new instructor resource. Enforces image/file size and image cap limits. Requires instructor or admin role. */
export const uploadInstructorResource = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    storageId: v.id("_storage"),
    fileName: v.string(),
    contentType: v.string(),
    size: v.number(),
    type: v.union(v.literal("image"), v.literal("file")),
    // PR #5: tags the resource to an active video-call session. The
    // instructor can opt in via the Resources tab "Tag to current
    // call" toggle; cleared by the untag toggle which goes through
    // `updateInstructorResource` (mirror of the notes/links pattern).
    sessionId: v.optional(v.id("sessions")),
  },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      throw new Error("Unauthorized");
    }

    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace) {
      throw new Error("Workspace not found");
    }

    const role = await getWorkspaceRole(ctx, workspace, user.subject);
    if (role !== "instructor" && role !== "admin") {
      throw new Error("Only instructors and admins can upload resources");
    }

    const instructor = await ctx.db
      .query("instructors")
      .withIndex("by_userId", (q: any) => q.eq("userId", user.subject))
      .first();
    if (!instructor) {
      throw new Error("Instructor not found");
    }

    if (role === "instructor" && workspace.instructorId !== instructor._id) {
      throw new Error("You are not the instructor for this workspace");
    }

    // PR #5: reject sessionIds that do not belong to this workspace.
    // Same shape as `createWorkspaceLink` (`workspaces.ts`) so a
    // caller cannot tag a freshly-uploaded resource to an unrelated
    // session.
    await assertSessionBelongsToWorkspace(ctx, args);

    if (args.size > MAX_WORKSPACE_FILE_BYTES) {
      throw new Error("File exceeds 50MB size limit");
    }

    if (args.type === "image") {
      const isAdmin = role === "admin";
      const currentCount = isAdmin
        ? await countActiveWorkspaceImages(ctx, args.workspaceId)
        : (workspace.instructorImageCount ?? 0);
      const cap = isAdmin ? WORKSPACE_IMAGE_CAPS.admin : WORKSPACE_IMAGE_CAPS.instructor;
      if (currentCount >= cap) {
        throw new Error(`Image limit reached (${cap} images allowed)`);
      }
    }

    const resourceId = await ctx.db.insert("instructorResources", {
      instructorId: instructor._id,
      workspaceId: args.workspaceId,
      storageId: args.storageId,
      fileName: args.fileName,
      contentType: args.contentType,
      size: args.size,
      type: args.type,
      createdBy: user.subject,
      createdAt: Date.now(),
      sessionId: args.sessionId,
    });

    if (args.type === "image") {
      await ctx.db.patch(args.workspaceId, {
        instructorImageCount: (workspace.instructorImageCount ?? 0) + 1,
      });
    }

    return resourceId;
  },
});

/** Deletes an instructor resource and decrements the image count if it was an image. Requires ownership. */
export const deleteInstructorResource = mutation({
  args: { id: v.id("instructorResources") },
  handler: async (ctx, args) => {
    const { resource, workspace } = await assertResourceBelongsToInstructor(ctx, {
      resourceId: args.id,
    });

    if (resource.type === "image") {
      await ctx.db.patch(resource.workspaceId, {
        instructorImageCount: Math.max(0, (workspace.instructorImageCount ?? 1) - 1),
      });
    }

    await ctx.db.delete(args.id);
  },
});

/**
 * Shares an instructor resource to the workspace chat. For image
 * resources, also creates a `workspaceImages` row (so it appears in
 * the Images tab) and bumps `instructorImageCount`. For file
 * resources, enforces `WORKSPACE_FILE_CAPS` and writes a `type: "file"`
 * `workspaceMessages` row in the same shape as
 * `createWorkspaceFileMessage` (`workspaces.ts:1487`) so the chat
 * renderer can pick it up uniformly.
 *
 * Optional `sessionId` is forwarded onto the chat message so a share
 * during an active call gets the in-call tagging parity of the
 * other chat-creating mutations. Mirrors `createWorkspaceFileMessage`.
 * Requires instructor or admin role.
 */
export const shareResourceToChat = mutation({
  args: {
    resourceId: v.id("instructorResources"),
    workspaceId: v.id("workspaces"),
    sessionId: v.optional(v.id("sessions")),
  },
  handler: async (ctx, args) => {
    const { resource, workspace, identity, role } = await assertResourceBelongsToInstructor(ctx, {
      resourceId: args.resourceId,
      expectedWorkspaceId: args.workspaceId,
    });

    await assertSessionBelongsToWorkspace(ctx, args);

    const fileUrl = await ctx.storage.getUrl(resource.storageId);
    if (!fileUrl) {
      throw new Error("Failed to get resource URL");
    }

    if (resource.type === "image") {
      const isAdminRole = role === "admin";
      const currentCount = isAdminRole
        ? await countActiveWorkspaceImages(ctx, args.workspaceId)
        : (workspace.instructorImageCount ?? 0);
      const cap = isAdminRole ? WORKSPACE_IMAGE_CAPS.admin : WORKSPACE_IMAGE_CAPS.instructor;
      if (currentCount >= cap) {
        throw new Error(`Image limit reached (${cap} images allowed)`);
      }

      await ctx.db.insert("workspaceImages", {
        workspaceId: args.workspaceId,
        imageUrl: fileUrl,
        storageId: resource.storageId,
        createdBy: identity.subject,
      });

      await ctx.db.patch(args.workspaceId, {
        instructorImageCount: (workspace.instructorImageCount ?? 0) + 1,
      });

      await ctx.db.insert("workspaceMessages", {
        workspaceId: args.workspaceId,
        userId: identity.subject,
        content: `${encodeURIComponent(resource.fileName)}|${fileUrl}`,
        type: "image",
        senderRole: role,
        sessionId: args.sessionId,
      });
      return;
    }

    if (role !== "admin") {
      const currentCount = await countActiveWorkspaceFilesByRole(
        ctx,
        args.workspaceId,
        role as "instructor" | "student"
      );
      const cap = WORKSPACE_FILE_CAPS[role as "instructor" | "student"];
      if (currentCount >= cap) {
        throw new Error(`File limit reached (${cap} ${role} files allowed per workspace).`);
      }
    }

    await ctx.db.insert("workspaceMessages", {
      workspaceId: args.workspaceId,
      userId: identity.subject,
      content: `${encodeURIComponent(resource.fileName)}|${fileUrl}`,
      type: "file",
      senderRole: role,
      sessionId: args.sessionId,
    });
  },
});

/**
 * Counts non-deleted `workspaceMessages` rows of `type: "file"` posted
 * by the given sender role in the workspace. Used by
 * `shareResourceToChat` to enforce `WORKSPACE_FILE_CAPS` against the
 * same source of truth as `createWorkspaceFileMessage`
 * (`workspaces.ts:1487`). Mirrors `countWorkspaceFilesByRole`
 * (`workspaces.ts:94`) but kept local so we don't widen that file's
 * export surface from a single-resource PR.
 */
async function countActiveWorkspaceFilesByRole(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  role: "instructor" | "student"
): Promise<number> {
  const messages = await ctx.db
    .query("workspaceMessages")
    .withIndex("by_workspaceId", (q) => q.eq("workspaceId", workspaceId))
    .collect();

  return messages.filter(
    (m) => m.type === "file" && m.senderRole === role
  ).length;
}

/** Embeds an instructor image resource in a workspace note. Also creates a workspaceImage record and updates the note's imageUrl. Requires instructor or admin role. */
export const embedResourceInNote = mutation({
  args: {
    resourceId: v.id("instructorResources"),
    noteId: v.id("workspaceNotes"),
  },
  handler: async (ctx, args) => {
    const note = await ctx.db.get(args.noteId);
    if (!note) {
      throw new Error("Note not found");
    }

    const { resource, workspace, identity, role } = await assertResourceBelongsToInstructor(ctx, {
      resourceId: args.resourceId,
      expectedWorkspaceId: note.workspaceId,
    });

    if (resource.type !== "image") {
      throw new Error("Only image resources can be embedded in notes");
    }

    const imageUrl = await ctx.storage.getUrl(resource.storageId);
    if (!imageUrl) {
      throw new Error("Failed to get image URL");
    }

    const isAdminRole = role === "admin";
    const currentCount = isAdminRole
      ? await countActiveWorkspaceImages(ctx, note.workspaceId)
      : (workspace.instructorImageCount ?? 0);
    const cap = isAdminRole ? WORKSPACE_IMAGE_CAPS.admin : WORKSPACE_IMAGE_CAPS.instructor;
    if (currentCount >= cap) {
      throw new Error(`Image limit reached (${cap} images allowed)`);
    }

    await ctx.db.insert("workspaceImages", {
      workspaceId: note.workspaceId,
      imageUrl,
      storageId: resource.storageId,
      createdBy: identity.subject,
    });

    await ctx.db.patch(note.workspaceId, {
      instructorImageCount: (workspace.instructorImageCount ?? 0) + 1,
    });

    await ctx.db.patch(args.noteId, {
      imageUrl,
      updatedAt: Date.now(),
    });

    return imageUrl;
  },
});

/**
 * PR #5: updates an existing instructor resource. Currently the only
 * supported mutation is tag/untag-to-call — mirroring
 * `updateWorkspaceNote` (`workspaces.ts:634`) so the "Tag to current
 * call" toggle on each resource row uses the same arg shape as the
 * Notes / Links / Images toggles.
 *
 * Arg shape mirrors `updateWorkspaceNote`:
 *   - `sessionId: v.optional(v.id("sessions"))` — set to retag.
 *   - `clearSessionId: v.optional(v.boolean())` — `true` to clear.
 * Boolean instead of `sessionId: null` so callers never overload a
 * single optional arg with two meanings.
 */
export const updateInstructorResource = mutation({
  args: {
    id: v.id("instructorResources"),
    sessionId: v.optional(v.id("sessions")),
    clearSessionId: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { workspace } = await assertResourceBelongsToInstructor(ctx, {
      resourceId: args.id,
    });

    // Reject sessionIds that do not belong to this resource's
    // workspace. Same pattern as `updateWorkspaceNote` and
    // `createWorkspaceLink` — a client cannot retag a resource to a
    // session on a different workspace.
    await assertSessionBelongsToWorkspace(ctx, {
      sessionId: args.sessionId,
      workspaceId: workspace._id,
    });

    const patch: Record<string, unknown> = {};
    if (args.sessionId !== undefined && args.clearSessionId === true) {
      throw new Error(
        "updateInstructorResource: pass either sessionId or clearSessionId, not both",
      );
    }
    if (args.sessionId !== undefined) {
      patch.sessionId = args.sessionId;
    }
    if (args.clearSessionId === true) {
      patch.sessionId = undefined;
    }
    // Greptile R0 (PR #5): surface the misuse immediately instead of
    // silently writing an empty patch. Mirrors the no-op guards in
    // `updateWorkspaceNote` and `createWorkspaceLink`.
    if (Object.keys(patch).length === 0) {
      throw new Error(
        "updateInstructorResource: no fields to update — pass sessionId or clearSessionId",
      );
    }
    await ctx.db.patch(args.id, patch);
    return await ctx.db.get(args.id);
  },
});

/**
 * PR #5: returns instructor resources tagged to the currently active
 * call (`sessionId` set + non-deleted) for the given workspace.
 * Drives the resource side of the "Shared during current call"
 * subpanel in the Links tab while a video call is in progress.
 *
 * Why a new query instead of reusing `getInstructorResources`:
 * 1. **Indexed.** Uses the new `by_workspaceId_sessionId` compound
 *    index (added in this PR) so the read is O(matched resources),
 *    not O(workspace resources). For a typical call this is
 *    single-digit rows.
 * 2. **Auth bound to the session, not the instructor.** Uses
 *    `assertParticipantForSession` (mirrors `getSharedLinksForActiveSession`
 *    at `workspaces.ts:927`) so any participant on the session can
 *    read tagged resources — including the student, who doesn't have
 *    an `instructorResources` query of their own. A token from a
 *    different workspace cannot pass `assertParticipantForSession`.
 * 3. **No fallback to call-window timestamps.** Pre-PR #5 resources
 *    have `sessionId === undefined` and won't match the index.
 *    Documented limitation matching `getSharedLinksForActiveSession`
 *    (workspaces.ts:917).
 *
 * Returns the same enriched shape as `getInstructorResources`
 * (including `url` from `ctx.storage.getUrl`) so callers can render
 * the row uniformly in the subpanel.
 */
export const getSharedResourcesForActiveSession = query({
  args: {
    workspaceId: v.id("workspaces"),
    sessionId: v.id("sessions"),
  },
  handler: async (ctx, args) => {
    // Cross-check the supplied workspaceId against the workspace the
    // session actually belongs to. `assertParticipantForSession`
    // returns `{ workspace }` from the session's own instructorId/
    // ownerId lookup; if `args.workspaceId` does not match that
    // workspace, the caller has passed a mismatched id. Reject
    // explicitly so a misuse surfaces as an error rather than a
    // silent empty result — same Greptile R1 P2 fix as the links
    // subpanel.
    const { workspace } = await assertParticipantForSession(ctx, args);
    if (workspace._id !== args.workspaceId) {
      throw new Error("Workspace does not match this session");
    }

    const rows = await ctx.db
      .query("instructorResources")
      .withIndex("by_workspaceId_sessionId", (q) =>
        q
          .eq("workspaceId", args.workspaceId)
          .eq("sessionId", args.sessionId)
      )
      .collect();

    const filtered = rows.filter((r) => r.deletedAt === undefined);
    const enriched = await Promise.all(
      filtered.map(async (r) => ({
        ...r,
        url: (await ctx.storage.getUrl(r.storageId)) ?? null,
      }))
    );
    return enriched.sort((a, b) => b._creationTime - a._creationTime);
  },
});

/**
 * PR #5: test/seed-only internal mutation. Inserts a `sessions` row
 * with `callStartedAt` already populated so the
 * `useCurrentOrUpcomingSessionForWorkspace` query returns an
 * `active` session for the E2E spec — the join-window check in
 * `markCallStarted` (sessions.ts:1861) prevents a normal
 * admin-driven seed from doing this directly.
 *
 * **Internal-only** (Convex guideline #84): registered as
 * `internalMutation` so it is NOT exposed to the public HTTP
 * endpoint. Only callable from server-side admin contexts (the
 * `npx convex run` CLI used by `scripts/seed-test-workspaces.ts`,
 * which authenticates with the deploy key). Callers must pass
 * `confirmSeed: true` as defense-in-depth.
 */
export const seedActiveSessionForE2E = internalMutation({
  args: {
    instructorId: v.id("instructors"),
    studentId: v.string(),
    sessionPackId: v.id("sessionPacks"),
    videoRoomName: v.string(),
    scheduledAt: v.optional(v.number()),
    confirmSeed: v.literal(true),
  },
  handler: async (ctx, args) => {
    if (args.confirmSeed !== true) {
      throw new Error("seedActiveSessionForE2E requires confirmSeed: true");
    }
    const sessionId = await ctx.db.insert("sessions", {
      instructorId: args.instructorId,
      studentId: args.studentId,
      sessionPackId: args.sessionPackId,
      scheduledAt: args.scheduledAt ?? Date.now(),
      status: "scheduled",
      recordingConsent: false,
      instructorRecordingConsent: false,
      studentRecordingConsent: false,
      videoRoomName: args.videoRoomName,
      callStartedAt: Date.now(),
    });
    return sessionId;
  },
});
