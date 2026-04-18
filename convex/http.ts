import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import {
  getWorkspacesNeedingDeletion,
  getWorkspacesForNotification,
  getUserEmail,
  getWorkspaceExportData,
} from "./queries/http";
import {
  deleteAllWorkspaceContent,
  createRetentionNotification,
  updateWorkspaceExportStatus,
} from "./mutations/http";

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

  const workspaces = await ctx.runQuery(getWorkspacesNeedingDeletion as any);

  return new Response(JSON.stringify({ workspaces }), {
    headers: { "Content-Type": "application/json" },
  });
});

export const httpGetWorkspacesForNotification = httpAction(async (ctx, request) => {
  if (!verifyAuth(request)) return unauthorizedResponse();

  const notifications = await ctx.runQuery(getWorkspacesForNotification as any);

  return new Response(JSON.stringify({ notifications }), {
    headers: { "Content-Type": "application/json" },
  });
});

export const httpDeleteAllWorkspaceContent = httpAction(async (ctx, request) => {
  if (!verifyAuth(request)) return unauthorizedResponse();

  const { workspaceId } = await request.json();

  const result = await ctx.runMutation(deleteAllWorkspaceContent as any, { workspaceId: workspaceId as any });

  return new Response(JSON.stringify({ deleted: result.deleted }), {
    headers: { "Content-Type": "application/json" },
  });
});

export const httpCreateRetentionNotification = httpAction(async (ctx, request) => {
  if (!verifyAuth(request)) return unauthorizedResponse();

  const { workspaceId, userId, notificationType } = await request.json();

  const result = await ctx.runMutation(createRetentionNotification as any, {
    workspaceId: workspaceId as any,
    userId,
    notificationType,
  });

  return new Response(JSON.stringify(result), {
    headers: { "Content-Type": "application/json" },
  });
});

export const httpGetUserEmail = httpAction(async (ctx, request) => {
  if (!verifyAuth(request)) return unauthorizedResponse();

  const { clerkId } = await request.json();

  const result = await ctx.runQuery(getUserEmail as any, { clerkId });

  return new Response(JSON.stringify(result), {
    headers: { "Content-Type": "application/json" },
  });
});

export const httpGetWorkspaceExportData = httpAction(async (ctx, request) => {
  if (!verifyAuth(request)) return unauthorizedResponse();

  const { workspaceId } = await request.json();

  try {
    const result = await ctx.runQuery(getWorkspaceExportData as any, { workspaceId: workspaceId as any });
    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }
});

export const httpUpdateWorkspaceExportStatus = httpAction(async (ctx, request) => {
  if (!verifyAuth(request)) return unauthorizedResponse();

  const { exportId, status, downloadUrl, expiresAt } = await request.json();

  try {
    const result = await ctx.runMutation(updateWorkspaceExportStatus as any, {
      exportId: exportId as any,
      status,
      downloadUrl,
      expiresAt,
    });
    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }
});

const http = httpRouter();

http.route({
  path: "/workspace/retention/delete",
  method: "POST",
  handler: httpDeleteAllWorkspaceContent,
});

http.route({
  path: "/workspace/retention/needing-deletion",
  method: "GET",
  handler: httpGetWorkspacesNeedingDeletion,
});

http.route({
  path: "/workspace/retention/for-notification",
  method: "GET",
  handler: httpGetWorkspacesForNotification,
});

http.route({
  path: "/workspace/retention/notify",
  method: "POST",
  handler: httpCreateRetentionNotification,
});

http.route({
  path: "/users/email",
  method: "POST",
  handler: httpGetUserEmail,
});

http.route({
  path: "/workspace/export/data",
  method: "POST",
  handler: httpGetWorkspaceExportData,
});

http.route({
  path: "/workspace/export/update-status",
  method: "POST",
  handler: httpUpdateWorkspaceExportStatus,
});

export default http;
