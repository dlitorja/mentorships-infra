import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";

import {
  B2_BINDING_AGE_MS,
  MAX_CHAT_FILE_BYTES,
  MAX_IMAGE_BYTES,
} from "./workspaceConstants";

// PR workspace-storage-1: server-side cap on how many pending
// upload URLs a single caller may hold open against one workspace
// at a time. Mirrors PER_UPLOAD_CAP on the client. The action
// enforces this so a caller cannot mint an arbitrary number of
// URLs to inflate B2 storage costs (Greptile P1).
const MAX_PENDING_UPLOADS_PER_WORKSPACE = 20;

/**
 * Workspace storage migration (PR 1 of 3, widen).
 *
 * Uploads flow directly from the browser to a separate B2 bucket
 * (`mentorship-workspace-storage`) so we stop accruing Convex Free
 * plan storage quota. The upload is gated by a presigned PUT URL
 * minted by `generateWorkspaceUploadUrl`; the binding between the
 * uploaded blob and (caller, workspace) is recorded eagerly in the
 * `fileUploads` ledger at mint time so a follow-up chat-create
 * mutation can verify the caller actually drove the upload (Greptile
 * Security P1).
 *
 * PR 1 widens the surface only:
 *   - new uploads MAY go through `generateWorkspaceUploadUrl` and
 *     `recordB2FileUpload` instead of the legacy Convex storage path;
 *   - existing rows and existing create mutations are unchanged;
 *   - PR 2 migrates Convex blobs into B2;
 *   - PR 3 makes the B2 path the only path and drops the fallback.
 *
 * The action lives in the default Convex runtime (V8); the SigV4
 * PUT/GET signing for a single request is small enough to inline
 * without pulling in `@aws-sdk/client-s3`. Mirrors the same pattern
 * used in `convex/instructorUploads.ts`.
 */

function safePathSegment(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100);
}

function isImageContentType(contentType: string): boolean {
  return contentType.toLowerCase().startsWith("image/");
}

function maxSizeForContentType(contentType: string): number {
  return isImageContentType(contentType) ? MAX_IMAGE_BYTES : MAX_CHAT_FILE_BYTES;
}

/**
 * Build the B2 object key for a workspace upload.
 *
 * Shape: `{date}/instructors/{instructorId}/students/{studentUserId}/workspaces/{workspaceId}/{fileId}/{fileName}`
 * Fallback for org-style workspaces (no instructor): `{date}/workspaces/{workspaceId}/{fileId}/{fileName}`
 *
 * The `date/` prefix spreads load across partitions and makes
 * lifecycle-rule prefix scoping easy (added in PR 3).
 */
export function buildWorkspaceStorageKey(args: {
  date: string;
  instructorId: Id<"instructors"> | null;
  studentUserId: string;
  workspaceId: Id<"workspaces">;
  fileId: string;
  fileName: string;
}): string {
  const safeName = safePathSegment(args.fileName);
  const safeFileId = safePathSegment(args.fileId);
  if (args.instructorId) {
    return [
      args.date,
      "instructors",
      safePathSegment(String(args.instructorId)),
      "students",
      safePathSegment(args.studentUserId),
      "workspaces",
      safePathSegment(String(args.workspaceId)),
      safeFileId,
      safeName,
    ].join("/");
  }
  return [
    args.date,
    "workspaces",
    safePathSegment(String(args.workspaceId)),
    safeFileId,
    safeName,
  ].join("/");
}

/**
 * Internal query: resolve the caller's role in a workspace so the
 * action can mint a presigned upload URL only for authorized
 * callers. Returns `null` when the caller is not a member of an
 * active workspace, which the action translates into a stable
 * "Not authorized" error.
 *
 * Convex actions don't have `ctx.db` — they have to delegate
 * authorization to a query. Mirrors
 * `convex/workspaces.ts:getWorkspaceRole` exactly:
 *   - Admin status is checked at query time (a former admin does
 *     not retain access, Greptile P1).
 *   - `admin_instructor` workspaces grant access only to admins
 *     and the assigned instructor; the owner check is skipped
 *     because the owner is the creating admin (Greptile P1).
 *   - `admin_student` workspaces grant access only to admins and
 *     the owner (student).
 *   - `mentorship` workspaces grant access to admins, the
 *     instructor, or the owner (student).
 *   - Ended or deleted workspaces grant nothing (Greptile P1).
 */
export const resolveWorkspaceUploadAccess = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args): Promise<{
    role: "instructor" | "student" | "admin";
    workspace: Doc<"workspaces">;
    studentUserId: string;
  } | null> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const workspace: Doc<"workspaces"> | null = await ctx.db.get(args.workspaceId);
    if (!workspace) return null;
    if (workspace.deletedAt !== undefined) return null;
    if (workspace.endedAt !== undefined) return null;

    const callerId = identity.subject;

    const user: { role?: string } | null = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", callerId))
      .first();
    const userIsAdmin = user?.role === "admin";
    if (userIsAdmin) {
      return { role: "admin", workspace, studentUserId: workspace.ownerId };
    }

    if (workspace.type === "admin_student") {
      if (workspace.ownerId === callerId) {
        return { role: "student", workspace, studentUserId: workspace.ownerId };
      }
      return null;
    }

    if (workspace.type === "admin_instructor") {
      if (workspace.instructorId) {
        const instructor: Doc<"instructors"> | null = await ctx.db
          .query("instructors")
          .withIndex("by_userId", (q) => q.eq("userId", callerId))
          .first();
        if (instructor && instructor._id === workspace.instructorId && instructor.userId) {
          return { role: "instructor", workspace, studentUserId: workspace.ownerId };
        }
      }
      return null;
    }

    // mentorship (or untyped legacy) workspace: admin already
    // returned above; remaining roles are instructor and student.
    if (workspace.instructorId) {
      const instructor: Doc<"instructors"> | null = await ctx.db
        .query("instructors")
        .withIndex("by_userId", (q) => q.eq("userId", callerId))
        .first();
      if (instructor && instructor._id === workspace.instructorId && instructor.userId) {
        return { role: "instructor", workspace, studentUserId: workspace.ownerId };
      }
    }
    if (workspace.ownerId === callerId) {
      return { role: "student", workspace, studentUserId: workspace.ownerId };
    }
    return null;
  },
});

