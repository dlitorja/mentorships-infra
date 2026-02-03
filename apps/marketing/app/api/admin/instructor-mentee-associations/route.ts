import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createInstructorMenteeAssociations } from "@mentorships/db";

const associationSchema = z.object({
  mentorUserId: z.string().min(1, "Mentor user ID is required"),
  menteeUserIds: z.array(z.string()).min(1, "At least one mentee is required"),
  sessionsPerPack: z.number().int().positive().optional().default(4),
});

export async function POST(request: Request): Promise<Response> {
  try {
    await requireAdmin();

    const body = await request.json();
    const parseResult = associationSchema.safeParse(body);

    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parseResult.error.flatten() },
        { status: 400 }
      );
    }

    const { mentorUserId, menteeUserIds, sessionsPerPack } = parseResult.data;

    const result = await createInstructorMenteeAssociations({
      mentorUserId,
      menteeUserIds,
      sessionsPerPack,
    });

    if (result.errors.length > 0 && result.associations.length === 0) {
      return NextResponse.json(
        { error: "Failed to create any associations", details: result.errors },
        { status: 400 }
      );
    }

    return NextResponse.json({
      message: `Successfully created ${result.associations.length} association(s)`,
      associations: result.associations,
      errors: result.errors.length > 0 ? result.errors : undefined,
    });
  } catch (error) {
    console.error("Error creating instructor-mentee associations:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
