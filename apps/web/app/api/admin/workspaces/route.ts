import { NextRequest, NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { ConvexHttpClient } from "convex/browser";

function getConvexClient() {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
  }
  return new ConvexHttpClient(convexUrl);
}

/**
 * GET /api/admin/workspaces
 * List all workspaces for admin with filtering and pagination
 */
export async function GET(req: NextRequest) {
  try {
    const { requireRoleForApi } = await import("@/lib/auth-helpers");
    await requireRoleForApi("admin");

    const convex = getConvexClient();

    const url = new URL(req.url);
    const type = url.searchParams.get("type") as "mentorship" | "admin_mentee" | "admin_instructor" | null;
    const numItems = parseInt(url.searchParams.get("numItems") || "20");

    const paginationOpts = {
      numItems,
      cursor: null as string | null,
    };

    const result = await convex.query(api.adminWorkspaces.getAllWorkspaces, {
      paginationOpts,
      type: type || undefined,
    });

    const workspaceOwners = new Map<string, any>();
    const workspaceMentors = new Map<string, any>();

    for (const workspace of result.page) {
      if (workspace.ownerId) {
        try {
          const user = await convex.query(api.users.getUserByUserId, { userId: workspace.ownerId });
          workspaceOwners.set(workspace._id, user);
        } catch {
          workspaceOwners.set(workspace._id, null);
        }
      }
      if (workspace.mentorId) {
        try {
          const instructor = await convex.query(api.instructors.getInstructorById, { id: workspace.mentorId });
          workspaceMentors.set(workspace._id, instructor);
        } catch (e) {
          workspaceMentors.set(workspace._id, null);
        }
      }
    }

    return NextResponse.json({
      items: result.page.map((workspace: any) => ({
        id: workspace._id,
        name: workspace.name,
        description: workspace.description,
        type: workspace.type || "mentorship",
        ownerId: workspace.ownerId,
        owner: workspaceOwners.get(workspace._id),
        mentorId: workspace.mentorId,
        mentor: workspaceMentors.get(workspace._id),
        isPublic: workspace.isPublic,
        endedAt: workspace.endedAt,
        createdAt: workspace._creationTime,
        menteeImageCount: workspace.menteeImageCount,
        mentorImageCount: workspace.mentorImageCount,
      })),
      continueCursor: result.continueCursor,
      isDone: result.isDone,
    });
  } catch (error: any) {
    console.error("Error listing workspaces:", error);
    return NextResponse.json(
      { error: error.message || "Failed to list workspaces" },
      { status: 500 }
    );
  }
}