/**
 * Internal query: look up the `fileUploads` ledger row for a
 * `b2Key` so the action can verify the key belongs to the
 * workspace the caller authorized against (Greptile P1: a member
 * of workspace A could otherwise request a download URL for a
 * known key from workspace B).
 */
export const resolveB2FileUploadForKey = internalQuery({
  args: { b2Key: v.string() },
  handler: async (ctx, args): Promise<{
    ledger: Doc<"fileUploads">;
  } | null> => {
    const ledger = await ctx.db
      .query("fileUploads")
      .withIndex("by_b2Key", (q) => q.eq("b2Key", args.b2Key))
      .first();
    if (!ledger) return null;
    return { ledger };
  },
});

/**
 * Internal query: resolve the caller's role for downloading a
 * workspace B2 object. Same role rules as upload, but ended
 * workspaces are still readable during their 18-month retention
 * window (Greptile P1: "Ended workspaces block downloads").
 * Deleted workspaces always reject.
 */
export const resolveWorkspaceDownloadAccess = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args): Promise<{
    role: "instructor" | "student" | "admin";
    workspace: Doc<"workspaces">;
    studentUserId: string;
  } | null> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const workspace: Doc<"workspaces"> | null = await ctx.db.get(args.workspaceId);
    if (!workspace) return null;
    if (workspace.deletedAt !== undefined) return null;
    // Deliberately do NOT reject `endedAt !== undefined` here —
    // ended workspaces are readable during retention
    // (convex/workspaces.ts:getWorkspaceIfNotDeleted documents
    // this 18-month window).

    const callerId = identity.subject;

    const user: { role?: string } | null = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", callerId))
      .first();
    const userIsAdmin = user?.role === "admin";
    if (userIsAdmin) {
      return { role: "admin", workspace, studentUserId: workspace.ownerId };
    }

    if (workspace.type === "admin_student") {
      if (workspace.ownerId === callerId) {
        return { role: "student", workspace, studentUserId: workspace.ownerId };
      }
      return null;
    }

    if (workspace.type === "admin_instructor") {
      if (workspace.instructorId) {
        const instructor: Doc<"instructors"> | null = await ctx.db
          .query("instructors")
          .withIndex("by_userId", (q) => q.eq("userId", callerId))
          .first();
        if (instructor && instructor._id === workspace.instructorId && instructor.userId) {
          return { role: "instructor", workspace, studentUserId: workspace.ownerId };
        }
      }
      return null;
    }

    if (workspace.instructorId) {
      const instructor: Doc<"instructors"> | null = await ctx.db
        .query("instructors")
        .withIndex("by_userId", (q) => q.eq("userId", callerId))
        .first();
      if (instructor && instructor._id === workspace.instructorId && instructor.userId) {
        return { role: "instructor", workspace, studentUserId: workspace.ownerId };
      }
    }
    if (workspace.ownerId === callerId) {
      return { role: "student", workspace, studentUserId: workspace.ownerId };
    }
    return null;
  },
});

/**
 * Internal mutation: reserve a `fileUploads` ledger row keyed by
 * `b2Key`. Combines the cap check + insert into a single
 * transaction so concurrent mint requests cannot exceed the cap
 * (Greptile P1: "the count and insert occur in separate
 * transactions").
 *
 * A row is "pending" when `completedAt === undefined &&
 * uploadedAt > (now - B2_BINDING_AGE_MS)`. The pending count
 * filters by this predicate. Completed uploads (`completedAt !==
 * undefined`) do NOT count toward the cap, so completing an
 * upload frees a slot (Greptile P1: "Completed uploads exhaust
 * pending slots"). Stale rows whose freshness window has elapsed
 * naturally drop out of the count after 5 minutes.
 *
 * The ledger row is retained after completion because the
 * download action needs it to look up the workspace that owns
 * a `b2Key` (Greptile P1: "Confirmed uploads cannot be
 * downloaded").
 */
