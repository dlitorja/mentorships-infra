import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { ConvexHttpClient } from "convex/browser";
import { convexIdSchema } from "@/lib/validators";

const workspaceIdParamSchema = z.object({
  id: convexIdSchema,
});

const sendMessageSchema = z.object({
  content: z.string().min(1, "Content is required"),
});

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
): Promise<NextResponse> {
  try {
    const { requireRoleForApi } = await import("@/lib/auth-helpers");
    await requireRoleForApi("admin");

    const { auth } = await import("@clerk/nextjs/server");
    const { userId: clerkUserId } = await auth();

    if (!clerkUserId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const parsedParams = workspaceIdParamSchema.safeParse({ id });
    if (!parsedParams.success) {
      return NextResponse.json(
        { error: "Invalid workspace ID", details: parsedParams.error.issues },
        { status: 400 }
      );
    }

    const validatedId = parsedParams.data.id as Id<"workspaces">;
    const body = await req.json();
    const parsedBody = sendMessageSchema.safeParse(body);
    if (!parsedBody.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsedBody.error.issues },
        { status: 400 }
      );
    }

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

    const messageId = await convex.mutation(api.workspaces.createWorkspaceMessage, {
      workspaceId: validatedId,
      userId: clerkUserId,
      content: parsedBody.data.content,
      type: "text",
    });

    return NextResponse.json({ id: messageId, success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to send message";
    console.error("Error sending message:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
