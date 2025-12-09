import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth-helpers";
import { db } from "@mentorships/db";
import { sessions } from "@mentorships/db";
import { eq, and } from "drizzle-orm";
import { getMentorByUserId, getSessionById } from "@mentorships/db";
import { z } from "zod";

const updateSessionSchema = z.object({
  status: z.enum(["scheduled", "completed", "canceled", "no_show"]).optional(),
  notes: z.string().optional(),
  recordingUrl: z.string().url().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: { sessionId: string } }
) {
  try {
    const user = await requireRole("mentor");
    const mentor = await getMentorByUserId(user.id);

    if (!mentor) {
      return NextResponse.json(
        { error: "Mentor profile not found" },
        { status: 404 }
      );
    }

    const sessionId = params.sessionId;
    const session = await getSessionById(sessionId);

    if (!session) {
      return NextResponse.json(
        { error: "Session not found" },
        { status: 404 }
      );
    }

    // Verify the session belongs to this mentor
    if (session.mentorId !== mentor.id) {
      return NextResponse.json(
        { error: "Unauthorized: Session does not belong to this mentor" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const validatedData = updateSessionSchema.parse(body);

    // Prepare update object
    const updateData: {
      status?: string;
      notes?: string;
      recordingUrl?: string;
      completedAt?: Date | null;
      canceledAt?: Date | null;
      updatedAt: Date;
    } = {
      updatedAt: new Date(),
    };

    // Handle status changes
    if (validatedData.status) {
      updateData.status = validatedData.status;

      // Set timestamps based on status
      if (validatedData.status === "completed") {
        updateData.completedAt = new Date();
        updateData.canceledAt = null;
      } else if (validatedData.status === "canceled") {
        updateData.canceledAt = new Date();
        updateData.completedAt = null;
      } else if (validatedData.status === "scheduled") {
        // Reset timestamps when rescheduling
        updateData.completedAt = null;
        updateData.canceledAt = null;
      }
    }

    if (validatedData.notes !== undefined) {
      updateData.notes = validatedData.notes;
    }

    if (validatedData.recordingUrl !== undefined) {
      updateData.recordingUrl = validatedData.recordingUrl;
    }

    // Update session
    const [updatedSession] = await db
      .update(sessions)
      .set(updateData)
      .where(eq(sessions.id, sessionId))
      .returning();

    return NextResponse.json({
      success: true,
      session: updatedSession,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request data", details: error.errors },
        { status: 400 }
      );
    }

    console.error("Error updating session:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