export const reserveB2FileUploadLedger = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    b2Key: v.string(),
    uploaderId: v.string(),
    uploadedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("fileUploads")
      .withIndex("by_b2Key", (q) => q.eq("b2Key", args.b2Key))
      .first();
    if (existing) {
      throw new Error(
        "B2 key is already reserved. Retry with a fresh fileId."
      );
    }

    // Pending = not completed AND not cancelled AND within the B2
    // freshness window. The compound index orders `completedAt`
    // first so the range scan stops at the first completed row.
    // The threshold is `B2_BINDING_AGE_MS` (1h) to match the
    // presigned URL expiry so a slow upload can still complete
    // (Greptile P1). Cancelled rows are excluded so the cleanup
    // path doesn't hold a slot indefinitely.
    const threshold = args.uploadedAt - B2_BINDING_AGE_MS;
    const pending = await ctx.db
      .query("fileUploads")
      .withIndex(
        "by_workspaceId_uploaderId_completedAt_uploadedAt",
        (q) =>
          q
            .eq("workspaceId", args.workspaceId)
            .eq("uploaderId", args.uploaderId)
            .eq("completedAt", undefined)
            .gt("uploadedAt", threshold)
      )
      .collect();
    // Filter cancelled separately (the compound index above is on
    // completedAt + uploadedAt; cancelledAt is checked here).
    const filtered = pending.filter((row) => row.cancelledAt === undefined);
    if (filtered.length >= MAX_PENDING_UPLOADS_PER_WORKSPACE) {
      throw new Error(
        `Too many pending uploads for this workspace. Complete or cancel existing uploads before minting another.`
      );
    }

    await ctx.db.insert("fileUploads", {
      uploaderId: args.uploaderId,
      workspaceId: args.workspaceId,
      uploadedAt: args.uploadedAt,
      b2Key: args.b2Key,
    });
  },
});

/**
 * Action: mint a Backblaze B2 presigned PUT URL for a workspace
 * upload. The corresponding ledger row is written eagerly so a
 * follow-up chat-create mutation can verify the caller actually
 * drove the upload (Greptile Security P1).
 *
 * Server-side enforcement (Greptile P1 sec): the action validates
 * `size` against `MAX_IMAGE_BYTES` / `MAX_CHAT_FILE_BYTES` so a
 * caller cannot bypass the client-side cap by hitting the action
 * directly with `fetch`. The signed URL itself scopes B2 to accept
 * at most `size` bytes via `content-length` policy enforcement
 * (B2 honors the `x-amz-content-sha256` payload hash; combined
 * with the size cap, oversized PUTs are rejected before they reach
 * storage).
 *
 * Caller-side flow:
 *   1. `generateWorkspaceUploadUrl({ workspaceId, fileId, fileName, contentType, size })`
 *   2. `fetch(uploadUrl, { method: "PUT", body: file })`
 *   3. `recordB2FileUpload({ workspaceId, b2Key })`
 *   4. Pass `b2Key` to the chat-create mutation (PR 3).
 */
export const generateWorkspaceUploadUrl = action({
  args: {
    workspaceId: v.id("workspaces"),
    fileId: v.string(),
    fileName: v.string(),
    contentType: v.string(),
    size: v.number(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ uploadUrl: string; b2Key: string; fileId: string }> => {
    if (!Number.isFinite(args.size) || args.size <= 0) {
      throw new Error("Invalid file size");
    }
    const cap = maxSizeForContentType(args.contentType);
    if (args.size > cap) {
      const capMb = cap / (1024 * 1024);
      throw new Error(
        `File is too large. Maximum size is ${capMb}MB.`
      );
    }

    const access: {
      role: "instructor" | "student" | "admin";
      workspace: Doc<"workspaces">;
      studentUserId: string;
    } | null = await ctx.runQuery(
      internal.workspaceStorage.resolveWorkspaceUploadAccess,
      { workspaceId: args.workspaceId }
    );
    if (!access) {
      throw new Error("Not authorized to upload to this workspace");
    }

    const instructorId =
      access.role === "instructor" && access.workspace.instructorId
        ? access.workspace.instructorId
        : null;

    const date = new Date().toISOString().split("T")[0];
    const b2Key = buildWorkspaceStorageKey({
      date,
      instructorId,
      studentUserId: access.studentUserId,
      workspaceId: args.workspaceId,
      fileId: args.fileId,
      fileName: args.fileName,
    });

    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Unauthorized");
    }

    // Mint the presigned URL BEFORE reserving the ledger row
    // (Greptile P2: "Failed signing consumes upload slots"). If
    // signing throws (e.g. B2 credentials missing), no ledger
    // row exists and the cap is not affected.
    const uploadUrl = await mintB2PresignedPutUrl({
      key: b2Key,
      contentType: args.contentType,
      size: args.size,
    });

    // Server-side request-count cap (Greptile P1): the count check
    // and ledger insert run inside the same internal mutation
    // (`reserveB2FileUploadLedger`) so concurrent mint actions
    // cannot both pass the check and then both insert. Run AFTER
    // signing so a signing failure doesn't consume a slot.
    await ctx.runMutation(internal.workspaceStorage.reserveB2FileUploadLedger, {
      workspaceId: args.workspaceId,
      b2Key,
      uploaderId: identity.subject,
      uploadedAt: Date.now(),
    });

    return { uploadUrl, b2Key, fileId: args.fileId };
  },
});

/**
 * Action: mint a signed GET URL for a workspace blob. The key is
 * verified against the ledger so a member of workspace A cannot
 * fetch a key from workspace B (Greptile P1 sec). TTL bounded to
 * 60s..24h by the action so a misbehaving caller can't ask for a
 * year-long URL.
 */
