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

const memberUpdateBodySchema = z.object({
  newOwnerId: z.string().min(1, "Owner ID is required").optional(),
  newInstructorId: z.union([convexIdSchema, z.null()]).optional(),
}).refine((data) => data.newOwnerId !== undefined || data.newInstructorId !== undefined, {
  message: "Must provide newOwnerId or newInstructorId",
});

/**
 * PATCH /api/admin/workspaces/[id]/members
 * Update workspace owner or instructor. Requires admin auth.
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

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON in request body" },
        { status: 400 }
      );
    }

    const parsedBody = memberUpdateBodySchema.safeParse(body);
    if (!parsedBody.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsedBody.error.issues },
        { status: 400 }
      );
    }

    const validatedId = parsedParams.data.id as Id<"workspaces">;
    const convex = getConvexClient();

    if (parsedBody.data.newOwnerId !== undefined) {
      const result = await convex.mutation(api.adminWorkspaces.updateWorkspaceOwner, {
        workspaceId: validatedId,
        newOwnerId: parsedBody.data.newOwnerId,
      });
      return NextResponse.json(result);
    }

    if (parsedBody.data.newInstructorId !== undefined) {
      if (parsedBody.data.newInstructorId === null) {
        const result = await convex.mutation(api.adminWorkspaces.clearWorkspaceInstructor, {
          workspaceId: validatedId,
        });
        return NextResponse.json(result);
      }
      const result = await convex.mutation(api.adminWorkspaces.updateWorkspaceInstructor, {
        workspaceId: validatedId,
        newInstructorId: parsedBody.data.newInstructorId as Id<"instructors">,
      });
      return NextResponse.json(result);
    }

    return NextResponse.json(
      { error: "Must provide newOwnerId or newInstructorId" },
      { status: 400 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to update workspace member";
    console.error("Error updating workspace member:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}