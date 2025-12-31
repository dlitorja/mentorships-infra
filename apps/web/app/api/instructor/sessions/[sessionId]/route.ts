import { NextRequest, NextResponse } from "next/server";
import { requireDbUser, isUnauthorizedError } from "@/lib/auth";
import { db, sessions, eq } from "@mentorships/db";
import { getMentorByUserId, getSessionById } from "@mentorships/db";
import { z } from "zod";

const updateSessionSchema = z.object({
  status: z.enum(["scheduled", "completed", "canceled", "no_show"]).optional(),
  notes: z.string().optional(),
  recordingUrl: z.string().url().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
): Promise<NextResponse> {
  try {
    // Require authentication and check role
    const user = await requireDbUser();
    if (user.role !== "mentor") {
      return NextResponse.json(
        { error: "Forbidden: Mentor role required" },
        { status: 403 }
      );
    }

    const mentor = await getMentorByUserId(user.id);

    if (!mentor) {
      return NextResponse.json(
        { error: "Mentor profile not found" },
        { status: 404 }
      );
    }

    const { sessionId } = await params;
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

    // Prepare update object with proper types
    const updateData: {
      status?: "scheduled" | "completed" | "canceled" | "no_show";
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
      } else if (validatedData.status === "no_show") {
        // No-show is similar to completed - session happened but student didn't attend
        // Set completedAt to mark the session as finished, clear canceledAt
        updateData.completedAt = new Date();
        updateData.canceledAt = null;
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
    // Handle Zod validation errors
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request data", details: error.issues },
        { status: 400 }
      );
    }

    // Handle authentication errors
    if (isUnauthorizedError(error)) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Rethrow Next.js redirect errors (shouldn't happen here, but just in case)
    if (
      error instanceof Error &&
      (error.message.includes("NEXT_REDIRECT") ||
        error.constructor.name === "RedirectError")
    ) {
      throw error;
    }

    // Log error without exposing sensitive data
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Error updating session:", errorMessage);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

