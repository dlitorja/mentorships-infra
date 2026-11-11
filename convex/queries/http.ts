import { internalQuery, query } from "../_generated/server";
import { v } from "convex/values";
import { Id } from "../_generated/dataModel";
import { getWorkspaceImageSetUpdatedAt } from "../lib/workspaceImageSet";
import { getWorkspaceLinkSetUpdatedAt } from "../lib/workspaceLinkSet";

const EIGHTEEN_MONTHS_MS = 18 * 30 * 24 * 60 * 60 * 1000;
const dayMs = 24 * 60 * 60 * 1000;

/** Finds workspaces past the 18-month retention window that haven't been marked as deleted. */
export const getWorkspacesNeedingDeletion = query({
  handler: async (ctx) => {
    const cutoff = Date.now() - EIGHTEEN_MONTHS_MS;
    const workspaces = await ctx.db
      .query("workspaces")
      .withIndex("by_endedAt", (q) => q.lt("endedAt", cutoff))
      .filter((q) => q.or(q.eq(q.field("deletedAt"), undefined), q.gt(q.field("deletedAt"), cutoff)))
      .collect();

    return workspaces.map(w => ({ id: w._id, endedAt: w.endedAt, ownerId: w.ownerId, instructorId: w.instructorId }));
  },
});

/** Finds workspaces within 7, 30, or 90 days of deletion that require a retention notification. */
export const getWorkspacesForNotification = query({
  handler: async (ctx) => {
    const now = Date.now();
    const notifications: { workspaceId: string; userId: string; daysUntilDeletion: number }[] = [];

    const cutoff = Date.now() + EIGHTEEN_MONTHS_MS;
    const workspaces = await ctx.db
      .query("workspaces")
      .withIndex("by_endedAt", (q) => q.gt("endedAt", 0))
      .filter((q) => q.lt(q.field("endedAt"), cutoff))
      .collect();

    // Bulk-fetch all seat reservations to avoid N+1 queries inside the loop
    const allSeats = await ctx.db
      .query("seatReservations")
      .collect();
    const seatSet = new Set(
      allSeats.map((s) => `${String(s.instructorId)}:${s.userId}`)
    );

    for (const workspace of workspaces) {
      if (!workspace.endedAt) continue;
      if (!workspace.instructorId) continue;

      const daysUntilDeletion = Math.floor(
        (workspace.endedAt! + EIGHTEEN_MONTHS_MS - now) / dayMs
      );

      const inWindow = (days: number) =>
        (days >= 89 && days <= 91) ||
        (days >= 29 && days <= 31) ||
        (days >= 6 && days <= 8);

      if (inWindow(daysUntilDeletion)) {
        const key = `${String(workspace.instructorId)}:${workspace.ownerId}`;
        if (seatSet.has(key)) {
          notifications.push({
            workspaceId: String(workspace._id),
            userId: workspace.ownerId,
            daysUntilDeletion,
          });
        }
      }
    }

    return notifications;
  },
});

/** Looks up a user's email address by either platform or auth-provider ID. */
export const getUserEmail = query({
  args: { clerkId: v.string() },
  handler: async (ctx, args) => {
    const { clerkId } = args;

    const platformUser = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", clerkId))
      .first();
    const user = platformUser ?? await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", clerkId))
      .first();

    return { email: user?.email ?? null };
  },
});

export const getUserIdByEmail = query({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .first();
    return { id: user?._id ?? null };
  },
});

/**
 * Legacy `imageUrl` values are client-supplied columns. Only two
 * shapes are legitimate: an inline `data:image/...` payload, or a
 * Convex storage URL minted by `ctx.storage.getUrl` (which lives on
 * `*.convex.cloud`). Anything else is rejected before it can reach the
 * server-side `fetch` in the export task — otherwise a row could turn
 * the export worker into an SSRF proxy against internal addresses.
 */
function isTrustedLegacyImageUrl(url: string): boolean {
  if (url.startsWith("data:image/")) return true;
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      /(^|\.)convex\.cloud$/.test(parsed.hostname)
    );
  } catch {
    return false;
  }
}

/** Fetches a workspace's non-deleted notes and images for data export,
 * or its shared links when `scope === "links"`.
 * When `imageIds` is provided, only those images are included; otherwise
 * all non-deleted images are exported.
 *
 * `scope: "links"` returns only `workspaceName` + `links` so the Links
 * tab export never pays for loading note bodies and image rows it does
 * not need.
 *
 * Internal: workspace membership is not checked here because this is
 * only reachable from `convex/http.ts` behind `CONVEX_HTTP_KEY` (the
 * export Trigger tasks). It used to be public, which let any signed-in
 * client read another workspace's notes, images, and — after the Links
 * export landed — private shared links by guessing a workspace id.
 */
