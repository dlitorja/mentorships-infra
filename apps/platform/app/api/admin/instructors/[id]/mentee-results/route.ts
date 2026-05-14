import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import { getConvexClient } from "@/lib/convex";
import { isUnauthorizedError, isForbiddenError } from "@/lib/errors";
import type { Id } from "@/convex/_generated/dataModel";
import { auth } from "@clerk/nextjs/server";

async function resolveInstructorByIdOrSlug(convex: ReturnType<typeof getConvexClient>, idOrSlug: string) {
  try {
    const byId = await convex.query(api.instructors.getInstructorById, { id: idOrSlug as any });
    if (byId) {
      return { instructor: byId, resolvedId: byId._id as string };
    }
  } catch (err) {
    if (!(err instanceof Error) || !/id|argument/i.test(err.message)) {
      // Network/auth or unexpected error: propagate
      throw err;
    }
  }
  const bySlug = await convex.query(api.instructors.getInstructorBySlugForAdmin, { slug: idOrSlug });
  if (bySlug) {
    return { instructor: bySlug, resolvedId: bySlug._id as string };
  }
  return { instructor: null, resolvedId: null } as const;
}

const createMenteeResultSchema = z.object({
  imageUrl: z.string().url().optional().or(z.literal("")).default(""),
  imageUploadPath: z.string().optional().default(""),
  studentName: z.string().optional().default(""),
});

type CreateMenteeResultInput = z.infer<typeof createMenteeResultSchema>;

/**
 * POST /api/admin/instructors/[id]/mentee-results
 * Add a mentee result to an instructor
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { requireRoleForApi } = await import("@/lib/auth-helpers");
    await requireRoleForApi("admin");

    const { id } = await params;
    const body = await req.json();
    const validationResult = createMenteeResultSchema.safeParse(body);

    if (!validationResult.success) {
      return NextResponse.json(
        { error: "Invalid request", details: validationResult.error.issues },
        { status: 400 }
      );
    }

    const data = validationResult.data as CreateMenteeResultInput;
    const convex = getConvexClient();
    const clerkAuth = await auth();
    const token = await clerkAuth.getToken({ template: "convex" });
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    convex.setAuth(token);

    const resolved = await resolveInstructorByIdOrSlug(convex, id);
    const instructor = resolved.instructor;
    if (!instructor || !resolved.resolvedId) {
      return NextResponse.json(
        { error: "Instructor not found" },
        { status: 404 }
      );
    }

    const result = await convex.mutation(api.instructors.createMenteeResult, {
      instructorId: resolved.resolvedId as Id<"instructors">,
      imageUrl: data.imageUrl || "",
      imageUploadPath: data.imageUploadPath || undefined,
      studentName: data.studentName || undefined,
    });

    return NextResponse.json({
      success: true,
      message: "Mentee result added successfully",
      menteeResult: {
        id: result._id,
        imageUrl: result.imageUrl,
        imageUploadPath: result.imageUploadPath ?? null,
        studentName: result.studentName ?? null,
        createdAt: new Date(result.createdAt ?? result._creationTime).toISOString(),
      },
    }, { status: 201 });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Forbidden: Admin role required" }, { status: 403 });
    }

    console.error("Error adding mentee result:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to add mentee result" },
      { status: 500 }
    );
  }
}
