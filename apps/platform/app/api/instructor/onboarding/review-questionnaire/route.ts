import { NextRequest, NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { getAuthenticatedConvexClient } from "@/lib/convex";
import { isUnauthorizedError, isForbiddenError } from "@/lib/errors";
import { requireRoleForApi } from "@/lib/auth-helpers";
import type { Id } from "@/convex/_generated/dataModel";

/**
 * POST /api/instructor/onboarding/review-questionnaire
 * Marks a submitted questionnaire as reviewed (or clears the review
 * when `reviewed=false`). Accepts either a form submission or JSON with
 * `onboardingId` + optional `reviewed` / `returnTab`.
 *
 * Authorization lives in the Convex mutation
 * (`onboardingQuestionnaire:markQuestionnaireSubmissionReviewed`): the
 * caller must be an assigned instructor on the onboarding row, or an
 * admin/support user. This route only enforces the instructor role and
 * forwards the derived Clerk identity.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    await requireRoleForApi("instructor");
    const convex = await getAuthenticatedConvexClient();

    let onboardingId: string | null = null;
    let reviewed = true;
    let returnTab = "unreviewed";

    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const body = (await req.json()) as {
        onboardingId?: string;
        reviewed?: boolean;
        returnTab?: string;
      };
      onboardingId = body.onboardingId ?? null;
      reviewed = body.reviewed ?? true;
      returnTab = body.returnTab ?? "unreviewed";
    } else {
      const formData = await req.formData();
      onboardingId = formData.get("onboardingId")?.toString() ?? null;
      reviewed = formData.get("reviewed")?.toString() !== "false";
      returnTab =
        formData.get("returnTab")?.toString() === "reviewed"
          ? "reviewed"
          : "unreviewed";
    }

    if (!onboardingId) {
      return NextResponse.json(
        { error: "Missing onboardingId" },
        { status: 400 }
      );
    }

    const result = await convex.mutation(
      api.onboardingQuestionnaire.markQuestionnaireSubmissionReviewed,
      {
        onboardingId: onboardingId as Id<"adminOnboardings">,
        reviewed,
      }
    );

    if (!result.ok) {
      const status =
        result.error === "not_found"
          ? 404
          : result.error === "not_submitted"
            ? 409
            : 403;
      return NextResponse.json({ error: result.error }, { status });
    }

    const redirectUrl = new URL("/instructor/onboarding", req.url);
    redirectUrl.searchParams.set("tab", returnTab);
    return NextResponse.redirect(redirectUrl, { status: 303 });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isForbiddenError(error)) {
      return NextResponse.json(
        { error: "Forbidden: Instructor role required" },
        { status: 403 }
      );
    }

    console.error("Questionnaire review error:", error);
    return NextResponse.json(
      { error: "Failed to update review status" },
      { status: 500 }
    );
  }
}
