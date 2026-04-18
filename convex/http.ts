import { httpAction } from "./_generated/server";
import { v } from "convex/values";

const EIGHTEEN_MONTHS_MS = 18 * 30 * 24 * 60 * 60 * 1000;
const dayMs = 24 * 60 * 60 * 1000;

const CONVEX_HTTP_KEY = process.env.CONVEX_HTTP_KEY;

function unauthorizedResponse(): Response {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

function verifyAuth(request: Request): boolean {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader) return false;
  const expected = `Bearer ${CONVEX_HTTP_KEY}`;
  return authHeader === expected;
}

export const httpGetWorkspacesNeedingDeletion = httpAction(async (ctx, request) => {
  if (!verifyAuth(request)) return unauthorizedResponse();

  const cutoff = Date.now() - EIGHTEEN_MONTHS_MS;
  const workspaces = await ctx.db
    .query("workspaces")
    .withIndex("by_endedAt", (q) => q.lt("endedAt", cutoff))
    .filter((q) => q.or(q.eq(q.field("deletedAt"), undefined), q.gt(q.field("deletedAt"), cutoff)))
    .collect();

  return new Response(JSON.stringify({ workspaces: workspaces.map(w => ({ id: w._id, endedAt: w.endedAt, ownerId: w.ownerId, mentorId: w.mentorId })) }), {
    headers: { "Content-Type": "application/json" },
  });
});

export const httpGetWorkspacesForNotification = httpAction(async (ctx, request) => {
  if (!verifyAuth(request)) return unauthorizedResponse();

  const now = Date.now();
  const notifications: { workspaceId: string; userId: string; daysUntilDeletion: number }[] = [];

  const workspaces = await ctx.db.query("workspaces").collect();

  for (const workspace of workspaces) {
    if (!workspace.endedAt) continue;

    const daysUntilDeletion = Math.floor(
      (workspace.endedAt + EIGHTEEN_MONTHS_MS - now) / dayMs
    );

    // Use ±1 window for robustness
    const inWindow = (days: number) => days >= 89 && days <= 91 || days >= 29 && days <= 31 || days >= 6 && days <= 8;
    
    if (inWindow(daysUntilDeletion)) {
      const seats = await ctx.db
        .query("seatReservations")
        .withIndex("by_mentorId", (q) => q.eq("mentorId", workspace.mentorId!))
        .filter((q) => q.eq(q.field("userId"), workspace.ownerId))
        .collect();

      if (seats.length > 0) {
        notifications.push({
          workspaceId: String(workspace._id),
          userId: workspace.ownerId,
          daysUntilDeletion,
        });
      }
    }
  }

  return new Response(JSON.stringify({ notifications }), {
    headers: { "Content-Type": "application/json" },
  });
});

export const httpDeleteAllWorkspaceContent = httpAction(async (ctx, request) => {
  if (!verifyAuth(request)) return unauthorizedResponse();

  const { workspaceId } = await request.json();

  const notes = await ctx.db
    .query("workspaceNotes")
    .withIndex("by_workspaceId", (q) => q.eq("workspaceId", workspaceId as any))
    .collect();
  for (const note of notes) {
    await ctx.db.delete(note._id);
  }

  const links = await ctx.db
    .query("workspaceLinks")
    .withIndex("by_workspaceId", (q) => q.eq("workspaceId", workspaceId as any))
    .collect();
  for (const link of links) {
    await ctx.db.delete(link._id);
  }

  const images = await ctx.db
    .query("workspaceImages")
    .withIndex("by_workspaceId", (q) => q.eq("workspaceId", workspaceId as any))
    .collect();
  for (const image of images) {
    await ctx.db.delete(image._id);
  }

  const messages = await ctx.db
    .query("workspaceMessages")
    .withIndex("by_workspaceId", (q) => q.eq("workspaceId", workspaceId as any))
    .collect();
  for (const message of messages) {
    await ctx.db.delete(message._id);
  }

  await ctx.db.patch(workspaceId as any, {
    menteeImageCount: 0,
    mentorImageCount: 0,
  });

  return new Response(
    JSON.stringify({
      deleted: {
        notes: notes.length,
        links: links.length,
        images: images.length,
        messages: messages.length,
      },
    }),
    { headers: { "Content-Type": "application/json" } }
  );
});

export const httpCreateRetentionNotification = httpAction(async (ctx, request) => {
  if (!verifyAuth(request)) return unauthorizedResponse();

  const { workspaceId, userId, notificationType } = await request.json();

  const existing = await ctx.db
    .query("workspaceRetentionNotifications")
    .withIndex("by_workspaceId_userId", (q) =>
      q.eq("workspaceId", workspaceId as any).eq("userId", userId)
    )
    .filter((q) => q.eq(q.field("notificationType"), notificationType))
    .first();

  if (existing) {
    return new Response(JSON.stringify({ notificationId: String(existing._id), created: false }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const notificationId = await ctx.db.insert("workspaceRetentionNotifications", {
    workspaceId: workspaceId as any,
    userId,
    notificationType,
    sentAt: Date.now(),
  });

  return new Response(JSON.stringify({ notificationId: String(notificationId), created: true }), {
    headers: { "Content-Type": "application/json" },
  });
});

export const httpGetUserEmail = httpAction(async (ctx, request) => {
  if (!verifyAuth(request)) return unauthorizedResponse();

  const { clerkId } = await request.json();

  const user = await ctx.db
    .query("users")
    .withIndex("by_clerkId", (q) => q.eq("clerkId", clerkId))
    .first();

  if (!user) {
    return new Response(JSON.stringify({ email: null }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ email: user.email }), {
    headers: { "Content-Type": "application/json" },
  });
});

export const httpGetWorkspaceExportData = httpAction(async (ctx, request) => {
  if (!verifyAuth(request)) return unauthorizedResponse();

  const { workspaceId } = await request.json();

  const workspace = await ctx.db.get(workspaceId as any);
  if (!workspace) {
    return new Response(JSON.stringify({ error: "Workspace not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const notes = await ctx.db
    .query("workspaceNotes")
    .withIndex("by_workspaceId", (q) => q.eq("workspaceId", workspaceId as any))
    .filter((q) => q.eq(q.field("deletedAt"), undefined))
    .collect();

  const images = await ctx.db
    .query("workspaceImages")
    .withIndex("by_workspaceId", (q) => q.eq("workspaceId", workspaceId as any))
    .filter((q) => q.eq(q.field("deletedAt"), undefined))
    .collect();

  return new Response(
    JSON.stringify({
      workspaceName: workspace.name || "Workspace",
      notes: notes.map((n) => ({
        title: n.title,
        content: n.content,
        updatedAt: n.updatedAt,
      })),
      images: images.map((img) => ({
        imageUrl: img.imageUrl,
        createdBy: img.createdBy,
        createdAt: img._creationTime,
      })),
    }),
    { headers: { "Content-Type": "application/json" } }
  );
});

export const httpUpdateWorkspaceExportStatus = httpAction(async (ctx, request) => {
  if (!verifyAuth(request)) return unauthorizedResponse();

  const { exportId, status, downloadUrl, expiresAt } = await request.json();

  const exportRecord = await ctx.db.get(exportId as any);
  if (!exportRecord) {
    return new Response(JSON.stringify({ error: "Export not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const updates: Record<string, unknown> = { status };
  if (downloadUrl) updates.downloadUrl = downloadUrl;
  if (expiresAt) updates.expiresAt = expiresAt;

  await ctx.db.patch(exportId as any, updates);

  return new Response(JSON.stringify({ success: true }), {
    headers: { "Content-Type": "application/json" },
  });
});