export const getWorkspaceDownloadUrl = action({
  args: {
    b2Key: v.string(),
    workspaceId: v.id("workspaces"),
    expiresInSeconds: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ url: string; expiresAt: number }> => {
    // Use the download-specific resolver that allows ended
    // workspaces during their retention window (Greptile P1).
    const access: {
      role: "instructor" | "student" | "admin";
      workspace: Doc<"workspaces">;
      studentUserId: string;
    } | null = await ctx.runQuery(
      internal.workspaceStorage.resolveWorkspaceDownloadAccess,
      { workspaceId: args.workspaceId }
    );
    if (!access) {
      throw new Error("Not authorized to access this workspace's files");
    }

    const lookup: { ledger: Doc<"fileUploads"> } | null = await ctx.runQuery(
      internal.workspaceStorage.resolveB2FileUploadForKey,
      { b2Key: args.b2Key }
    );
    if (!lookup) {
      throw new Error("Unknown b2Key");
    }
    if (lookup.ledger.workspaceId !== args.workspaceId) {
      throw new Error(
        "b2Key does not belong to the authorized workspace"
      );
    }
    // Refuse to sign a download URL for a binding that has not
    // been completed yet, or has been cancelled (Greptile P1:
    // "Cancelled uploads remain downloadable"). Cancelled rows
    // are kept around so the upload-binding flow has a record of
    // the rejection, but they MUST NOT produce a signed GET URL
    // — the cleanup action may still be running, or it may have
    // failed, so the B2 object is unreliable as a download
    // source.
    if (lookup.ledger.completedAt === undefined) {
      throw new Error("B2 upload is not available for download");
    }
    if (lookup.ledger.cancelledAt !== undefined) {
      throw new Error("B2 upload is not available for download");
    }

    const expiresInSeconds = Math.min(
      Math.max(args.expiresInSeconds ?? 3600, 60),
      24 * 3600
    );

    const { url, expiresAt } = await mintB2PresignedGetUrl({
      key: args.b2Key,
      expiresInSeconds,
    });

    return { url, expiresAt };
  },
});

/**
 * Mutation: confirms the caller drove the upload for a given
 * `b2Key`. Returns success when the ledger row exists, is bound to
 * the caller's workspace, was created by the same caller, and is
 * within the freshness window. Mirrors the existing
 * `recordFileUpload` shape so client code that already calls it
 * after a Convex storage upload can swap to this without rewriting
 * the surrounding flow.
 */
