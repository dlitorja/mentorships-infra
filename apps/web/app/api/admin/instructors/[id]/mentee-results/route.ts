import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import { getConvexClient } from "@/lib/convex";
import { isUnauthorizedError, isForbiddenError } from "@/lib/errors";
import type { Id } from "@/convex/_generated/dataModel";

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

    const instructor = await convex.query(api.instructors.getInstructorById, {
      id: id as Id<"instructors">,
    });
    if (!instructor) {
      return NextResponse.json(
        { error: "Instructor not found" },
        { status: 404 }
      );
    }

    const resultId = await convex.mutation(api.instructors.createMenteeResult, {
      instructorId: id as Id<"instructors">,
      imageUrl: data.imageUrl || "",
      imageUploadPath: data.imageUploadPath || undefined,
      studentName: data.studentName || undefined,
    }) as unknown as Id<"menteeResults">;

    const result = await convex.query(api.instructors.getMenteeResultById, {
      id: resultId,
      instructorId: id,
    });

    return NextResponse.json({
      success: true,
      message: "Mentee result added successfully",
      menteeResult: {
        id: result!._id,
        imageUrl: result!.imageUrl,
        imageUploadPath: result!.imageUploadPath ?? null,
        studentName: result!.studentName ?? null,
        createdAt: new Date(result!.createdAt ?? result!._creationTime).toISOString(),
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
