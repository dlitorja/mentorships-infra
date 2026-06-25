import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { ConvexHttpClient } from "convex/browser";
import { convexIdSchema } from "@/lib/validators";

const createAdminInstructorSchema = z.object({
  instructorId: convexIdSchema,
  name: z.string().optional(),
  description: z.string().optional(),
  isPublic: z.boolean().optional(),
});

function getConvexClient() {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
  }
  return new ConvexHttpClient(convexUrl);
}

/**
 * POST /api/admin/workspaces/admin-instructor
 * Create an admin-instructor workspace for communication
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { requireRoleForApi } = await import("@/lib/auth-helpers");
    await requireRoleForApi("admin");

    const convex = getConvexClient();

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON in request body" },
        { status: 400 }
      );
    }

    const parsedBody = createAdminInstructorSchema.safeParse(body);
    if (!parsedBody.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsedBody.error.issues },
        { status: 400 }
      );
    }

    const { instructorId, name, description, isPublic } = parsedBody.data;

    const workspace = await convex.mutation(api.adminWorkspaces.createAdminInstructorWorkspace, {
      instructorId: instructorId as Id<"instructors">,
      name,
      description,
      isPublic,
    }) as any;

    if (!workspace) {
      return NextResponse.json(
        { error: "Failed to create workspace" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      id: workspace?._id,
      name: workspace?.name,
      description: workspace?.description,
      type: workspace?.type,
      instructorId: workspace?.instructorId,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to create workspace";
    console.error("Error creating admin-instructor workspace:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}