export const getWorkspaceExportData = internalQuery({
  args: {
    workspaceId: v.id("workspaces"),
    imageIds: v.optional(v.array(v.id("workspaceImages"))),
    linkIds: v.optional(v.array(v.id("workspaceLinks"))),
    scope: v.optional(
      v.union(
        v.literal("workspace"),
        v.literal("images"),
        v.literal("links")
      )
    ),
  },
  handler: async (ctx, args) => {
    const { workspaceId, imageIds, linkIds, scope } = args;

    const workspace = await ctx.db.get(workspaceId);
    if (!workspace) {
      throw new Error("Workspace not found");
    }

    if (scope === "links") {
      // Snapshot before reading rows — see the image-set note below.
      const linkSetUpdatedAt = await getWorkspaceLinkSetUpdatedAt(
        ctx,
        workspaceId
      );

      const allLinks = await ctx.db
        .query("workspaceLinks")
        .withIndex("by_workspaceId_and_deletedAt", (q) =>
          q.eq("workspaceId", workspaceId).eq("deletedAt", undefined)
        )
        .collect();
      const links =
        linkIds && linkIds.length > 0
          ? allLinks.filter((link) => linkIds.includes(link._id))
          : allLinks;
      // Newest first — matches the Links tab ordering.
      links.sort((a, b) => b._creationTime - a._creationTime);
      return {
        workspaceName: workspace.name || "Workspace",
        links: links.map((link) => ({
          url: link.url,
          title: link.title,
          createdBy: link.createdBy,
          sessionId: link.sessionId,
          createdAt: link._creationTime,
        })),
        linkSetUpdatedAt,
      };
    }

    // The Images tab export is exactly that: images. Notes only belong
    // in the legacy full-workspace ZIP (`scope` absent/workspace), so
    // skip the query entirely for `images` — it saves reads and keeps
    // the archive from carrying an unexpected `notes.md`.
    const notes =
      scope === "images"
        ? []
        : await ctx.db
            .query("workspaceNotes")
            .withIndex("by_workspaceId_and_deletedAt", (q) =>
              q.eq("workspaceId", workspaceId).eq("deletedAt", undefined)
            )
            .collect();

    // Snapshot the image-set state BEFORE reading the rows: the
    // recorded "as of" value must not be newer than the data actually
    // included. An upload landing after this point makes the finished
    // archive look stale (safe: the user can re-export) rather than
    // claiming it is current when the image was captured later.
    const imageSetUpdatedAt =
      scope === "images"
        ? await getWorkspaceImageSetUpdatedAt(ctx, workspaceId)
        : null;

    const allImages = await ctx.db
      .query("workspaceImages")
      .withIndex("by_workspaceId_and_deletedAt", (q) =>
        q.eq("workspaceId", workspaceId).eq("deletedAt", undefined)
      )
      .collect();

    const images =
      imageIds && imageIds.length > 0
        ? allImages.filter((img) => imageIds.includes(img._id))
        : allImages;

    // PR workspace-storage-3c+: the export trigger reads B2 objects
    // directly with the S3 SDK, so this query only has to hand over the
    // `b2Key` (plus a name hint). Previously it also minted a presigned
    // GET URL per image, which the task then re-fetched over HTTPS —
    // one signature per image plus an extra network hop for bytes the
    // task could stream straight from the bucket.
    //
    // Legacy rows still need resolving: `imageUrl` can be a `data:`
    // URI (very old) or a Convex storage URL (pre-B2).
    const imagesWithUrls = await Promise.all(
      images.map(async (img) => {
        if (img.b2Key !== undefined) {
          return {
            // Empty string on purpose: the task branches on `b2Key`
            // first and never reads `imageUrl` for B2 rows.
            imageUrl: "",
            b2Key: img.b2Key,
            // The key's last segment is the sanitized original
            // filename (`.../<fileId>/<fileName>`), so the task can
            // produce human-readable archive entries without a
            // schema change.
            fileName: img.b2Key.split("/").pop(),
            createdBy: img.createdBy,
            createdAt: img._creationTime,
          };
        }

        let imageUrl = img.imageUrl;
        let contentType: string | undefined;
        if (img.storageId) {
          const [url, metadata] = await Promise.all([
            ctx.storage.getUrl(img.storageId as Id<"_storage">),
            ctx.db.system.get("_storage", img.storageId as Id<"_storage">),
          ]);
          if (url) imageUrl = url;
          // Convex `_storage` rows expose `contentType` but not a
          // `name` field — the original filename is stored on the
          // `instructorResources` row, not on the system storage
          // metadata. The export trigger falls back to
          // `image-${index}.${ext}` when no filename is available,
          // which is the same naming used before this PR.
          contentType = metadata?.contentType ?? undefined;
        } else if (!isTrustedLegacyImageUrl(imageUrl)) {
          // No storage id and no B2 key: the only trustworthy value is
          // an inline data URI or a Convex storage URL. Drop anything
          // else so the export worker never fetches a client-supplied
          // arbitrary URL.
          imageUrl = "";
        }
        return {
          imageUrl,
          storageId: img.storageId,
          contentType,
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
      imageSetUpdatedAt,
    };
  },
});

/**
 * PR #4b-fix: returns the owner + workspace of an export so the
 * trigger task can email the requesting user on completion. Gated
 * by CONVEX_HTTP_KEY at the HTTP layer; the query itself is a
 * single-row lookup with no PII filtering needed because only
 * server-side callers (the trigger task) can reach it.
 */
export const getWorkspaceExport = internalQuery({
  args: { exportId: v.id("workspaceExports") },
  handler: async (ctx, args) => {
    const exportDoc = await ctx.db.get(args.exportId);
    if (!exportDoc) {
      return null;
    }
    const workspace = await ctx.db.get(exportDoc.workspaceId);
    return {
      userId: exportDoc.userId,
      workspaceId: exportDoc.workspaceId,
      workspaceName: workspace?.name || "Workspace",
      status: exportDoc.status,
    };
  },
});
