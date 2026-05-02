import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import { getConvexClient } from "@/lib/convex";
import { isUnauthorizedError, isForbiddenError } from "@/lib/errors";
import { requireRoleForApi } from "@/lib/auth-helpers";

const createMenteeResultSchema = z.object({
  imageUrl: z.string().url().optional().or(z.literal("")).default(""),
  imageUploadPath: z.string().optional().default(""),
  studentName: z.string().optional().default(""),
});

/**
 * GET /api/instructor/mentees-results
 * Get mentee results for the current instructor
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requireRoleForApi("mentor");
    const convex = getConvexClient();

    const instructor = await convex.query(api.instructors.getInstructorByUserId, {
      userId: user.id,
    });

    if (!instructor) {
      return NextResponse.json(
        { error: "Instructor profile not found" },
        { status: 404 }
      );
    }

    const results = await convex.query(api.instructors.getMenteeResultsByInstructorId, {
      instructorId: instructor._id,
    });

    return NextResponse.json({
      items: results.map((r) => ({
        id: r._id,
        imageUrl: r.imageUrl,
        imageUploadPath: r.imageUploadPath,
        studentName: r.studentName,
        createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : new Date(r._creationTime).toISOString(),
      })),
    });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Forbidden: Mentor role required" }, { status: 403 });
    }

    console.error("Error getting mentee results:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to get mentee results" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/instructor/mentees-results
 * Add a mentee result for the current instructor
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireRoleForApi("mentor");
    const convex = getConvexClient();

    const instructor = await convex.query(api.instructors.getInstructorByUserId, {
      userId: user.id,
    });

    if (!instructor) {
      return NextResponse.json(
        { error: "Instructor profile not found" },
        { status: 404 }
      );
    }

    const body = await req.json();
    const validationResult = createMenteeResultSchema.safeParse(body);

    if (!validationResult.success) {
      return NextResponse.json(
        { error: "Invalid request", details: validationResult.error.issues },
        { status: 400 }
      );
    }

    const { imageUrl, imageUploadPath, studentName } = validationResult.data;

    const resultId = await convex.mutation(api.instructors.createMenteeResult, {
      instructorId: instructor._id,
      imageUrl: imageUrl || "",
    });

    return NextResponse.json({
      success: true,
      message: "Mentee result added successfully",
      menteeResult: {
        id: resultId,
        imageUrl: imageUrl || "",
        imageUploadPath: imageUploadPath || "",
        studentName: studentName || "",
        createdAt: new Date().toISOString(),
      },
    }, { status: 201 });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Forbidden: Mentor role required" }, { status: 403 });
    }

    console.error("Error adding mentee result:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to add mentee result" },
      { status: 500 }
    );
  }
}