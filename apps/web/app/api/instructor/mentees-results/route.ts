import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getInstructorByUserId,
  getMenteeResultsByInstructorId,
  createMenteeResult,
  isUnauthorizedError,
} from "@mentorships/db";

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
    const { requireDbUser } = await import("@/lib/auth");
    const user = await requireDbUser();

    const instructor = await getInstructorByUserId(user.id);
    if (!instructor) {
      return NextResponse.json(
        { error: "Instructor profile not found" },
        { status: 404 }
      );
    }

    const results = await getMenteeResultsByInstructorId(instructor.id);

    return NextResponse.json({
      items: results.map((r) => ({
        id: r.id,
        imageUrl: r.imageUrl,
        imageUploadPath: r.imageUploadPath,
        studentName: r.studentName,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
    const { requireDbUser } = await import("@/lib/auth");
    const user = await requireDbUser();

    const instructor = await getInstructorByUserId(user.id);
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

    const result = await createMenteeResult({
      instructorId: instructor.id,
      imageUrl: imageUrl || null,
      imageUploadPath: imageUploadPath || null,
      studentName: studentName || null,
      createdBy: user.id,
    });

    return NextResponse.json({
      success: true,
      message: "Mentee result added successfully",
      menteeResult: {
        id: result.id,
        imageUrl: result.imageUrl,
        imageUploadPath: result.imageUploadPath,
        studentName: result.studentName,
        createdAt: result.createdAt.toISOString(),
      },
    }, { status: 201 });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    console.error("Error adding mentee result:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to add mentee result" },
      { status: 500 }
    );
  }
}
