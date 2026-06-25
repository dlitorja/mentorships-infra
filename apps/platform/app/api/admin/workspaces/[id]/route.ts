import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { ConvexHttpClient } from "convex/browser";
import { convexIdSchema } from "@/lib/validators";

const workspaceIdParamSchema = z.object({
  id: convexIdSchema,
});

function getConvexClient() {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
  }
  return new ConvexHttpClient(convexUrl);
}

/**
 * GET /api/admin/workspaces/[id]
 * Get workspace details by ID for admin, including owner/instructor info,
 * messages, and audit logs. Logs a view_workspace audit event.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { requireRoleForApi } = await import("@/lib/auth-helpers");
    const { auth } = await import("@clerk/nextjs/server");
    const { userId: clerkUserId } = await auth();
    await requireRoleForApi("admin");

    const { id } = await params;
    const parsedParams = workspaceIdParamSchema.safeParse({ id });
    if (!parsedParams.success) {
      return NextResponse.json(
        { error: "Invalid workspace ID", details: parsedParams.error.issues },
        { status: 400 }
      );
    }

    const validatedId = parsedParams.data.id as Id<"workspaces">;
    const convex = getConvexClient();

    const workspace = await convex.query(api.adminWorkspaces.getWorkspaceByIdAdmin, {
      id: validatedId,
    });

    if (!workspace) {
      return NextResponse.json(
        { error: "Workspace not found" },
        { status: 404 }
      );
    }

    const url = new URL(req.url);
    const auditNumItems = Math.min(parseInt(url.searchParams.get("numItems") || "50") || 50, 100);
    const auditCursor = url.searchParams.get("cursor") || null;

    const [messagesResult, auditLogsResult] = await Promise.allSettled([
      convex.query(api.workspaces.getWorkspaceMessages, {
        workspaceId: validatedId,
      }),
      convex.query(api.adminWorkspaces.getWorkspaceAuditLogs, {
        workspaceId: validatedId,
        paginationOpts: { numItems: auditNumItems, cursor: auditCursor },
      }),
    ]);

    if (messagesResult.status === "rejected") {
      console.error("Failed to fetch workspace messages:", messagesResult.reason);
    }
    if (auditLogsResult.status === "rejected") {
      console.error("Failed to fetch workspace audit logs:", auditLogsResult.reason);
    }

    const emptyPagination = { page: [], continueCursor: null, isDone: true };

    const messages = messagesResult.status === "fulfilled" && messagesResult.value
      ? messagesResult.value
      : [];
    const auditLogs = (auditLogsResult.status === "fulfilled" && auditLogsResult.value
      ? auditLogsResult.value
      : emptyPagination) as any;

    if (clerkUserId) {
      await convex.mutation(api.workspaces.logViewWorkspaceAudit, {
        workspaceId: validatedId,
        adminId: clerkUserId,
      }).catch((err) => {
        console.warn("Failed to log workspace view audit:", err);
      });
    }

    const messageItems = (Array.isArray(messages) ? messages : []).map((m) => ({
      id: m._id,
      userId: m.userId,
      content: m.content,
      type: m.type,
      senderRole: m.senderRole,
      createdAt: m._creationTime,
    }));

    const auditLogItems = (auditLogs.page as any[]).map((log: any) => ({
      id: log._id,
      adminId: log.adminId,
      action: log.action,
      details: log.details,
      timestamp: log.timestamp,
    }));

    return NextResponse.json({
      ...workspace,
      messages: messageItems,
      auditLogs: {
        items: auditLogItems,
        continueCursor: auditLogs.continueCursor,
        isDone: auditLogs.isDone,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to get workspace";
    console.error("Error getting workspace:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/workspaces/[id]
 * Soft-deletes a workspace by setting deletedAt. Requires admin auth.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { requireRoleForApi } = await import("@/lib/auth-helpers");
    await requireRoleForApi("admin");

    const { id } = await params;
    const parsedParams = workspaceIdParamSchema.safeParse({ id });
    if (!parsedParams.success) {
      return NextResponse.json(
        { error: "Invalid workspace ID", details: parsedParams.error.issues },
        { status: 400 }
      );
    }

    const validatedId = parsedParams.data.id as Id<"workspaces">;
    const convex = getConvexClient();

    await convex.mutation(api.adminWorkspaces.deleteWorkspaceAdmin, {
      workspaceId: validatedId,
    });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to delete workspace";
    console.error("Error deleting workspace:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

const updateWorkspaceBodySchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  imageUrl: z.string().optional(),
  isPublic: z.boolean().optional(),
}).strict();

/**
 * PATCH /api/admin/workspaces/[id]
 * Updates a workspace's name, description, image, or visibility. Requires admin auth.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { requireRoleForApi } = await import("@/lib/auth-helpers");
    await requireRoleForApi("admin");

    const { id } = await params;
    const parsedParams = workspaceIdParamSchema.safeParse({ id });
    if (!parsedParams.success) {
      return NextResponse.json(
        { error: "Invalid workspace ID", details: parsedParams.error.issues },
        { status: 400 }
      );
    }

    const body = await req.json();
    const parsedBody = updateWorkspaceBodySchema.safeParse(body);
    if (!parsedBody.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsedBody.error.issues },
        { status: 400 }
      );
    }

    const validatedId = parsedParams.data.id as Id<"workspaces">;
    const convex = getConvexClient();

    const result = await convex.mutation(api.adminWorkspaces.updateWorkspaceAdmin, {
      workspaceId: validatedId,
      ...parsedBody.data,
    });

    return NextResponse.json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to update workspace";
    console.error("Error updating workspace:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