export const recordB2FileUpload = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    b2Key: v.string(),
  },
  handler: async (ctx, args): Promise<{ ok: true }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Unauthorized");
    }

    // Look up the ledger row first so every rejection path can
    // schedule a B2 cleanup (Greptile P1: "Rejected uploads remain
    // in B2"). When a caller PUTs bytes to B2 before rejection,
    // we mark the row cancelled and schedule `cleanupRejectedB2Upload`
    // to delete the B2 object.
    const ledger = await ctx.db
      .query("fileUploads")
      .withIndex("by_b2Key", (q) => q.eq("b2Key", args.b2Key))
      .first();
    if (!ledger) {
      throw new Error(
        "B2 key is not reserved. Mint a fresh upload URL and try again."
      );
    }
    // Refuse if the ledger row is already cancelled (Greptile P1:
    // "Cancelled row still reaches {ok: true}"). The cleanup
    // action is already scheduled (or already running); telling
    // the caller that the bind succeeded would be a lie. Force
    // them to mint a fresh key.
    if (ledger.cancelledAt !== undefined) {
      throw new Error(
        "This upload was already cancelled. Mint a fresh upload URL and try again."
      );
    }
    // Refuse if the ledger row is already completed (Greptile P1:
    // "cancellation does not guard completed rows"). A second
    // confirmation attempt on the same key — after the bind has
    // already succeeded — must not be allowed to schedule a B2
    // cleanup, because the B2 object is the one the caller
    // successfully uploaded.
    if (ledger.completedAt !== undefined) {
      throw new Error(
        "This upload has already been confirmed. Refusing to bind again."
      );
    }

    // Collect the rejection reason instead of throwing inline so
    // TypeScript can narrow `workspace` past the checks. The throw
    // happens at the end of the validation block. Before the throw
    // we commit the cancel (cancelledAt + scheduled cleanup) via
    // `ctx.runMutation` so the schedule survives the outer throw
    // (Greptile P1: a `ctx.scheduler.runAfter` inside a throwing
    // mutation is rolled back; `ctx.runMutation` commits
    // independently).
    //
    // SECURITY: only schedule a B2 cleanup when the caller is the
    // legitimate uploader AND the ledger row matches the caller's
    // workspace. Otherwise an attacker who knows a `b2Key` could
    // submit a fake `(workspaceId, b2Key)` pair and trigger
    // deletion of another user's completed upload (Greptile P1:
    // "Rejected confirmation deletes other files").
    let rejectionReason: string | null = null;
    let rejectionCleanupNeeded = false;

    if (ledger.workspaceId !== args.workspaceId) {
      // Caller passed a workspaceId that does not own this
      // b2Key. Refuse to bind; do NOT schedule a cleanup (we
      // cannot trust the caller to act on someone else's key).
      rejectionReason =
        "B2 key does not belong to this workspace. Refusing to bind.";
    } else if (ledger.uploaderId !== identity.subject) {
      // Caller is not the original uploader. Same defensive
      // posture as the workspaceId mismatch — refuse without
      // scheduling cleanup.
      rejectionReason = "B2 key was minted by a different user. Refusing to bind.";
    } else {
      const ageMs = Date.now() - ledger.uploadedAt;
      if (ageMs < 0 || ageMs > B2_BINDING_AGE_MS) {
        // Caller is the legitimate uploader and the key matches
        // their workspace — safe to clean up if they reject.
        rejectionReason =
          "B2 key cannot be bound: the upload is too old. Mint a fresh upload URL and try again.";
        rejectionCleanupNeeded = true;
      }
    }

    // Only run workspace / authorization re-checks when the caller
    // is the legitimate uploader AND the ledger row matches their
    // workspace. This is the same security gate as above — never
    // act on a key owned by someone else.
    if (
      rejectionReason === null &&
      ledger.workspaceId === args.workspaceId &&
      ledger.uploaderId === identity.subject
    ) {
      const workspace: Doc<"workspaces"> | null = await ctx.db.get(args.workspaceId);
      if (!workspace) {
        rejectionReason = "Workspace not found";
        // The caller is the legitimate uploader (we passed the
        // uploaderId check above) and the ledger row matches
        // their workspace, but the workspace itself is gone.
        // The PUT bytes in B2 still need cleanup (Greptile P1:
        // "missing or deleted workspace rejects confirmation
        // without scheduling deletion of bytes already PUT to
        // B2").
        rejectionCleanupNeeded = true;
      } else {
        if (workspace.deletedAt !== undefined) {
          rejectionReason = "Workspace not found";
          rejectionCleanupNeeded = true;
        }
        // Confirmation rejects ended workspaces (Greptile P1). A
        // caller who reserved a key while the workspace was active
        // must complete the upload before the workspace ends;
        // otherwise the upload must be discarded so the B2 bucket
        // does not accumulate objects from ended workspaces.
        else if (workspace.endedAt !== undefined) {
          rejectionReason = "Workspace has ended";
          rejectionCleanupNeeded = true;
        }
        // Recheck workspace membership at bind time (Greptile P1). A
        // caller whose access was removed after minting the URL must
        // not be able to confirm the upload. The ledger row's
        // `uploaderId` is no longer a sufficient check on its own.
        //
        // Mirrors `resolveWorkspaceUploadAccess` so the mint-time and
        // bind-time authorization rules stay in sync. (The action
        // path delegates to that query because actions cannot use
        // `ctx.db`; the mutation path runs the same logic inline.)
        else {
          const callerId = identity.subject;
          let authorized = false;
          const user: { role?: string } | null = await ctx.db
            .query("users")
            .withIndex("by_userId", (q) => q.eq("userId", callerId))
            .first();
          const userIsAdmin = user?.role === "admin";
          if (userIsAdmin) {
            authorized = true;
          } else if (workspace.type === "admin_student") {
            if (workspace.ownerId === callerId) authorized = true;
          } else if (workspace.type === "admin_instructor") {
            if (workspace.instructorId) {
              const instructor: Doc<"instructors"> | null = await ctx.db
                .query("instructors")
                .withIndex("by_userId", (q) => q.eq("userId", callerId))
                .first();
              if (instructor && instructor._id === workspace.instructorId) {
                authorized = true;
              }
            }
          } else {
            if (workspace.instructorId) {
              const instructor: Doc<"instructors"> | null = await ctx.db
                .query("instructors")
                .withIndex("by_userId", (q) => q.eq("userId", callerId))
                .first();
              if (instructor && instructor._id === workspace.instructorId) {
                authorized = true;
              }
            }
            if (!authorized && workspace.ownerId === callerId) {
              authorized = true;
            }
          }
          if (!authorized) {
            rejectionReason = "Not authorized to upload to this workspace";
            // The caller is the legitimate uploader (we passed
            // the uploaderId check above) and the key matches
            // their workspace, but they lost access since minting
            // the URL. The PUT bytes in B2 belong to this
            // uploader's session — schedule cleanup so they
            // don't accumulate (Greptile P1: "uploader loses
            // workspace access after a PUT, confirmation rejects
            // without scheduling cleanup").
            rejectionCleanupNeeded = true;
          }
        }
      }
    }

    // If any check rejected, schedule the B2 cleanup in a
    // separate internal mutation (so its writes commit
    // independently of this mutation's throw) and then throw.
    // Only schedule the cleanup when the caller is the
    // legitimate uploader AND the ledger row matches their
    // workspace — otherwise an attacker who knows a `b2Key`
    // could trigger deletion of another user's upload.
    if (rejectionReason !== null) {
      if (rejectionCleanupNeeded) {
        await ctx.runMutation(internal.workspaceStorage.cancelB2FileUpload, {
          b2Key: args.b2Key,
        });
      }
      throw new Error(rejectionReason);
    }

    // Mark the ledger row complete (do NOT delete it). The
    // download action needs the row to look up the workspace
    // that owns this `b2Key` (Greptile P1: "Confirmed uploads
    // cannot be downloaded"). Setting `completedAt` also frees
    // the pending slot — the pending-count query filters rows by
    // `completedAt === undefined` (Greptile P1: "Completed
    // uploads exhaust pending slots").
    //
    // Refuse to mark complete if the ledger row is already
    // cancelled (Greptile P1: "Cancelled upload can be
    // confirmed"). The cleanup action may still be running; if we
    // mark complete now the caller will see a successful bind
    // for a file whose B2 object is about to be deleted.
    if (ledger.completedAt === undefined && ledger.cancelledAt === undefined) {
      await ctx.db.patch(ledger._id, { completedAt: Date.now() });
    }

    return { ok: true };
  },
});

