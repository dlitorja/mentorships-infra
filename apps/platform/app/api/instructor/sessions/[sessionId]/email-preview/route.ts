import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import {
  isUnauthorizedError,
  isForbiddenError,
} from "@/lib/errors";
import { requireRoleForApi } from "@/lib/auth-helpers";
import { getConvexClient } from "@/lib/convex";
import {
  buildSessionCanceledEmail,
  buildSessionRescheduledEmail,
} from "@mentorships/emails/session-changes";
import { formatSessionDateTime, getBaseUrl } from "@mentorships/emails/send";

type PreviewType = "reschedule" | "cancel";

const previewSchema = z.object({
  type: z.enum(["reschedule", "cancel"]),
  newScheduledAt: z.number().optional(),
  reason: z.string().optional(),
});

import { z } from "zod";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
): Promise<NextResponse> {
  try {
    const user = await requireRoleForApi("instructor");
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

    if (session.instructorId !== instructor._id) {
      return NextResponse.json(
        { error: "Unauthorized: Session does not belong to this instructor" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const validatedData = previewSchema.parse(body);

    const student = session.studentId
      ? await convex.query(api.users.getUserById, {
          id: session.studentId as Id<"users">,
        })
      : null;

    if (!student) {
      return NextResponse.json(
        { error: "Student not found" },
        { status: 404 }
      );
    }

    const studentName = student.email?.split("@")[0] ?? "Student";
    const studentEmail = student.email ?? "";
    const studentTimeZone = student.timeZone ?? null;
    const instructorName = instructor.name ?? "Instructor";

    let emailPreview: {
      subject: string;
      text: string;
      html: string;
    };

    if (validatedData.type === "cancel") {
      emailPreview = buildSessionCanceledEmail({
        studentEmail,
        studentName,
        instructorName,
        scheduledAt: new Date(session.scheduledAt),
        reason: validatedData.reason,
        studentTimeZone,
      });
    } else {
      if (!validatedData.newScheduledAt) {
        return NextResponse.json(
          { error: "newScheduledAt is required for reschedule preview" },
          { status: 400 }
        );
      }

      emailPreview = buildSessionRescheduledEmail({
        studentEmail,
        studentName,
        instructorName,
        oldScheduledAt: new Date(session.scheduledAt),
        newScheduledAt: new Date(validatedData.newScheduledAt),
        studentTimeZone,
      });
    }

    return NextResponse.json({
      success: true,
      preview: {
        subject: emailPreview.subject,
        text: emailPreview.text,
        html: emailPreview.html,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request data", details: error.issues },
        { status: 400 }
      );
    }

    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    console.error("Error generating email preview:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}