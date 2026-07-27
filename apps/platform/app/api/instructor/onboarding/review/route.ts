import { NextRequest, NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { getAuthenticatedConvexClient } from "@/lib/convex";
import { isUnauthorizedError, isForbiddenError } from "@/lib/errors";
import { requireRoleForApi } from "@/lib/auth-helpers";

/**
 * POST /api/instructor/onboarding/review
 * Marks a student onboarding submission as reviewed.
 * Expects a form submission with `submissionId` (the legacy UUID).
 * Redirects back to the onboarding page on success.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const user = await requireRoleForApi("instructor");
    const convex = await getAuthenticatedConvexClient();

    const instructor = await convex.query(api.instructors.getInstructorByUserId, {
      userId: user.id,
    });

    if (!instructor) {
      return NextResponse.json(
        { error: "Instructor profile not found" },
        { status: 404 }
      );
    }

    let submissionId: string | null = null;
    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const body = (await req.json()) as { submissionId?: string };
      submissionId = body.submissionId ?? null;
    } else {
      const formData = await req.formData();
      submissionId = formData.get("submissionId")?.toString() ?? null;
    }

    if (!submissionId) {
      return NextResponse.json(
        { error: "Missing submissionId" },
        { status: 400 }
      );
    }

    const result = await convex.mutation(api.studentOnboarding.markReviewed, {
      legacyId: submissionId,
      instructorId: instructor._id,
      reviewedByUserId: user.id,
    });

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error === "not_found" ? "Submission not found" : "Not allowed to review this submission" },
        { status: result.error === "not_found" ? 404 : 403 }
      );
    }

    const redirectUrl = new URL("/instructor/onboarding", req.url);
    redirectUrl.searchParams.set("submissionId", submissionId);
    redirectUrl.searchParams.set("reviewed", "1");

    return NextResponse.redirect(redirectUrl, { status: 303 });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Forbidden: Instructor role required" }, { status: 403 });
    }

    console.error("Onboarding review error:", error);
    return NextResponse.json(
      { error: "Failed to mark submission as reviewed" },
      { status: 500 }
    );
  }
}