/**
 * Internal action: delete a B2 object for a rejected upload
 * (Greptile P1: "Rejected uploads remain in B2"). Scheduled by
 * `recordB2FileUpload` whenever it rejects a confirmation — by
 * that point the caller may have already PUT bytes to B2, and we
 * must clean those up so the workspace bucket does not
 * accumulate orphan objects. Runs asynchronously after the
 * rejection so the caller still sees the rejection synchronously.
 *
 * Uses a simple SigV4 DELETE against the workspace bucket.
 * Retries up to 3 times with exponential backoff for transient
 * 5xx errors; permanent 4xx errors are logged and the ledger row
 * is marked `cancelledAt` so the upload-binding flow has a
 * record of the rejected upload.
 */
export const cleanupRejectedB2Upload = internalAction({
  args: {
    b2Key: v.string(),
    ledgerId: v.id("fileUploads"),
  },
  handler: async (ctx, args): Promise<void> => {
    const creds = loadB2Credentials();
    const endpoint = creds.endpoint.replace(/\/+$/, "");
    const encodedKey = args.b2Key
      .split("/")
      .map(encodeURIComponent)
      .join("/");
    const url = `${endpoint}/${creds.bucket}/${encodedKey}`;
    const parsedUrl = new URL(url);
    const host = parsedUrl.host;
    const canonicalUri = `/${creds.bucket}/${encodedKey}`;
    const amzDate = new Date()
      .toISOString()
      .replace(/[:-]|\.\d{3}/g, "");
    const dateStamp = amzDate.slice(0, 8);

    const payloadHash = "UNSIGNED-PAYLOAD";
    const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
    const signedHeaders = "host;x-amz-content-sha256;x-amz-date";

    const canonicalRequest = [
      "DELETE",
      canonicalUri,
      "",
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join("\n");

    const credentialScope = `${dateStamp}/${creds.region}/s3/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      credentialScope,
      await sha256Hex(canonicalRequest),
    ].join("\n");

    const encoder = new TextEncoder();
    const kDate = await hmacSha256(
      encoder.encode("AWS4" + creds.secretAccessKey),
      dateStamp
    );
    const kRegion = await hmacSha256(kDate, creds.region);
    const kService = await hmacSha256(kRegion, "s3");
    const kSigning = await hmacSha256(kService, "aws4_request");
    const signature = await hmacSha256(kSigning, stringToSign);
    const sigHex = Array.from(new Uint8Array(signature))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const authorization = `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${sigHex}`;

    // Retry with exponential backoff (in ms): 1s, 4s, 16s.
    // Greptile P1 "failed deletion has no recovery": the previous
    // version retried 3x immediately which doesn't give B2 time
    // to recover from a transient outage; this version spreads
    // retries over ~21s and reschedules the action if all three
    // fail. Trigger.dev / Convex scheduler resumes from the new
    // schedule, so a partially-failed cleanup eventually succeeds
    // without losing the cancelledAt ledger state.
    const backoffsMs = [0, 1000, 4000, 16000];
    let attempt = 0;
    let lastError: string | null = null;
    while (attempt < backoffsMs.length) {
      const delayMs = backoffsMs[attempt];
      if (delayMs > 0) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
      attempt += 1;
      // Wrap the fetch in try/catch so a thrown error (DNS,
      // socket reset, abort) is treated as a transient failure
      // rather than escaping the action (Greptile P1: "cleanup
      // action does not reschedule when its DELETE fetch throws").
      let response: Response;
      try {
        response = await fetch(url, {
          method: "DELETE",
          headers: {
            Authorization: authorization,
            "x-amz-content-sha256": payloadHash,
            "x-amz-date": amzDate,
          },
        });
      } catch (err) {
        lastError = `B2 DELETE network error: ${err instanceof Error ? err.message : String(err)}`;
        continue;
      }
      if (response.ok || response.status === 404) {
        // 404 = object already gone, treat as success.
        lastError = null;
        break;
      }
      if (response.status >= 400 && response.status < 500) {
        // Permanent client error (e.g., 403, 404 on a key the
        // bucket doesn't recognize as an object). Stop retrying —
        // further attempts will not change the outcome.
        lastError = `B2 DELETE permanent error: ${response.status}`;
        break;
      }
      lastError = `B2 DELETE transient error: ${response.status}`;
    }

    if (lastError) {
      if (lastError.startsWith("B2 DELETE permanent")) {
        // Permanent failure (e.g., 403, 404-as-non-object). Do
        // NOT reschedule — repeated retries would consume
        // scheduled executions forever without removing the
        // object (Greptile P2: "Permanent cleanup failures
        // repeat"). Mark the row cancelled so the binding flow
        // has a record and the upload-binding flag stays
        // consistent; the orphan object will need to be cleaned
        // by an operator or via a lifecycle rule.
        console.error(
          `cleanupRejectedB2Upload permanent failure for ${args.b2Key}: ${lastError}; giving up`
        );
      } else {
        // Transient failure (5xx, network error). Reschedule
        // 5 min later so a partial outage can recover.
        console.error(
          `cleanupRejectedB2Upload transient failure for ${args.b2Key} after ${attempt} attempts: ${lastError}; rescheduling in 5 min`
        );
        await ctx.scheduler.runAfter(
          5 * 60 * 1000,
          internal.workspaceStorage.cleanupRejectedB2Upload,
          args
        );
      }
    }

    // Mark the ledger row cancelled so the upload-binding flow has
    // a record of the rejection. Only do this when the cleanup
    // succeeded; if we're rescheduling, leave cancelledAt unset so
    // a retry can run.
    if (!lastError) {
      const row = await ctx.runQuery(
        internal.workspaceStorage.getFileUploadById,
        { id: args.ledgerId }
      );
      if (row) {
        await ctx.runMutation(internal.workspaceStorage.markLedgerCancelled, {
          id: args.ledgerId,
        });
      }
    }
  },
});

/**
 * Internal query: look up a single `fileUploads` row by id.
 * Used by `cleanupRejectedB2Upload` to confirm the row still
 * exists before patching it.
 */
export const getFileUploadById = internalQuery({
  args: { id: v.id("fileUploads") },
  handler: async (ctx, args): Promise<Doc<"fileUploads"> | null> => {
    return await ctx.db.get(args.id);
  },
});

/**
 * Internal mutation: mark a `fileUploads` row cancelled and
 * schedule a B2 cleanup. Runs as a separate transaction so its
 * writes (cancelledAt + scheduled cleanup action) commit
 * independently of any outer mutation's throw (Greptile P1:
 * "scheduling + throw in the same outer mutation rolls back
 * the schedule").
 */
export const cancelB2FileUpload = internalMutation({
  args: { b2Key: v.string() },
  handler: async (ctx, args): Promise<void> => {
    const row = await ctx.db
      .query("fileUploads")
      .withIndex("by_b2Key", (q) => q.eq("b2Key", args.b2Key))
      .first();
    if (!row) return;
    if (row.cancelledAt === undefined) {
      await ctx.db.patch(row._id, { cancelledAt: Date.now() });
    }
    // Schedule the cleanup action AFTER the patch so the cleanup
    // is only scheduled when the ledger row is marked cancelled.
    await ctx.scheduler.runAfter(
      0,
      internal.workspaceStorage.cleanupRejectedB2Upload,
      { b2Key: args.b2Key, ledgerId: row._id }
    );
  },
});

/**
 * Internal mutation: mark a `fileUploads` row cancelled.
 * Called by `cleanupRejectedB2Upload` after the (possibly
 * failed) B2 DELETE so the row is not re-checked.
 */
export const markLedgerCancelled = internalMutation({
  args: { id: v.id("fileUploads") },
  handler: async (ctx, args): Promise<void> => {
    const row = await ctx.db.get(args.id);
    if (!row) return;
    if (row.cancelledAt === undefined) {
      await ctx.db.patch(args.id, { cancelledAt: Date.now() });
    }
  },
});

// ---------------------------------------------------------------------------
// SigV4 helpers — inlined to avoid pulling @aws-sdk/client-s3 into the
// Convex V8 bundle. Mirrors convex/instructorUploads.ts.
// ---------------------------------------------------------------------------

type B2Credentials = {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  endpoint: string;
  bucket: string;
};

function loadB2Credentials(): B2Credentials {
  const accessKeyId = process.env.B2_KEY_ID;
  const secretAccessKey = process.env.B2_APPLICATION_KEY;
  // Workspace bucket lives in `us-east-005`. Deliberately separate
  // from `B2_REGION` (which the existing `packages/storage` client
  // defaults to `us-west-002` for the instructor-uploads bucket).
  // Sharing the constant would let a misconfigured env variable
  // redirect new uploads to the wrong region (Greptile P1).
  const region =
    process.env.WORKSPACE_STORAGE_BUCKET_REGION || "us-east-005";
  const endpoint =
    process.env.WORKSPACE_STORAGE_BUCKET_ENDPOINT ||
    `https://s3.${region}.backblazeb2.com`;
  const bucket =
    process.env.WORKSPACE_STORAGE_BUCKET_NAME || "mentorship-workspace-storage";
  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      "Missing B2 credentials: B2_KEY_ID and B2_APPLICATION_KEY must be set"
    );
  }
  return { accessKeyId, secretAccessKey, region, endpoint, bucket };
}

async function sha256Hex(input: string | ArrayBuffer): Promise<string> {
  const bytes =
    typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hmacSha256(
  key: ArrayBuffer | Uint8Array,
  data: string
): Promise<ArrayBuffer> {
  // crypto.subtle.importKey expects a BufferSource whose `.buffer`
  // is `ArrayBuffer` (not `SharedArrayBuffer`). Slice produces a
  // fresh `ArrayBuffer`, mirroring the pattern in
  // `convex/instructorUploads.ts:hmacSha256`.
  const keyBuffer: ArrayBuffer =
    key instanceof Uint8Array
      ? (key.buffer.slice(
          key.byteOffset,
          key.byteOffset + key.byteLength
        ) as ArrayBuffer)
      : key;
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data));
}

