import { NextRequest, NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { ConvexHttpClient } from "convex/browser";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

/**
 * POST /api/admin/workspaces/admin-mentee
 * Create an admin-mentee workspace for communication
 */
export async function POST(req: NextRequest) {
  try {
    const { requireRoleForApi } = await import("@/lib/auth-helpers");
    await requireRoleForApi("admin");

    const body = await req.json();
    const { menteeUserId } = body;

    if (!menteeUserId) {
      return NextResponse.json(
        { error: "menteeUserId is required" },
        { status: 400 }
      );
    }

    const workspace = await convex.mutation(api.adminWorkspaces.createAdminMenteeWorkspace, {
      menteeUserId,
    });

    return NextResponse.json({
      id: workspace._id,
      name: workspace.name,
      description: workspace.description,
      type: workspace.type,
      ownerId: workspace.ownerId,
    });
  } catch (error: any) {
    console.error("Error creating admin-mentee workspace:", error);
    return NextResponse.json(
      { error: error.message || "Failed to create workspace" },
      { status: 500 }
    );
  }
}
