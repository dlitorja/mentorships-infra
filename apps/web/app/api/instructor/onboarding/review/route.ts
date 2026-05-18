import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
// Removed legacy DB instructor lookup; Convex is the source of truth
import { and, db, eq } from "@mentorships/db";
import { api } from "@/convex/_generated/api";
import { getConvexClient } from "@/lib/convex";
import { requireRole } from "@/lib/auth-helpers";

const schema = z.object({
  submissionId: z.string().uuid(),
});

export async function POST(request: Request): Promise<NextResponse> {
  const errorId = randomUUID();
  try {
    const user = await requireRole("instructor");

    const form = await request.formData();
    const submissionId = schema.parse({ submissionId: form.get("submissionId") }).submissionId;

    const convex = getConvexClient();
    const instructor = await convex.query(api.instructors.getInstructorByUserId, { userId: user.id });
    if (!instructor) {
      return NextResponse.json({ error: "Instructor profile not found", errorId }, { status: 404 });
    }
    const result = await convex.mutation(api.studentOnboarding.markReviewed, {
      legacyId: submissionId,
      instructorId: instructor._id,
      reviewedByUserId: user.id,
    });
    if (!result.ok) {
      const status = result.error === "not_found" ? 404 : 403;
      return NextResponse.json({ error: result.error, errorId }, { status });
    }

    return NextResponse.redirect(new URL(`/instructor/onboarding?submissionId=${encodeURIComponent(submissionId)}`, request.url));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error", errorId },
      { status: 500 }
    );
  }
}