/**
 * Build the lexicographically-sorted canonical query for SigV4
 * presigning. The signed headers (`host`) and the content-sha256
 * marker are part of the canonical query so the browser can PUT
 * without forwarding AWS headers (some browsers strip them on
 * cross-origin PUTs). Greptile P1: the marker must sort with the
 * other parameters, not be appended after sorting, otherwise B2
 * computes a different signature and rejects the URL.
 */
function buildCanonicalQueryString(parts: Record<string, string>): string {
  return Object.keys(parts)
    .sort((a, b) => a.localeCompare(b))
    .map(
      (k) => `${encodeURIComponent(k)}=${encodeURIComponent(parts[k])}`
    )
    .join("&");
}

async function mintB2PresignedPutUrl(params: {
  key: string;
  contentType: string;
  size: number;
}): Promise<string> {
  // PUT URL expiry matches `B2_BINDING_AGE_MS` (1h, see
  // `workspaceConstants.ts`) so a caller can take up to an hour
  // to upload a 500MB file on a slow connection. Once the URL
  // is minted, the binding window is the same as the URL
  // window — a confirmation beyond that window will reject
  // with "key too old".
  //
// Known race: if the caller PUTs, then the confirmation
  // rejects, the cleanup action deletes the B2 object within
  // seconds, but the PUT URL remains valid for up to 1h. If the
  // caller re-PUTs in that window, the object is re-created in
  // B2 as an orphan (the ledger is `cancelledAt` so a
  // subsequent confirmation will fail). PR 3 will add a
  // lifecycle rule that sweeps orphans older than the binding
  // window; PR 1 documents the race.
  const creds = loadB2Credentials();
  const endpoint = creds.endpoint.replace(/\/+$/, "");
  const encodedKey = params.key
    .split("/")
    .map(encodeURIComponent)
    .join("/");
  const url = new URL(`${endpoint}/${creds.bucket}/${encodedKey}`);

  const host = url.host;
  const canonicalUri = `/${creds.bucket}/${encodedKey}`;

  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);

  // Bind the PUT body length into the signature (Greptile P1):
  // signing `content-length` makes the URL valid only for a PUT
  // whose body matches the declared size. The browser's fetch PUT
  // with a File body sends `Content-Length` matching the file
  // size, so a caller cannot PUT a different-sized blob through
  // this URL. Combined with the `x-amz-decoded-content-length`
  // signed query parameter (a B2-specific belt), oversized PUTs
  // are rejected before they reach storage.
  const contentLength = String(params.size);
  const signedHeaders = ["content-length", "host"];
  const canonicalHeaders = `content-length:${contentLength}\nhost:${host}\n`;

  const credentialScope = `${dateStamp}/${creds.region}/s3/aws4_request`;
  const payloadHash = "UNSIGNED-PAYLOAD";

  const algorithm = "AWS4-HMAC-SHA256";
  const credential = `${creds.accessKeyId}/${credentialScope}`;
  const expires = "3600";

  const canonicalQueryString = buildCanonicalQueryString({
    "x-amz-algorithm": algorithm,
    "x-amz-content-sha256": payloadHash,
    "x-amz-credential": credential,
    "x-amz-date": amzDate,
    "x-amz-decoded-content-length": String(params.size),
    "x-amz-expires": expires,
    "x-amz-signedheaders": signedHeaders.join(";"),
  });

  const canonicalRequest = [
    "PUT",
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders.join(";"),
    payloadHash,
  ].join("\n");

  const stringToSign = [
    algorithm,
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  const encoder = new TextEncoder();
  const kDate = await hmacSha256(
    encoder.encode("AWS4" + creds.secretAccessKey),
    dateStamp
  );
  const kRegion = await hmacSha256(kDate, creds.region);
  const kService = await hmacSha256(kRegion, "s3");
  const kSigning = await hmacSha256(kService, "aws4_request");
  const signature = await hmacSha256(kSigning, stringToSign);
  const sigHex = Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  url.search = `?${canonicalQueryString}&x-amz-signature=${sigHex}`;
  return url.toString();
}

