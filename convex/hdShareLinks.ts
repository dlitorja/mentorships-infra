import { query, mutation, QueryCtx, MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";

async function getCurrentUser(ctx: QueryCtx | MutationCtx): Promise<Doc<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  const user = await ctx.db
    .query("users")
    .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
    .first();
  return user ?? null;
}

async function requireUser(ctx: QueryCtx | MutationCtx): Promise<Doc<"users">> {
  const user = await getCurrentUser(ctx);
  if (!user) throw new Error("Unauthorized");
  return user;
}

function isActive(share: { revokedAt?: number; expiresAt?: number }, now: number): boolean {
  if (share.revokedAt !== undefined) return false;
  if (share.expiresAt !== undefined && share.expiresAt <= now) return false;
  return true;
}

export const createShareLink = mutation({
  args: {
    uploadLegacyId: v.string(),
    token: v.string(),
    label: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);

    if (user.role !== "instructor" && user.role !== "admin" && user.role !== "video_editor") {
      throw new Error("Forbidden: cannot create share links");
    }

    const upload = await ctx.db
      .query("instructorUploads")
      .withIndex("by_legacyId", (q) => q.eq("legacyId", args.uploadLegacyId))
      .first();
    if (!upload) throw new Error("Upload not found");
    if (upload.status === "deleted") throw new Error("Cannot share a deleted file");

    const existing = await ctx.db
      .query("hdShareLinks")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();
    if (existing) throw new Error("Token collision; please retry");

    const shareId: Id<"hdShareLinks"> = await ctx.db.insert("hdShareLinks", {
      uploadId: upload._id,
      token: args.token,
      createdByUserId: user.userId,
      createdAt: Date.now(),
      expiresAt: args.expiresAt,
      revokedAt: undefined,
      label: args.label,
    });

    return { shareId, token: args.token, uploadId: upload._id };
  },
});

export const revokeShareLink = mutation({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);

    const share = await ctx.db
      .query("hdShareLinks")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();
    if (!share) throw new Error("Share not found");

    if (share.createdByUserId !== user.userId && user.role !== "admin") {
      throw new Error("Forbidden: only the creator or an admin can revoke");
    }

    if (share.revokedAt === undefined) {
      await ctx.db.patch(share._id, { revokedAt: Date.now() });
    }
    return { shareId: share._id, revokedAt: share.revokedAt ?? Date.now() };
  },
});

export const extendShareLink = mutation({
  args: {
    token: v.string(),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);

    const share = await ctx.db
      .query("hdShareLinks")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();
    if (!share) throw new Error("Share not found");

    if (share.createdByUserId !== user.userId && user.role !== "admin") {
      throw new Error("Forbidden: only the creator or an admin can extend");
    }

    if (share.revokedAt !== undefined) {
      throw new Error("Cannot extend a revoked share");
    }

    await ctx.db.patch(share._id, {
      expiresAt: args.expiresAt,
    });
    return { shareId: share._id, expiresAt: args.expiresAt ?? null };
  },
});

export const listMyShareLinks = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);

    const limit = Math.min(args.limit ?? 100, 200);
    const shares = await ctx.db
      .query("hdShareLinks")
      .withIndex("by_createdByUserId_createdAt", (q) =>
        q.eq("createdByUserId", user.userId)
      )
      .order("desc")
      .take(limit);

    const now = Date.now();

    const items = await Promise.all(
      shares.map(async (share) => {
        const upload = await ctx.db.get(share.uploadId);
        const accessCount = await ctx.db
          .query("hdShareAccess")
          .withIndex("by_shareId_createdAt", (q) => q.eq("shareId", share._id))
          .collect()
          .then((rows) => rows.length);

        return {
          id: share._id,
          token: share.token,
          uploadId: share.uploadId,
          uploadOriginalName: upload?.originalName ?? null,
          uploadContentType: upload?.contentType ?? null,
          uploadSize: upload?.size ?? null,
          createdAt: share.createdAt,
          expiresAt: share.expiresAt ?? null,
          revokedAt: share.revokedAt ?? null,
          label: share.label ?? null,
          isActive: isActive(share, now),
          accessCount,
        };
      })
    );

    return { items };
  },
});

export const resolveShareByToken = query({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) {
      return { kind: "unauthenticated" as const };
    }

    const share = await ctx.db
      .query("hdShareLinks")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();

    if (!share) {
      return { kind: "not_found" as const };
    }

    // PR1: creator-preview bypass. The share creator (or any admin)
    // can preview their own share without requiring the recipient role.
    // Previously only `video_editor` could resolve; an instructor who
    // sent a link to themselves for QA, or an admin auditing a share,
    // would hit `forbidden`.
    const isCreator = share.createdByUserId === user.userId;
    const isAdmin = user.role === "admin";
    const isVideoEditor = user.role === "video_editor";
    if (!isCreator && !isAdmin && !isVideoEditor) {
      return { kind: "forbidden" as const };
    }

    if (share.revokedAt !== undefined) {
      return { kind: "revoked" as const, revokedAt: share.revokedAt };
    }

    const now = Date.now();
    if (share.expiresAt !== undefined && share.expiresAt <= now) {
      return { kind: "expired" as const, expiresAt: share.expiresAt };
    }

    const upload = await ctx.db.get(share.uploadId);
    if (!upload || upload.status === "deleted") {
      return { kind: "file_missing" as const };
    }

    return {
      kind: "ok" as const,
      share: {
        id: share._id,
        token: share.token,
        createdByUserId: share.createdByUserId,
        createdAt: share.createdAt,
        expiresAt: share.expiresAt ?? null,
        label: share.label ?? null,
      },
      upload: {
        id: upload._id,
        originalName: upload.originalName,
        contentType: upload.contentType,
        size: upload.size,
        filename: upload.filename,
      },
    };
  },
});

export const logShareAccess = mutation({
  args: {
    shareId: v.id("hdShareLinks"),
    action: v.union(v.literal("view"), v.literal("download")),
    ip: v.optional(v.string()),
    userAgent: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    await ctx.db.insert("hdShareAccess", {
      shareId: args.shareId,
      viewerUserId: identity.subject,
      action: args.action,
      ip: args.ip,
      userAgent: args.userAgent,
      createdAt: Date.now(),
    });
    return { success: true };
  },
});
