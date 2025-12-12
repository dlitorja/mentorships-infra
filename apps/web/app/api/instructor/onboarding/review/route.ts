import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { and, db, eq, getMentorByUserId, menteeOnboardingSubmissions } from "@mentorships/db";
import { requireRole } from "@/lib/auth-helpers";

const schema = z.object({
  submissionId: z.string().uuid(),
});

export async function POST(request: Request): Promise<NextResponse> {
  const errorId = randomUUID();
  try {
    const user = await requireRole("mentor");
    const mentor = await getMentorByUserId(user.id);
    if (!mentor) {
      return NextResponse.json({ error: "Mentor profile not found", errorId }, { status: 404 });
    }

    const form = await request.formData();
    const submissionId = schema.parse({ submissionId: form.get("submissionId") }).submissionId;

    const [updated] = await db
      .update(menteeOnboardingSubmissions)
      .set({
        reviewedAt: new Date(),
        reviewedByUserId: user.id,
        updatedAt: new Date(),
      })
      .where(and(eq(menteeOnboardingSubmissions.id, submissionId), eq(menteeOnboardingSubmissions.mentorId, mentor.id)))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Submission not found", errorId }, { status: 404 });
    }

    return NextResponse.redirect(new URL(`/instructor/onboarding?submissionId=${encodeURIComponent(submissionId)}`, request.url));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error", errorId },
      { status: 500 }
    );
  }
}


