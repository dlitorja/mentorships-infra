import { NextRequest, NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { ConvexHttpClient } from "convex/browser";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

/**
 * POST /api/admin/workspaces/[id]/messages
 * Send a message to a workspace as admin
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { requireRoleForApi } = await import("@/lib/auth-helpers");
    await requireRoleForApi("admin");

    const { auth } = await import("@clerk/nextjs/server");
    const { userId: clerkUserId } = await auth();

    if (!clerkUserId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await req.json();
    const { content } = body;

    if (!content || typeof content !== "string") {
      return NextResponse.json(
        { error: "Content is required" },
        { status: 400 }
      );
    }

    const workspace = await convex.query(api.adminWorkspaces.getWorkspaceByIdAdmin, {
      id: id as any,
    });

    if (!workspace) {
      return NextResponse.json(
        { error: "Workspace not found" },
        { status: 404 }
      );
    }

    const messageId = await convex.mutation(api.workspaces.createWorkspaceMessage, {
      workspaceId: id as any,
      userId: clerkUserId,
      content,
      type: "text",
    });

    return NextResponse.json({ id: messageId, success: true });
  } catch (error: any) {
    console.error("Error sending message:", error);
    return NextResponse.json(
      { error: error.message || "Failed to send message" },
      { status: 500 }
    );
  }
}
