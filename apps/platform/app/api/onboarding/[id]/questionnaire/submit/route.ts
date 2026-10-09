import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getAuthenticatedConvexClient } from "@/lib/convex";
import { convexIdSchema } from "@/lib/validators";
import { isUnauthorizedError, isForbiddenError } from "@/lib/errors";
import { reportError } from "@/lib/observability";

/**
 * POST /api/onboarding/[id]/questionnaire/submit — finalize the
 * questionnaire. Server-side `submitQuestionnaire` re-checks:
 *   - viewer is the assigned student
 *   - all required question IDs have a non-empty answer
 *   - inspiration count >= MIN_INSPIRATIONS
 *   - active work-example count >= MIN_WORK_EXAMPLES_PER_SUBMISSION
 *
 * The client-side form pre-checks the same conditions to render
 * disabled state, but the server is authoritative.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const onboardingId = convexIdSchema.parse(params.id) as Id<"adminOnboardings">;

    const convex = await getAuthenticatedConvexClient();
    const submission = await convex.mutation(
      (api as any).onboardingQuestionnaire.submitQuestionnaire,
      { onboardingId } as any
    );

    return NextResponse.json({ submission });
  } catch (err) {
    if (isUnauthorizedError(err) || isForbiddenError(err)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const msg = err instanceof Error ? err.message : "Failed to submit";
    reportError({ source: "api:onboarding.questionnaire.submit.POST", error: err instanceof Error ? err : new Error(String(err)) });
    if (/missing required|not enough work|inspirations/i.test(msg)) {
      return NextResponse.json({ error: msg }, { status: 422 });
    }
    return NextResponse.json({ error: "Failed to submit" }, { status: 500 });
  }
}
