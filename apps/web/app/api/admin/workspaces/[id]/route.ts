import { NextRequest, NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { ConvexHttpClient } from "convex/browser";

function getConvexClient() {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
  }
  return new ConvexHttpClient(convexUrl);
}

/**
 * GET /api/admin/workspaces/[id]
 * Get workspace details by ID for admin, including owner/mentor info,
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

    const convex = getConvexClient();

    const { id } = await params;

    const workspace = await convex.query(api.adminWorkspaces.getWorkspaceByIdAdmin, {
      id: id as Id<"workspaces">,
    });

    if (!workspace) {
      return NextResponse.json(
        { error: "Workspace not found" },
        { status: 404 }
      );
    }

    const [messages, auditLogs] = await Promise.all([
      convex.query(api.workspaces.getWorkspaceMessages, {
        workspaceId: workspace.id as Id<"workspaces">,
      }),
      convex.query(api.adminWorkspaces.getWorkspaceAuditLogs, {
        workspaceId: workspace.id as Id<"workspaces">,
        paginationOpts: { numItems: 50, cursor: null },
      }),
    ]);

    if (clerkUserId) {
      await convex.mutation(api.workspaces.logViewWorkspaceAudit, {
        workspaceId: workspace.id as Id<"workspaces">,
        adminId: clerkUserId,
      }).catch(() => {});
    }

    return NextResponse.json({
      ...workspace,
      messages: messages.map((m) => ({
        id: m._id,
        userId: m.userId,
        content: m.content,
        type: m.type,
        senderRole: m.senderRole,
        createdAt: m._creationTime,
      })),
      auditLogs: auditLogs.page.map((log) => ({
        id: log._id,
        adminId: log.adminId,
        action: log.action,
        details: log.details,
        timestamp: log.timestamp,
      })),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to get workspace";
    console.error("Error getting workspace:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}