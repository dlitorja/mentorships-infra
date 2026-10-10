import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getAuthenticatedConvexClient } from "@/lib/convex";
import { convexIdSchema } from "@/lib/validators";
import { isUnauthorizedError, isForbiddenError } from "@/lib/errors";
import { reportError } from "@/lib/observability";
import { ONBOARDING_QUESTIONNAIRE_VERSION } from "@/lib/workspace-constants";
import { readJsonBody } from "@/lib/api/read-json-body";
import { z } from "zod";

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
 *
 * The body carries the full answers + inspirations so the submit
 * validator can re-check canonical question-id coverage without
 * trusting any client-side save state.
 */
const submitSchema = z.object({
  answers: z.array(
    z.object({
      questionId: z.string().min(1),
      questionText: z.string().min(1).max(500),
      answerText: z.string().max(8000),
    })
  ),
  inspirations: z.array(z.object({ name: z.string().min(1).max(120) })).max(8),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const onboardingId = convexIdSchema.parse(id) as Id<"adminOnboardings">;
    const body = await readJsonBody(req);
    const parsed = submitSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const convex = await getAuthenticatedConvexClient();
    const submission = await convex.mutation(
      (api as any).onboardingQuestionnaire.submitQuestionnaire,
      {
        onboardingId,
        questionnaireVersion: ONBOARDING_QUESTIONNAIRE_VERSION,
        answers: parsed.data.answers,
        inspirations: parsed.data.inspirations,
      } as any
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