async function mintB2PresignedGetUrl(params: {
  key: string;
  expiresInSeconds: number;
}): Promise<{ url: string; expiresAt: number }> {
  const creds = loadB2Credentials();
  const endpoint = creds.endpoint.replace(/\/+$/, "");
  const encodedKey = params.key
    .split("/")
    .map(encodeURIComponent)
    .join("/");
  const url = new URL(`${endpoint}/${creds.bucket}/${encodedKey}`);

  const host = url.host;
  const canonicalUri = `/${creds.bucket}/${encodedKey}`;

  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);

  const signedHeaders = ["host"];
  const canonicalHeaders = `host:${host}\n`;

  const credentialScope = `${dateStamp}/${creds.region}/s3/aws4_request`;
  const payloadHash = "UNSIGNED-PAYLOAD";

  const algorithm = "AWS4-HMAC-SHA256";
  const credential = `${creds.accessKeyId}/${credentialScope}`;

  const canonicalQueryString = buildCanonicalQueryString({
    "x-amz-algorithm": algorithm,
    "x-amz-content-sha256": payloadHash,
    "x-amz-credential": credential,
    "x-amz-date": amzDate,
    "x-amz-expires": String(params.expiresInSeconds),
    "x-amz-signedheaders": signedHeaders.join(";"),
  });

  const canonicalRequest = [
    "GET",
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders.join(";"),
    payloadHash,
  ].join("\n");

  const stringToSign = [
    algorithm,
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  const encoder = new TextEncoder();
  const kDate = await hmacSha256(
    encoder.encode("AWS4" + creds.secretAccessKey),
    dateStamp
  );
  const kRegion = await hmacSha256(kDate, creds.region);
  const kService = await hmacSha256(kRegion, "s3");
  const kSigning = await hmacSha256(kService, "aws4_request");
  const signature = await hmacSha256(kSigning, stringToSign);
  const sigHex = Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  url.search = `?${canonicalQueryString}&x-amz-signature=${sigHex}`;
  return {
    url: url.toString(),
    expiresAt: Date.now() + params.expiresInSeconds * 1000,
  };
}
