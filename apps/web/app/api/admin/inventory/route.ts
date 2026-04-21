import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db, mentors, isUnauthorizedError, isForbiddenError, eq } from "@mentorships/db";
import { requireRoleForApi } from "@/lib/auth-helpers";
import { protectWithRateLimit } from "@/lib/ratelimit";

const updateInventorySchema = z.object({
  mentorId: z.string().min(1),
  oneOnOneInventory: z.number().int().min(0).optional(),
  groupInventory: z.number().int().min(0).optional(),
  maxActiveStudents: z.number().int().min(0).optional(),
});

export async function PATCH(
  request: NextRequest
): Promise<NextResponse> {
  const rateLimitResponse = await protectWithRateLimit(request, { policy: "default" });
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  try {
    await requireRoleForApi("admin");

    const body = await request.json();
    const validated = updateInventorySchema.parse(body);

    const [existingMentor] = await db
      .select()
      .from(mentors)
      .where(eq(mentors.id, validated.mentorId))
      .limit(1);

    if (!existingMentor) {
      return NextResponse.json({ error: "Mentor not found" }, { status: 404 });
    }

    const updates: Record<string, number> = {};
    if (validated.oneOnOneInventory !== undefined) {
      updates.oneOnOneInventory = validated.oneOnOneInventory;
    }
    if (validated.groupInventory !== undefined) {
      updates.groupInventory = validated.groupInventory;
    }
    if (validated.maxActiveStudents !== undefined) {
      updates.maxActiveStudents = validated.maxActiveStudents;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    await db
      .update(mentors)
      .set(updates)
      .where(eq(mentors.id, mentorId));

    const [updatedMentor] = await db
      .select()
      .from(mentors)
      .where(eq(mentors.id, mentorId))
      .limit(1);

    return NextResponse.json({
      success: true,
      mentor: {
        id: updatedMentor.id,
        oneOnOneInventory: updatedMentor.oneOnOneInventory,
        groupInventory: updatedMentor.groupInventory,
        maxActiveStudents: updatedMentor.maxActiveStudents,
      },
    });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Forbidden: Admin role required" }, { status: 403 });
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid request", details: error.issues }, { status: 400 });
    }

    console.error("Error updating inventory:", error);
    return NextResponse.json({ error: "Failed to update inventory" }, { status: 500 });
  }
}