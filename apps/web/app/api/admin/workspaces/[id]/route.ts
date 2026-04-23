import { NextRequest, NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { ConvexHttpClient } from "convex/browser";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

/**
 * GET /api/admin/workspaces/[id]
 * Get workspace details by ID for admin
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { requireRoleForApi } = await import("@/lib/auth-helpers");
    await requireRoleForApi("admin");

    const { id } = await params;

    const workspace = await convex.query(api.adminWorkspaces.getWorkspaceByIdAdmin, {
      id: id as any,
    });

    if (!workspace) {
      return NextResponse.json(
        { error: "Workspace not found" },
        { status: 404 }
      );
    }

    let owner = null;
    let mentor = null;

    if (workspace.ownerId) {
      try {
        owner = await convex.query(api.users.getUserByUserId, { userId: workspace.ownerId });
      } catch (e) {
        owner = null;
      }
    }

    if (workspace.mentorId) {
      try {
        mentor = await convex.query(api.instructors.getInstructorById, { id: workspace.mentorId });
      } catch (e) {
        mentor = null;
      }
    }

    const messages = await convex.query(api.workspaces.getWorkspaceMessages, {
      workspaceId: workspace._id,
    });

    const auditLogs = await convex.query(api.adminWorkspaces.getWorkspaceAuditLogs, {
      workspaceId: workspace._id,
      paginationOpts: { numItems: 50, cursor: null },
    });

    return NextResponse.json({
      id: workspace._id,
      name: workspace.name,
      description: workspace.description,
      type: workspace.type || "mentorship",
      ownerId: workspace.ownerId,
      owner,
      mentorId: workspace.mentorId,
      mentor,
      isPublic: workspace.isPublic,
      endedAt: workspace.endedAt,
      createdAt: workspace._creationTime,
      menteeImageCount: workspace.menteeImageCount,
      mentorImageCount: workspace.mentorImageCount,
      messages: messages.map((m: any) => ({
        id: m._id,
        userId: m.userId,
        content: m.content,
        type: m.type,
        senderRole: m.senderRole,
        createdAt: m._creationTime,
      })),
      auditLogs: auditLogs.page.map((log: any) => ({
        id: log._id,
        adminId: log.adminId,
        action: log.action,
        details: log.details,
        timestamp: log.timestamp,
      })),
    });
  } catch (error: any) {
    console.error("Error getting workspace:", error);
    return NextResponse.json(
      { error: error.message || "Failed to get workspace" },
      { status: 500 }
    );
  }
}
