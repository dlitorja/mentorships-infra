import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getAuthenticatedConvexClient } from "@/lib/convex";
import { isUnauthorizedError, isForbiddenError } from "@/lib/errors";

/**
 * GET /api/admin/instructors/[id]/students
 *
 * Returns the instructor's enrolled students for the admin dashboard's
 * expandable instructor row.
 *
 * This used to call `admin.getStudentsForAdmin` and validate a *flat* student
 * schema against it, but that query groups packs by user and returns
 * `{ userId, email, sessionPacks[] }`. Validation therefore failed for every
 * real response and the route always answered 500. `admin.getInstructorWithStudents`
 * is the purpose-built query: it returns enrolled packs (packs holding a seat —
 * orphaned packs are excluded), plus per-student session and seat state.
 */
const InstructorStudentRowSchema = z.object({
  userId: z.string(),
  email: z.string().nullable(),
  sessionPackId: z.string(),
  totalSessions: z.number(),
  remainingSessions: z.number(),
  status: z.enum(["active", "depleted", "expired", "refunded"]),
  expiresAt: z.number().nullable(),
  lastSessionCompletedAt: z.number().nullable(),
  completedSessionCount: z.number(),
  seatStatus: z.enum(["active", "grace", "released"]),
  seatExpiresAt: z.number().nullable(),
});

const InstructorWithStudentsSchema = z.object({
  instructorId: z.string(),
  userId: z.string(),
  email: z.string(),
  bio: z.string().nullable(),
  oneOnOneInventory: z.number(),
  groupInventory: z.number(),
  maxActiveStudents: z.number(),
  activeStudentCount: z.number(),
  createdAt: z.number(),
  students: z.array(InstructorStudentRowSchema),
});

/** Convex rejects a malformed document id at the argument validator. */
function isInvalidConvexIdError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /is not a valid ID|ArgumentValidationError/i.test(message);
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { requireRoleForApi } = await import("@/lib/auth-helpers");
    await requireRoleForApi("admin");

    const { id } = await params;
    if (!id || typeof id !== "string" || id.trim().length === 0) {
      return NextResponse.json({ error: "Bad Request" }, { status: 400 });
    }

    const convex = await getAuthenticatedConvexClient();

    let result: unknown;
    try {
      result = await convex.query(api.admin.getInstructorWithStudents, {
        instructorId: id as Id<"instructors">,
      });
    } catch (error) {
      if (isInvalidConvexIdError(error)) {
        return NextResponse.json({ error: "Instructor not found" }, { status: 404 });
      }
      throw error;
    }

    // The query returns null for a missing or soft-deleted instructor.
    if (result === null) {
      return NextResponse.json({ error: "Instructor not found" }, { status: 404 });
    }

    const parsed = InstructorWithStudentsSchema.safeParse(result);
    if (!parsed.success) {
      console.error(
        "Invalid instructor-with-students payload:",
        parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")
      );
      return NextResponse.json({ error: "Invalid students payload" }, { status: 500 });
    }

    return NextResponse.json({
      students: parsed.data.students,
      // Canonical count: distinct students holding an active seat. The row list
      // counts enrollments, so a student with two packs appears twice.
      activeStudentCount: parsed.data.activeStudentCount,
    });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Forbidden: Admin role required" }, { status: 403 });
    }
    console.error("Error fetching instructor students:", error);
    return NextResponse.json({ error: "Failed to load students" }, { status: 500 });
  }
}
