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
 * POST /api/admin/workspaces/admin-mentee
 * Create an admin-mentee workspace for communication
 */
export async function POST(req: NextRequest) {
  try {
    const { requireRoleForApi } = await import("@/lib/auth-helpers");
    await requireRoleForApi("admin");

    const convex = getConvexClient();

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

    if (!workspace) {
      return NextResponse.json(
        { error: "Failed to create workspace" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      id: workspace._id,
      name: workspace.name,
      description: workspace.description,
      type: workspace.type,
      ownerId: workspace.ownerId,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to create workspace";
    console.error("Error creating admin-mentee workspace:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
