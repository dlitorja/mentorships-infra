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
import { decrementInventory, incrementInventory, updateMentor } from "./mentors";
import { markNotifiedByInstructor } from "./waitlist";

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
    const message = (error as Error).message;
    const status = message.includes("not found") ? 404 : 500;
    return new Response(JSON.stringify({ error: message }), {
      status,
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
    const message = (error as Error).message;
    const status = message.includes("not found") ? 404 : 500;
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }
});

const typeMap: Record<string, "oneOnOne" | "group"> = {
  "one-on-one": "oneOnOne",
  "oneOnOne": "oneOnOne",
  group: "group",
};

export const httpDecrementInventory = httpAction(async (ctx, request) => {
  if (!verifyAuth(request)) return unauthorizedResponse();

  const { mentorId, type } = await request.json();

  const normalizedType = typeMap[type] || type;
  const mentorIdTyped = mentorId as any;

  try {
    const result = await ctx.runMutation(decrementInventory as any, {
      id: mentorIdTyped,
      type: normalizedType,
    });
    return new Response(JSON.stringify({ success: true, inventory: result }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = (error as Error).message;
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
});

export const httpIncrementInventory = httpAction(async (ctx, request) => {
  if (!verifyAuth(request)) return unauthorizedResponse();

  const { mentorId, type, quantity } = await request.json();

  const normalizedType = typeMap[type] || type;
  const mentorIdTyped = mentorId as any;
  const qty = quantity || 1;

  try {
    let result;
    for (let i = 0; i < qty; i++) {
      result = await ctx.runMutation(incrementInventory as any, {
        id: mentorIdTyped,
        type: normalizedType,
      });
    }
    return new Response(JSON.stringify({ success: true, inventory: result }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = (error as Error).message;
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
});

export const httpSetInventory = httpAction(async (ctx, request) => {
  if (!verifyAuth(request)) return unauthorizedResponse();

  const { mentorId, oneOnOneInventory, groupInventory } = await request.json();
  const mentorIdTyped = mentorId as any;

  try {
    const updates: Record<string, any> = {};
    if (oneOnOneInventory !== undefined) {
      updates.oneOnOneInventory = oneOnOneInventory;
    }
    if (groupInventory !== undefined) {
      updates.groupInventory = groupInventory;
    }

    const result = await ctx.runMutation(updateMentor as any, {
      id: mentorIdTyped,
      ...updates,
    });
    return new Response(JSON.stringify({ success: true, inventory: result }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = (error as Error).message;
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
});

export const httpNotifyWaitlist = httpAction(async (ctx, request) => {
  if (!verifyAuth(request)) return unauthorizedResponse();

  const { instructorSlug, mentorshipType } = await request.json();

  const normalizedType = mentorshipType ? typeMap[mentorshipType] || mentorshipType : undefined;

  try {
    const result = await ctx.runMutation(markNotifiedByInstructor as any, {
      instructorSlug,
      mentorshipType: normalizedType,
    });
    return new Response(JSON.stringify({ success: true, notifiedCount: result.count }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = (error as Error).message;
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 400,
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

http.route({
  path: "/inventory/decrement",
  method: "POST",
  handler: httpDecrementInventory,
});

http.route({
  path: "/inventory/increment",
  method: "POST",
  handler: httpIncrementInventory,
});

http.route({
  path: "/inventory/set",
  method: "POST",
  handler: httpSetInventory,
});

http.route({
  path: "/waitlist/notify",
  method: "POST",
  handler: httpNotifyWaitlist,
});

export default http;
