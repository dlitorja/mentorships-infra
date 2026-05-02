import { NextRequest, NextResponse } from "next/server";
import { requireRoleForApi } from "@/lib/auth-helpers";
import { api } from "@/convex/_generated/api";
import { getConvexClient } from "@/lib/convex";
import { Id } from "@/convex/_generated/dataModel";
import { inngest } from "@/inngest/client";
import { getGoogleCalendarClient } from "@/lib/google";
import { z } from "zod";

function decryptMentorRefreshToken(mentor: { googleRefreshToken?: string }): string | null {
  if (!mentor.googleRefreshToken) return null;
  try {
    const decrypted = Buffer.from(mentor.googleRefreshToken, "base64").toString("utf-8");
    return decrypted.startsWith("__decrypted__") ? decrypted.replace("__decrypted__", "") : null;
  } catch {
    return null;
  }
}

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
    const user = await requireRoleForApi("mentor");
    const convex = getConvexClient();

    const mentor = await convex.query(api.instructors.getInstructorByUserId, {
      userId: user.id,
    });

    if (!mentor) {
      return NextResponse.json(
        { error: "Mentor profile not found" },
        { status: 404 }
      );
    }

    const { sessionId } = await params;
    const session = await convex.query(api.sessions.getSessionById, {
      id: sessionId as Id<"sessions">,
    });

    if (!session) {
      return NextResponse.json(
        { error: "Session not found" },
        { status: 404 }
      );
    }

    if (session.mentorId !== mentor._id) {
      return NextResponse.json(
        { error: "Unauthorized: Session does not belong to this mentor" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const validatedData = updateSessionSchema.parse(body);

    const updateData: {
      status?: "scheduled" | "completed" | "canceled" | "no_show";
      notes?: string;
      recordingUrl?: string;
      completedAt?: number | null;
      canceledAt?: number | null;
    } = {};

    if (validatedData.status) {
      updateData.status = validatedData.status;

      if (validatedData.status === "completed") {
        updateData.completedAt = Date.now();
        updateData.canceledAt = null;
      } else if (validatedData.status === "canceled") {
        updateData.canceledAt = Date.now();
        updateData.completedAt = null;
      } else if (validatedData.status === "no_show") {
        updateData.completedAt = Date.now();
        updateData.canceledAt = null;
      } else if (validatedData.status === "scheduled") {
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

    const updatedSession = await convex.mutation(api.sessions.updateSession, {
      id: sessionId as Id<"sessions">,
      ...updateData,
    });

    if (validatedData.status === "canceled") {
      try {
        await inngest.send({
          name: "session/cancelled-email",
          data: {
            sessionId,
            sessionPackId: session.sessionPackId,
            studentId: session.studentId,
            mentorId: session.mentorId,
            scheduledAt: session.scheduledAt,
            cancelledBy: "instructor" as const,
          },
        });
      } catch (sendError) {
        console.error("Failed to enqueue cancellation email:", sendError, {
          sessionId,
          sessionPackId: session.sessionPackId,
          studentId: session.studentId,
          mentorId: session.mentorId,
          scheduledAt: session.scheduledAt,
        });
      }

      if (session.googleCalendarEventId) {
        const mentorDoc = await convex.query(api.instructors.getMentorById, {
          id: session.mentorId,
        });

        if (!mentorDoc) {
          console.error("Mentor not found for calendar cleanup");
        } else {
          const decryptedToken = decryptMentorRefreshToken(mentorDoc);
          if (decryptedToken) {
            try {
              const calendar = await getGoogleCalendarClient(decryptedToken);
              const calendarId = mentorDoc.googleCalendarId || "primary";
              await calendar.events.delete({
                calendarId,
                eventId: session.googleCalendarEventId,
              });
            } catch (calendarError) {
              console.error("Failed to delete Google Calendar event:", calendarError);
            }
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      session: updatedSession,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request data", details: error.issues },
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