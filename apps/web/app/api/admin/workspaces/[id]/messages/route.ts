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

    const convex = getConvexClient();

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
      id: id as Id<"workspaces">,
    });

    if (!workspace) {
      return NextResponse.json(
        { error: "Workspace not found" },
        { status: 404 }
      );
    }

    const messageId = await convex.mutation(api.workspaces.createWorkspaceMessage, {
      workspaceId: id as Id<"workspaces">,
      userId: clerkUserId,
      content,
      type: "text",
    });

    return NextResponse.json({ id: messageId, success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to send message";
    console.error("Error sending message:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
