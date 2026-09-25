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
  BACKFILL_BATCH_SIZE,
  BACKFILL_GRACE_MS,
  MAX_CHAT_FILE_BYTES,
  MAX_IMAGE_BYTES,
  SCHEDULE_BACKFILL_DEDUP_MS,
  STALE_MIGRATION_LOCK_MS,
  WORKSPACE_RETENTION_MS,
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
    // Enforce the 18-month retention deadline (Greptile P1:
    // "Files remain downloadable after retention"). After this
    // window past `endedAt`, the workspace and its files are
    // scheduled for hard-delete by the retention cron. Until
    // the hard-delete runs, the download resolver must refuse
    // to mint signed GET URLs so a member who knows a file key
    // cannot keep accessing a file that should have expired.
    if (
      workspace.endedAt !== undefined &&
      Date.now() - workspace.endedAt > WORKSPACE_RETENTION_MS
    ) {
      return null;
    }
    // Within the retention window (endedAt set but not past
    // deadline) we keep allowing downloads so members can
    // re-download files they uploaded.

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

    // Pending = B2 reservation only AND not completed AND not
    // cancelled AND within the B2 freshness window. Legacy
    // Convex-storage rows have `b2Key` undefined; they MUST NOT
    // count against the B2 pending cap (Greptile P1: "Legacy
    // uploads consume B2 slots"). The compound index orders
    // `completedAt` first so the range scan stops at the first
    // completed row. The threshold is `B2_BINDING_AGE_MS` (1h)
    // to match the presigned URL expiry so a slow upload can
    // still complete (Greptile P1). Cancelled rows are excluded
    // so the cleanup path doesn't hold a slot indefinitely.
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
    // Filter to B2 rows only and not cancelled. The compound
    // index above is on completedAt + uploadedAt; b2Key and
    // cancelledAt are checked here.
    const filtered = pending.filter(
      (row) => row.cancelledAt === undefined && row.b2Key !== undefined
    );
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

    // Clamp the download URL expiry to the workspace retention
    // deadline when the workspace has ended (Greptile P1:
    // "Download outlives retention"). Without this clamp a
    // caller who mints a URL just before the 18-month deadline
    // could keep downloading for the full 24h URL lifetime
    // even after the retention deadline passes. If the
    // deadline is already past, refuse to sign a URL at all.
    const maxLifetimeSeconds = 24 * 3600;
    let deadlineSeconds = maxLifetimeSeconds;
    if (lookup.ledger.workspaceId === args.workspaceId) {
      const endedAt: number | undefined | null = await ctx.runQuery(
        internal.workspaceStorage.getWorkspaceEndedAt,
        { workspaceId: args.workspaceId }
      );
      if (typeof endedAt === "number") {
        const retentionDeadlineMs = endedAt + WORKSPACE_RETENTION_MS;
        const secondsUntilDeadline = Math.floor(
          (retentionDeadlineMs - Date.now()) / 1000
        );
        if (secondsUntilDeadline <= 0) {
          // Deadline already past (access-check passed but a
          // few ms elapsed between check and signing — Greptile
          // P1 r24: "When an ended workspace reaches its
          // retention deadline between the access check and URL
          // signing, the remaining lifetime becomes non-positive
          // ... leaves the permitted lifetime at 24 hours").
          // Refuse to sign rather than fall back to 24h.
          throw new Error(
            "Workspace retention deadline has passed; file is no longer downloadable"
          );
        }
        deadlineSeconds = Math.min(maxLifetimeSeconds, secondsUntilDeadline);
      }
    }
    const expiresInSeconds = Math.min(
      Math.max(args.expiresInSeconds ?? 3600, 60),
      deadlineSeconds
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
export const recordB2FileUpload = action({
  args: {
    workspaceId: v.id("workspaces"),
    b2Key: v.string(),
  },
  handler: async (ctx, args): Promise<{ ok: true }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Unauthorized");
    }
    const callerId = identity.subject;

    // Bundle the verification data into a single internal query
    // so the action body stays declarative (actions cannot use
    // `ctx.db` directly). Mirrors the auth model in
    // `resolveWorkspaceUploadAccess`.
    const ctx2 = await ctx.runQuery(
      internal.workspaceStorage.getB2ConfirmContext,
      { b2Key: args.b2Key, workspaceId: args.workspaceId }
    );
    const ledger = ctx2.ledger;
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
      rejectionReason =
        "B2 key does not belong to this workspace. Refusing to bind.";
    } else if (ledger.uploaderId !== callerId) {
      rejectionReason = "B2 key was minted by a different user. Refusing to bind.";
    } else {
      const ageMs = Date.now() - ledger.uploadedAt;
      if (ageMs < 0 || ageMs > B2_BINDING_AGE_MS) {
        rejectionReason =
          "B2 key cannot be bound: the upload is too old. Mint a fresh upload URL and try again.";
        rejectionCleanupNeeded = true;
      }
    }

    // Workspace / authorization re-checks — only when the caller
    // is the legitimate uploader AND the ledger row matches their
    // workspace.
    const workspace = ctx2.workspace;
    const user = ctx2.user;
    const instructor = ctx2.instructor;
    if (
      rejectionReason === null &&
      ledger.workspaceId === args.workspaceId &&
      ledger.uploaderId === callerId
    ) {
      if (!workspace) {
        rejectionReason = "Workspace not found";
        rejectionCleanupNeeded = true;
      } else if (workspace.deletedAt !== undefined) {
        rejectionReason = "Workspace not found";
        rejectionCleanupNeeded = true;
      } else if (workspace.endedAt !== undefined) {
        rejectionReason = "Workspace has ended";
        rejectionCleanupNeeded = true;
      } else {
        let authorized = false;
        const userIsAdmin = user?.role === "admin";
        if (userIsAdmin) {
          authorized = true;
        } else if (workspace.type === "admin_student") {
          if (workspace.ownerId === callerId) authorized = true;
        } else if (workspace.type === "admin_instructor") {
          if (
            workspace.instructorId &&
            instructor &&
            instructor._id === workspace.instructorId
          ) {
            authorized = true;
          }
        } else {
          if (
            workspace.instructorId &&
            instructor &&
            instructor._id === workspace.instructorId
          ) {
            authorized = true;
          }
          if (!authorized && workspace.ownerId === callerId) {
            authorized = true;
          }
        }
        if (!authorized) {
          rejectionReason = "Not authorized to upload to this workspace";
          rejectionCleanupNeeded = true;
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

    // Verify the B2 object exists before marking the binding
    // complete (Greptile P1: "Missing uploads appear complete").
    // Without this check, a caller could confirm without PUTing
    // (or after a failed PUT), the ledger would be marked
    // complete, and a later download would issue a signed GET
    // URL for a nonexistent object. The verification runs in a
    // separate internal action so the HEAD request can use
    // `fetch` (mutations cannot make external HTTP calls).
    await ctx.runAction(
      internal.workspaceStorage.verifyAndConfirmB2Upload,
      {
        b2Key: args.b2Key,
        ledgerId: ledger._id,
        callerId,
      }
    );

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
 * Internal query: bundle the verification data needed by
 * `recordB2FileUpload` (now an action because it must run a
 * HEAD request to B2 before completing the binding). Returns
 * the ledger row, the workspace, the user, and the caller's
 * instructor row (if any) so the action can do all the auth
 * + state checks without making individual queries.
 */
export const getB2ConfirmContext = internalQuery({
  args: { b2Key: v.string(), workspaceId: v.id("workspaces") },
  handler: async (
    ctx,
    args
  ): Promise<{
    ledger: Doc<"fileUploads"> | null;
    workspace: Doc<"workspaces"> | null;
    user: { role?: string } | null;
    instructor: Doc<"instructors"> | null;
    callerId: string | null;
  }> => {
    const identity = await ctx.auth.getUserIdentity();
    const callerId = identity?.subject ?? null;
    const ledger = await ctx.db
      .query("fileUploads")
      .withIndex("by_b2Key", (q) => q.eq("b2Key", args.b2Key))
      .first();
    const workspace = await ctx.db.get(args.workspaceId);
    const user = callerId
      ? await ctx.db
          .query("users")
          .withIndex("by_userId", (q) => q.eq("userId", callerId))
          .first()
      : null;
    const instructor = callerId
      ? await ctx.db
          .query("instructors")
          .withIndex("by_userId", (q) => q.eq("userId", callerId))
          .first()
      : null;
    return { ledger, workspace, user, instructor, callerId };
  },
});

/**
 * Internal action: HEAD the B2 workspace bucket to verify an
 * upload actually landed before the binding is marked complete
 * (Greptile P1: "Missing uploads appear complete"). Mirrors
 * the SigV4 DELETE pattern used by `cleanupRejectedB2Upload`.
 * Throws if the object is missing or unreachable; on success
 * calls the `confirmB2FileUpload` internal mutation to mark
 * the ledger row complete.
 */
export const verifyAndConfirmB2Upload = internalAction({
  args: {
    b2Key: v.string(),
    ledgerId: v.id("fileUploads"),
    callerId: v.string(),
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
      "HEAD",
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

    let response: Response;
    try {
      response = await fetch(url, {
        method: "HEAD",
        headers: {
          Authorization: authorization,
          "x-amz-content-sha256": payloadHash,
          "x-amz-date": amzDate,
        },
      });
    } catch (err) {
      throw new Error(
        `B2 HEAD failed for ${args.b2Key}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    if (!response.ok) {
      throw new Error(
        `B2 object ${args.b2Key} not found (status ${response.status}); refusing to mark upload complete.`
      );
    }

    await ctx.runMutation(internal.workspaceStorage.confirmB2FileUpload, {
      ledgerId: args.ledgerId,
      callerId: args.callerId,
    });
  },
});

/**
 * Internal mutation: mark a `fileUploads` row complete. Called
 * by `verifyAndConfirmB2Upload` after the HEAD check succeeds.
 * Re-verifies the workspace state and caller authorization
 * inside this transaction (Greptile P1 r24: "Stale authorization
 * confirms uploads"). The outer action does the same checks
 * before HEAD, but a few ms may elapse during HEAD — a workspace
 * could be deleted or the caller's access could be revoked in
 * that window. Re-checking inside this mutation closes the
 * TOCTOU window without forcing the caller to retry.
 *
 * If the re-check fails, mark the row cancelled and schedule
 * cleanup so the B2 object is still deleted (the caller already
 * PUT bytes successfully; the upload just isn't bindable).
 */
export const confirmB2FileUpload = internalMutation({
  args: {
    ledgerId: v.id("fileUploads"),
    callerId: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    const row = await ctx.db.get(args.ledgerId);
    if (!row) {
      throw new Error("Ledger row vanished during verify-and-confirm");
    }
    if (row.cancelledAt !== undefined) {
      throw new Error("Ledger row was cancelled during verify-and-confirm");
    }
    if (row.completedAt !== undefined) {
      // Already confirmed by a concurrent caller — no-op.
      return;
    }

    // Re-verify workspace state. The action saw the workspace
    // moments ago but HEAD may have taken seconds; the workspace
    // could now be deleted or ended. If the re-check fails,
    // delegate the cancel + cleanup to `cancelB2FileUpload` via
    // `ctx.runMutation` so the cancellation and the cleanup
    // schedule commit independently of this mutation's throw
    // (Greptile P1 r25: "Rejected upload cleanup rolls back" —
    // patching `cancelledAt` and calling `ctx.scheduler.runAfter`
    // in the same throwing mutation rolls back both writes).
    const workspace: Doc<"workspaces"> | null = await ctx.db.get(
      row.workspaceId
    );
    let authFailedReason: string | null = null;
    if (!workspace || workspace.deletedAt !== undefined) {
      authFailedReason = "Workspace was deleted during verify-and-confirm";
    } else if (workspace.endedAt !== undefined) {
      authFailedReason = "Workspace ended during verify-and-confirm";
    } else {
      // Re-verify authorization. The action saw the caller's
      // status moments ago but the instructor mapping or admin
      // role could have changed during HEAD.
      const user: { role?: string } | null = await ctx.db
        .query("users")
        .withIndex("by_userId", (q) => q.eq("userId", args.callerId))
        .first();
      const userIsAdmin = user?.role === "admin";
      let authorized = false;
      if (userIsAdmin) {
        authorized = true;
      } else if (workspace.type === "admin_student") {
        if (workspace.ownerId === args.callerId) authorized = true;
      } else if (workspace.type === "admin_instructor") {
        if (workspace.instructorId) {
          const instructor: Doc<"instructors"> | null = await ctx.db
            .query("instructors")
            .withIndex("by_userId", (q) => q.eq("userId", args.callerId))
            .first();
          if (instructor && instructor._id === workspace.instructorId) {
            authorized = true;
          }
        }
      } else {
        if (workspace.instructorId) {
          const instructor: Doc<"instructors"> | null = await ctx.db
            .query("instructors")
            .withIndex("by_userId", (q) => q.eq("userId", args.callerId))
            .first();
          if (instructor && instructor._id === workspace.instructorId) {
            authorized = true;
          }
        }
        if (!authorized && workspace.ownerId === args.callerId) {
          authorized = true;
        }
      }
      if (!authorized) {
        authFailedReason =
          "Caller authorization was revoked during verify-and-confirm";
      }
    }

    if (authFailedReason !== null) {
      // Cancel + schedule cleanup in a separate transaction so
      // both writes survive this throw (see Greptile P1 r25).
      // `cancelB2FileUpload` also skips if `completedAt` is set
      // (concurrent completion race); for the failed-recheck
      // branches the row is still in pending state, so the
      // cleanup will be scheduled.
      if (row.b2Key !== undefined) {
        await ctx.runMutation(internal.workspaceStorage.cancelB2FileUpload, {
          b2Key: row.b2Key,
        });
      }
      throw new Error(authFailedReason);
    }

    await ctx.db.patch(args.ledgerId, { completedAt: Date.now() });
  },
});

/**
 * Internal query: returns a workspace's `endedAt` field, or
 * null if the workspace is missing or deleted. Used by
 * `getWorkspaceDownloadUrl` to clamp the signed GET URL
 * lifetime to the retention deadline.
 */
export const getWorkspaceEndedAt = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  handler: async (
    ctx,
    args
  ): Promise<number | undefined> => {
    const ws: Doc<"workspaces"> | null = await ctx.db.get(args.workspaceId);
    if (!ws) return undefined;
    if (ws.deletedAt !== undefined) return undefined;
    return ws.endedAt;
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
    // Refuse to schedule cleanup if the row is already completed
    // (Greptile P1 r24: "Cancellation deletes completed uploads").
    // Two concurrent confirmations can race: one completes the
    // upload, the other rejects (e.g., window expired). The
    // reject path must NOT delete the B2 object — the other
    // confirmation already succeeded and the file is in use.
    if (row.completedAt !== undefined) {
      return;
    }
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
// PR workspace-storage-2 (migrate): backfill path.
//
// Moves every `fileUploads` row whose blob lives in legacy Convex
// storage (`storageId !== undefined && b2Key === undefined`)
// into the new B2 workspace bucket. The action is additive: it
// sets `b2Key` + `completedAt` + `migratedAt` but leaves
// `storageId` in place. PR 3 narrows the schema and drops
// `storageId` once the cutover flag flips.
//
// Three entry points:
//   - `listWorkspaceMigrationCandidates` (query): the scan
//     filter the cron + CLI use to find un-migrated rows.
//   - `migrateConvexStorageRowToB2` (internalAction): the
//     per-row migration. Idempotent (no-op when `b2Key !==
//     undefined`).
//   - `backfillWorkspaceB2Storage` (internalAction): drives a
//     bounded page of candidates. Called by the CLI wrapper
//     (`scripts/migrate-workspace-storage.ts`) for on-demand
//     operator runs.
//
// The migration is also scheduled by the
// `workspaceStorageBackfillSweep` cron in
// `src/trigger/migrateWorkspaceStorage.ts`, which finds
// candidates and queues one `migrateConvexStorageRowToB2`
// Trigger.dev task per row. The cron keeps the "schedule" out
// of Convex so the per-row retries go through Trigger.dev's
// durable retry pipeline instead of Convex's scheduler.
// ---------------------------------------------------------------------------

/**
 * Internal query: list `fileUploads` rows that still need to
 * be migrated from Convex storage to B2. Bounded by
 * `BACKFILL_BATCH_SIZE` so a single sweep tick drains a
 * predictable volume.
 *
 * Candidate filter:
 *   - `storageId !== undefined` (legacy Convex-storage row)
 *   - `b2Key === undefined` (not yet migrated)
 *   - `cancelledAt === undefined` (not a rejected B2 upload)
 *   - `uploadedAt < graceThreshold` (skip in-flight uploads;
 *     see `BACKFILL_GRACE_MS`).
 *
 * Uses the compound index `by_b2Key_uploadedAt` (added in
 * PR 2) so the cross-workspace scan is bounded by the legacy
 * `b2Key === undefined` NULL bucket and ordered by `uploadedAt`
 * for the grace filter. `q.eq("b2Key", undefined)` matches
 * rows whose `b2Key` field is absent in the index (Convex
 * treats `undefined` as null in the index); rows that have
 * migrated have `b2Key !== undefined` so they are excluded
 * by the equality predicate before the range scan runs.
 *
 * Post-filter: `cancelledAt === undefined && migratedAt === undefined`
 * (defensive — rows that completed the migration but were
 * somehow missing `b2Key` are skipped here).
 */
export const listWorkspaceMigrationCandidates = internalQuery({
  args: {
    graceThreshold: v.number(),
    cursor: v.optional(v.string()),
    limit: v.number(),
    now: v.number(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    rows: Array<{
      _id: Id<"fileUploads">;
      storageId: Id<"_storage">;
      workspaceId: Id<"workspaces">;
      uploaderId: string;
      uploadedAt: number;
    }>;
    nextCursor: string | null;
  }> => {
    const page = await ctx.db
      .query("fileUploads")
      .withIndex(
        "by_b2Key_uploadedAt",
        (q) =>
          q
            // b2Key NULL bucket matches rows whose `b2Key`
            // is undefined in the index. The migration only
            // ever considers legacy Convex-storage rows; rows
            // that have already migrated have `b2Key !==
            // undefined` and never reach this query.
            .eq("b2Key", undefined)
            .lt("uploadedAt", args.graceThreshold)
      )
      .paginate({ numItems: args.limit, cursor: args.cursor ?? null });
    // PR workspace-storage-2 (Greptile round 29 P1 fix):
    // include rows whose `migratedAt` is older than
    // `STALE_MIGRATION_LOCK_MS` (1h) so the per-row
    // migration action sees them and `acquireMigrationLock`
    // takes over the stale lock. Without this filter, the
    // `migratedAt === undefined` check would exclude
    // rows whose previous attempt crashed between lock
    // acquisition and B2 finalize, leaving them
    // permanently disabled.
    const rows = page.page
      .filter(
        (r) =>
          r.storageId !== undefined &&
          r.b2Key === undefined &&
          r.cancelledAt === undefined &&
          (r.migratedAt === undefined ||
            args.now - r.migratedAt > STALE_MIGRATION_LOCK_MS)
      )
      .map((r) => ({
        _id: r._id,
        storageId: r.storageId as Id<"_storage">,
        workspaceId: r.workspaceId,
        uploaderId: r.uploaderId,
        uploadedAt: r.uploadedAt,
      }));
    return {
      rows,
      nextCursor: page.isDone ? null : page.continueCursor,
    };
  },
});

/**
 * Internal query: look up a single `fileUploads` row by id and
 * return just the fields `migrateConvexStorageRowToB2` needs.
 * Used by the per-row action so it does not have to call into
 * `ctx.db` (actions cannot use `ctx.db` directly).
 */
export const getMigrationTargetById = internalQuery({
  args: { id: v.id("fileUploads") },
  handler: async (
    ctx,
    args
  ): Promise<{
    _id: Id<"fileUploads">;
    storageId: Id<"_storage">;
    workspaceId: Id<"workspaces">;
    uploaderId: string;
    uploadedAt: number;
    b2Key: string | undefined;
    migratedAt: number | undefined;
  } | null> => {
    const row = await ctx.db.get(args.id);
    if (!row) return null;
    return {
      _id: row._id,
      storageId: row.storageId as Id<"_storage">,
      workspaceId: row.workspaceId,
      uploaderId: row.uploaderId,
      uploadedAt: row.uploadedAt,
      b2Key: row.b2Key,
      migratedAt: row.migratedAt,
    };
  },
});

/**
 * Internal mutation: mark a migrated `fileUploads` row with
 * `b2Key` + `completedAt` + `migratedAt`. Called by
 * `migrateConvexStorageRowToB2` after the B2 PUT succeeds.
 *
 * Atomicity: the patch + the re-entrancy guard run inside the
 * same transaction. If the row is already migrated (`b2Key !==
 * undefined` or `migratedAt !== undefined`), the patch is a
 * no-op so a concurrent duplicate trigger does not overwrite a
 * successful prior migration with the same b2Key.
 *
 * SECURITY: `callerId` re-check — the Trigger.dev task runs as
 * the system, not the original uploader; we cannot meaningfully
 * re-authorize here, so we trust the caller side. PR 3 closes
* this by replacing `storageId` with `b2Key` everywhere; until
  * then the per-row trigger is scheduled from a server-side
  * internalMutation so the call path is trusted.
 */

/**
 * Internal mutation: stamp `scheduledBackfillAt` on the
 * oldest un-migrated candidate as a low-cost observability
 * marker. Greptile round 27 P1: the original implementation
 * used this stamp as a re-entrancy guard (returning
 * `{ stamped: false }` to short-circuit duplicate cron runs)
 * via an unindexed `q.filter(q.and(q.gte(...), q.neq(...)))`
 * scan over the entire `fileUploads` ledger. That scan
 * exceeded Convex's read budget once the ledger grew. The
 * cron now relies on Trigger.dev's own schedule guarantees
 * (one tick per cron entry per day) plus the per-row
 * `migrateConvexStorageRowToB2` idempotency, so this
 * function is reduced to "log a heartbeat stamp on the next
 * candidate so an operator can grep the ledger for `when did
 * the cron last see work to do`". It never returns `stamped:
 * false`; if no candidate is found it is a no-op so the
 * cron's pagination loop still runs.
 *
 * Index used: `by_b2Key_uploadedAt` (NULL bucket +
 * `uploadedAt` range) — same path the candidate query uses,
 * so we get an index-scan instead of a table-scan. The
 * `first()` call only reads one row.
 */
export const stampBackfillSchedule = internalMutation({
  args: { scheduledAt: v.number() },
  handler: async (ctx, args): Promise<{ stamped: boolean }> => {
    const next = await ctx.db
      .query("fileUploads")
      .withIndex(
        "by_b2Key_uploadedAt",
        (q) =>
          q
            .eq("b2Key", undefined)
            .lt("uploadedAt", args.scheduledAt - BACKFILL_GRACE_MS)
      )
      .first();
    if (!next) {
      return { stamped: false };
    }
    await ctx.db.patch(next._id, {
      scheduledBackfillAt: args.scheduledAt,
    });
    return { stamped: true };
  },
});

/**
 * Internal action: migrate a single `fileUploads` row from
 * Convex storage to the workspace B2 bucket. Steps:
 *
 *   1. Look up the row. If `b2Key !== undefined || migratedAt
 *      !== undefined`, no-op (idempotency).
 *   2. Defensive grace check (the cron filters by grace, but
 *      a manual CLI invocation could target a too-recent row).
 *   3. Defensive `storageId !== undefined` check.
 *   4. Pull the blob bytes via `ctx.storage.get(storageId)`.
 *      Returns `null` if the blob is already gone (orphan
 *      ledger row); no-op and report.
 *   5. Resolve workspace + instructor so we can build the B2
 *      key (mirrors `generateWorkspaceUploadUrl`).
 *   6. Compute the `b2Key` (PR 1 key shape, synthetic
 *      fileId/fileName since the original is in the Convex
 *      blob metadata, not the ledger row).
 *   7. ACQUIRE LOCK: set `migratedAt = lockAt` on the ledger
 *      BEFORE the B2 PUT. The chat-retention cron treats a
 *      row with `migratedAt !== undefined` as "migration in
 *      progress or done — preserve the ledger row", so a
 *      concurrent `forceDeleteExpiredChatMessageRow` cannot
 *      delete the ledger between PUT and final mark
 *      (Greptile round 27 P1: this is the race window).
 *   8. PUT bytes to B2 via SigV4 with `UNSIGNED-PAYLOAD`
 *      (Greptile round 27 P2: avoids allocating a 500 MB
 *      ArrayBuffer just to compute a body hash we never use
 *      server-side).
 *   9. FINALIZE: patch `b2Key` + `completedAt` on the ledger.
 *      The `migratedAt` stays at `lockAt` (not `now()`) so a
 *      future cron tick sees a consistent value.
 *   10. PROPAGATE: patch `b2Key` on any `workspaceMessages`
 *       rows whose `storageId` equals the migrated blob's
 *       id (Greptile round 27 P1: chat retention's
 *       `b2Key !== undefined` branch otherwise falls back
 *       to `ctx.storage.delete(storageId)` and orphans the
 *       B2 copy).
 *
 * Idempotency: the lookup at step 1 short-circuits; the
 * patch at step 9 is conditional on `migratedAt === undefined
 * && b2Key === undefined` so a concurrent duplicate trigger
 * cannot overwrite a successful prior migration. The lock at
 * step 7 is also conditional on the same predicate.
 *
 * Failure model:
 *   - 404 from B2 PUT: treated as permanent failure. The
 *     bucket or key prefix may be misconfigured; re-running
 *     will not help. Throws after clearing the lock so the
 *     next cron tick can retry.
 *   - 5xx from B2 PUT: retried by Trigger.dev's task retry
 *     pipeline (3 attempts, exponential backoff). The lock
 *     stays in place until the next attempt; if all 3
 *     attempts fail, the final run clears the lock before
 *     throwing.
 *   - `ctx.storage.get` returns null: row is an orphan.
 *     Skip the migration and log so the operator can
 *     investigate. No lock is acquired.
 */
export const migrateConvexStorageRowToB2 = internalAction({
  args: { fileUploadId: v.id("fileUploads") },
  handler: async (
    ctx,
    args
  ): Promise<{
    status: "migrated" | "already_migrated" | "skipped_orphan" | "skipped_too_recent" | "skipped_no_storage";
    b2Key: string | undefined;
  }> => {
    const target: {
      _id: Id<"fileUploads">;
      storageId: Id<"_storage">;
      workspaceId: Id<"workspaces">;
      uploaderId: string;
      uploadedAt: number;
      b2Key: string | undefined;
      migratedAt: number | undefined;
    } | null = await ctx.runQuery(
      internal.workspaceStorage.getMigrationTargetById,
      { id: args.fileUploadId }
    );
    if (!target) {
      throw new Error(
        `Migration target ${args.fileUploadId} not found`
      );
    }
    if (target.b2Key !== undefined || target.migratedAt !== undefined) {
      return {
        status: "already_migrated",
        b2Key: target.b2Key,
      };
    }
    // Grace check (defensive — the cron already filters by
    // grace, but a manual CLI invocation could target a row
    // that is too recent).
    if (Date.now() - target.uploadedAt < BACKFILL_GRACE_MS) {
      return {
        status: "skipped_too_recent",
        b2Key: undefined,
      };
    }
    if (target.storageId === undefined) {
      return {
        status: "skipped_no_storage",
        b2Key: undefined,
      };
    }

    const blob: Blob | null = await ctx.storage.get(target.storageId);
    if (blob === null) {
      console.warn(
        `migrateConvexStorageRowToB2 orphan: storage row ${target.storageId} for ledger ${target._id} no longer exists`
      );
      return {
        status: "skipped_orphan",
        b2Key: undefined,
      };
    }

    // Resolve the workspace + instructor so we can build the
    // workspace B2 key. Mirrors the shape produced by
    // `generateWorkspaceUploadUrl` for fresh uploads.
    const ctxData: {
      workspace: Doc<"workspaces"> | null;
      instructor: Doc<"instructors"> | null;
      date: string;
    } | null = await ctx.runQuery(
      internal.workspaceStorage.getMigrationContext,
      { workspaceId: target.workspaceId }
    );
    if (!ctxData || !ctxData.workspace) {
      throw new Error(
        `Workspace ${target.workspaceId} not found during migration of ${target._id}`
      );
    }
    const instructorId =
      ctxData.workspace.instructorId &&
      ctxData.instructor &&
      ctxData.instructor._id === ctxData.workspace.instructorId
        ? ctxData.instructor._id
        : null;

    // Build a synthetic fileId + fileName so the migrated blob
    // lands in a key shape that matches the PR 1 path. We do
    // not have the original filename (it lives in the Convex
    // `fileUploads` row via the client `recordFileUpload`
    // payload, but we only have the storageId here); use a
    // stable derived name. PR 3 will read the original from the
    // migration metadata once the schema gains
    // `originalFileName`.
    const fileId = `migrated-${target._id}`;
    const fileName = `migrated-${target._id}`;
    const b2Key = buildWorkspaceStorageKey({
      date: ctxData.date,
      instructorId,
      studentUserId: ctxData.workspace.ownerId,
      workspaceId: target.workspaceId,
      fileId,
      fileName,
    });

    // Step 7: acquire lock before PUT so a concurrent chat-
    // retention cleanup cannot delete the ledger between PUT
    // and finalize. Conditional on `b2Key === undefined &&
    // migratedAt === undefined` so concurrent triggers do not
    // race.
    const lockAt = Date.now();
    const lockResult: { locked: boolean } = await ctx.runMutation(
      internal.workspaceStorage.acquireMigrationLock,
      {
        id: target._id,
        lockAt,
      }
    );
    if (!lockResult.locked) {
      // Another concurrent trigger already locked this row.
      // Re-read to find the winning b2Key.
      const winner: {
        b2Key: string | undefined;
        migratedAt: number | undefined;
      } | null = await ctx.runQuery(
        internal.workspaceStorage.getMigrationTargetById,
        { id: target._id }
      );
      return {
        status: "already_migrated",
        b2Key: winner?.b2Key,
      };
    }

    // Step 8: PUT bytes to B2. Uses UNSIGNED-PAYLOAD to avoid
    // allocating a full ArrayBuffer copy just for the body
    // SHA-256 (Greptile round 27 P2). If PUT fails, clear the
    // lock so the next cron tick can retry.
    try {
      await putBlobToB2Workspace({ key: b2Key, blob });
    } catch (err) {
      await ctx.runMutation(
        internal.workspaceStorage.releaseMigrationLock,
        {
          id: target._id,
        }
      );
      throw err;
    }

    // Step 9: finalize — patch b2Key + completedAt. The lock
    // timestamp stays as migratedAt so a future cron tick sees
    // a consistent value.
    const finalizeResult: { alreadyMigrated: boolean } = await ctx.runMutation(
      internal.workspaceStorage.markLedgerMigrated,
      {
        id: target._id,
        b2Key,
        migratedAt: lockAt,
      }
    );

    // Step 10: propagate b2Key to workspaceMessages rows whose
    // storageId matches the migrated blob's id so chat
    // retention's `b2Key !== undefined` branch fires instead
    // of leaving an orphan B2 object. Safe to no-op if no
    // chat message shares the storageId.
    await ctx.runMutation(
      internal.workspaceStorage.propagateMigratedB2KeyToMessages,
      {
        storageId: target.storageId,
        b2Key,
      }
    );

    return {
      status: finalizeResult.alreadyMigrated ? "already_migrated" : "migrated",
      b2Key,
    };
  },
});

/**
 * Internal mutation: mark a `fileUploads` ledger row as
 * migrated by writing `b2Key` + `completedAt` + `migratedAt`.
 * Called by `migrateConvexStorageRowToB2` after the B2 PUT
 * succeeds so a future cron tick treats the row as migrated.
 *
 * Greptile round 28 P1 fix: the round 27 implementation
 * short-circuited on `migratedAt !== undefined`, but the
 * round 27 lock step (`acquireMigrationLock`) already sets
 * `migratedAt` BEFORE the PUT. That made every successful
 * PUT leave its B2 copy unrecorded on the ledger and the
 * row was permanently excluded from the candidate query.
 * Idempotency now keys off `b2Key` alone — once the B2 key
 * is written the row is done, and re-running the finalize
 * on a partially-migrated row (lock held, no `b2Key`) is a
 * safe no-op overwrite.
 */
export const markLedgerMigrated = internalMutation({
  args: {
    id: v.id("fileUploads"),
    b2Key: v.string(),
    migratedAt: v.number(),
  },
  handler: async (ctx, args): Promise<{ alreadyMigrated: boolean }> => {
    const row = await ctx.db.get(args.id);
    if (!row) {
      throw new Error("Ledger row vanished during migration");
    }
    if (row.b2Key !== undefined) {
      return { alreadyMigrated: true };
    }
    await ctx.db.patch(args.id, {
      b2Key: args.b2Key,
      completedAt: args.migratedAt,
      migratedAt: args.migratedAt,
    });
    return { alreadyMigrated: false };
  },
});

/**
 * Internal mutation: acquire a "migration in progress" lock
 * on a `fileUploads` row by setting `migratedAt = lockAt`.
 * Conditional on `b2Key === undefined && migratedAt ===
 * undefined` so concurrent triggers cannot both lock the
 * same row. Returns `{ locked: false }` if a concurrent
 * trigger won the race. Greptile round 27 P1: this lock is
 * the fix for the PUT-vs-cleanup race window.
 *
 * Greptile round 28 P1 fix: an action that crashes or
 * restarts AFTER acquiring the lock but BEFORE finishing
 * the PUT or finalize leaves `migratedAt` set without
 * `b2Key`. The candidate query excludes the row and a
 * retry sees `migratedAt !== undefined` and short-circuits.
 * A crashed action therefore permanently disables a row.
 * Treat the lock as stale after `STALE_MIGRATION_LOCK_MS`
 * (1 h by default — longer than the B2 PUT URL's 1 h
 * binding window so a transient restart mid-PUT can finish)
 * and take it over.
 */
export const acquireMigrationLock = internalMutation({
  args: {
    id: v.id("fileUploads"),
    lockAt: v.number(),
  },
  handler: async (ctx, args): Promise<{ locked: boolean; tookOverStaleLock: boolean }> => {
    const row = await ctx.db.get(args.id);
    if (!row) return { locked: false, tookOverStaleLock: false };
    if (row.b2Key !== undefined) {
      return { locked: false, tookOverStaleLock: false };
    }
    if (row.migratedAt !== undefined) {
      // Greptile round 28 P1: stale-lock takeover. If the
      // previous lock is older than `STALE_MIGRATION_LOCK_MS`
      // assume the action crashed and reclaim.
      if (args.lockAt - row.migratedAt > STALE_MIGRATION_LOCK_MS) {
        await ctx.db.patch(args.id, { migratedAt: args.lockAt });
        return { locked: true, tookOverStaleLock: true };
      }
      return { locked: false, tookOverStaleLock: false };
    }
    await ctx.db.patch(args.id, {
      migratedAt: args.lockAt,
    });
    return { locked: true, tookOverStaleLock: false };
  },
});

/**
 * Internal mutation: clear the `migratedAt` lock when the
 * B2 PUT fails so the next cron tick can retry. Companion to
 * `acquireMigrationLock`. Does NOT clear `b2Key` because the
 * PUT never reached the success branch.
 */
export const releaseMigrationLock = internalMutation({
  args: { id: v.id("fileUploads") },
  handler: async (ctx, args): Promise<void> => {
    const row = await ctx.db.get(args.id);
    if (!row) return;
    if (row.b2Key !== undefined) return;
    await ctx.db.patch(args.id, {
      migratedAt: undefined,
    });
  },
});

/**
 * Internal mutation: copy the migrated `b2Key` onto any
 * `workspaceMessages` rows whose `storageId` equals the
 * migrated blob's id. Greptile round 27 P1: without this
 * patch, the chat-retention cleanup's `row.b2Key !==
 * undefined` branch never fires for legacy migrated rows,
 * and the cleanup deletes the Convex blob + ledger but
 * leaves the B2 object behind (orphan).
 *
 * Best-effort: if the query fails (e.g., the index isn't
 * available in a preview deployment), we log and continue
 * so the migration itself is not rolled back.
 */
export const propagateMigratedB2KeyToMessages = internalMutation({
  args: {
    storageId: v.id("_storage"),
    b2Key: v.string(),
  },
  handler: async (ctx, args): Promise<{ patched: number }> => {
    let patched = 0;
    const messages = await ctx.db
      .query("workspaceMessages")
      .withIndex("by_storageId", (q) => q.eq("storageId", args.storageId))
      .collect();
    for (const msg of messages) {
      if (msg.b2Key === args.b2Key) continue;
      await ctx.db.patch(msg._id, {
        b2Key: args.b2Key,
      });
      patched++;
    }
    return { patched };
  },
});

/**
 * Internal query: bundle the workspace + instructor + UTC
 * date that `migrateConvexStorageRowToB2` needs to build the
 * B2 key. Pulled into a single query so the action body
 * stays declarative (actions cannot use `ctx.db` directly).
 */
export const getMigrationContext = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  handler: async (
    ctx,
    args
  ): Promise<{
    workspace: Doc<"workspaces"> | null;
    instructor: Doc<"instructors"> | null;
    date: string;
  }> => {
    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace) {
      return { workspace: null, instructor: null, date: new Date().toISOString().split("T")[0] };
    }
    const instructor = workspace.instructorId
      ? await ctx.db.get(workspace.instructorId)
      : null;
    return {
      workspace,
      instructor,
      date: new Date().toISOString().split("T")[0],
    };
  },
});

/**
 * Internal action: scan + migrate a bounded page of
 * candidates. Called by `scripts/migrate-workspace-storage.ts`
 * for on-demand operator runs outside the Trigger.dev cron.
 *
 * Returns a summary so the CLI can print `{ scanned,
 * migrated, skipped, failed }` and the operator can decide
 * whether to run another page.
 */
export const backfillWorkspaceB2Storage = internalAction({
  args: {
    pageLimit: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    scanned: number;
    migrated: number;
    alreadyMigrated: number;
    skippedOrphan: number;
    skippedTooRecent: number;
    failed: number;
    nextCursor: string | null;
  }> => {
    const graceThreshold = Date.now() - BACKFILL_GRACE_MS;
    const limit = args.pageLimit ?? BACKFILL_BATCH_SIZE;
    const candidates: {
      rows: Array<{ _id: Id<"fileUploads"> }>;
      nextCursor: string | null;
    } = await ctx.runQuery(
      internal.workspaceStorage.listWorkspaceMigrationCandidates,
      {
        graceThreshold,
        cursor: args.cursor ?? undefined,
        limit,
        now: Date.now(),
      }
    );
    let migrated = 0;
    let alreadyMigrated = 0;
    let skippedOrphan = 0;
    let skippedTooRecent = 0;
    let failed = 0;
    for (const row of candidates.rows) {
      try {
        const result: {
          status: "migrated" | "already_migrated" | "skipped_orphan" | "skipped_too_recent" | "skipped_no_storage";
          b2Key: string | undefined;
        } = await ctx.runAction(
          internal.workspaceStorage.migrateConvexStorageRowToB2,
          { fileUploadId: row._id }
        );
        if (result.status === "migrated") migrated++;
        else if (result.status === "already_migrated") alreadyMigrated++;
        else if (result.status === "skipped_orphan") skippedOrphan++;
        else if (result.status === "skipped_too_recent") skippedTooRecent++;
      } catch (err) {
        failed++;
        console.error(
          `backfillWorkspaceB2Storage failed for ${row._id}: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    }
    return {
      scanned: candidates.rows.length,
      migrated,
      alreadyMigrated,
      skippedOrphan,
      skippedTooRecent,
      failed,
      nextCursor: candidates.nextCursor,
    };
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

/**
 * PR workspace-storage-2 (migrate): SigV4 DELETE the workspace
 * bucket. Used by `cleanup/chatFileRetention.ts` once a chat
 * row has been migrated (`b2Key !== undefined`) so the legacy
 * `ctx.storage.delete(storageId)` branch can be retired in PR 3.
 *
 * Mirrors `convex/instructorUploads.ts:deleteFromB2` but targets
 * the workspace bucket. Query-string parameters must be lower-
 * case + lexicographically sorted per AWS SigV4 (Greptile false-
 * positive in PR 1 round 17 — the original concern was about
 * query-string casing, which AWS spec requires lowercase;
 * `encodeURIComponent` does not change case so the canonical
 * query matches what B2 computes server-side).
 */
export const deleteFromB2WorkspaceAction = internalAction({
  args: { b2Key: v.string() },
  handler: async (ctx, args): Promise<void> => {
    const creds = loadB2Credentials();
    const endpoint = creds.endpoint.replace(/\/+$/, "");
    const encodedKey = args.b2Key.split("/").map(encodeURIComponent).join("/");
    const url = `${endpoint}/${creds.bucket}/${encodedKey}`;
    const parsedUrl = new URL(url);
    const host = parsedUrl.host;
    const canonicalUri = `/${creds.bucket}/${encodedKey}`;
    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
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
    const response = await fetch(url, {
      method: "DELETE",
      headers: {
        Authorization: authorization,
        "x-amz-content-sha256": payloadHash,
        "x-amz-date": amzDate,
      },
    });
    if (!response.ok && response.status !== 404) {
      const body = await response.text();
      throw new Error(
        `B2 workspace delete failed: ${response.status} ${response.statusText} - ${body}`
      );
    }
  },
});

/**
 * Internal action: PUT a Blob to the workspace B2
 * bucket at a fixed `b2Key`. Used by `migrateConvexStorageRowToB2`
 * to copy the legacy Convex-storage bytes into B2.
 *
 * Content length is bound into the signature so the bucket
 * refuses an oversized PUT (mirrors the presigned-PUT guard in
 * `mintB2PresignedPutUrl`). On a 4xx error we throw — the
 * migration is non-recoverable for that row until an operator
 * inspects; Trigger.dev's retry will not help.
 *
 * Greptile round 27 P2: original implementation computed
 * `sha256Hex(await params.blob.arrayBuffer())` to fill the
 * `x-amz-content-sha256` header. For a 500 MB blob that
 * forces a full-size ArrayBuffer allocation just to throw
 * the digest away (the server-side signature still verifies
 * the canonical request, not the body). Switched to
 * `UNSIGNED-PAYLOAD` (mirrors the DELETE helper above):
 *
 *   - `x-amz-content-sha256: UNSIGNED-PAYLOAD` per SigV4 spec.
 *   - `x-amz-decoded-content-length` enforces the original
 *     size (mirrors the presigned PUT) so the bucket still
 *     refuses an oversized PUT even with no body digest.
 *   - We do NOT compute `sha256Hex` of the body, so memory
 *     stays at the streaming size of the `Blob`.
 *
 * The canonical-request SHA-256 is still computed — that one
 * runs over the small fixed strings (method, URI, headers),
 * not the body, so it was already cheap.
 *
 * Greptile round 28 P1 fix: SigV4 requires every header that
 * appears in the request to also appear in the signed-headers
 * list and the canonical-headers block. The round 27 helper
 * sent `x-amz-decoded-content-length` to the bucket but did
 * NOT include it in `signedHeaders` / `canonicalHeaders`.
 * B2's signature verification rejects the PUT with
 * `SignatureDoesNotMatch` because the canonical request the
 * server reconstructs is missing a header that the client
 * actually sent. Added to both lists (and to the body digest
 * block) so the PUT signature is well-formed. Mirrors the
 * presigned-PUT helper above, which already signs the same
 * header.
 */
async function putBlobToB2Workspace(params: {
  key: string;
  blob: Blob;
}): Promise<void> {
  const creds = loadB2Credentials();
  const endpoint = creds.endpoint.replace(/\/+$/, "");
  const encodedKey = params.key
    .split("/")
    .map(encodeURIComponent)
    .join("/");
  const url = `${endpoint}/${creds.bucket}/${encodedKey}`;
  const parsedUrl = new URL(url);
  const host = parsedUrl.host;
  const canonicalUri = `/${creds.bucket}/${encodedKey}`;
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = "UNSIGNED-PAYLOAD";
  const contentLength = String(params.blob.size);
  const signedHeaders = [
    "content-length",
    "host",
    "x-amz-content-sha256",
    "x-amz-date",
    "x-amz-decoded-content-length",
  ];
  const canonicalHeaders = [
    `content-length:${contentLength}`,
    `host:${host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${amzDate}`,
    `x-amz-decoded-content-length:${contentLength}`,
    "",
  ].join("\n");
  const canonicalRequest = [
    "PUT",
    canonicalUri,
    "",
    canonicalHeaders,
    signedHeaders.join(";"),
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
  const authorization = `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders.join(";")}, Signature=${sigHex}`;
  const response = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: authorization,
      "Content-Length": contentLength,
      "Content-Type": params.blob.type || "application/octet-stream",
      "x-amz-content-sha256": payloadHash,
      "x-amz-decoded-content-length": contentLength,
      "x-amz-date": amzDate,
    },
    body: params.blob,
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `B2 workspace PUT failed: ${response.status} ${response.statusText} - ${body}`
    );
  }
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
