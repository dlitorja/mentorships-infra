import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@clerk/nextjs/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getAuthenticatedConvexClient } from "@/lib/convex";
import { convexIdSchema } from "@/lib/validators";
import { readJsonBody } from "@/lib/api/read-json-body";
import { isUnauthorizedError, isForbiddenError } from "@/lib/errors";
import { reportError } from "@/lib/observability";

const inspirationSchema = z.object({
  name: z
    .string()
    .min(1, "Each inspiration must have a name")
    .max(120, "Inspiration name is too long"),
});

const answerSchema = z.object({
  questionId: z.string().min(1),
  answerText: z.string().max(8000),
});

const saveDraftSchema = z.object({
  answers: z.array(answerSchema),
  inspirations: z.array(inspirationSchema).max(8),
});

/**
 * GET /api/onboarding/[id]/questionnaire — read the current draft or
 * submitted row for the signed-in viewer. Auth is propagated to Convex
 * via the Clerk JWT; the server-side `getQuestionnaireForCurrentUser`
 * query resolves the viewer role.
 *
 * Returns `{ submission: null }` when no row exists yet (first visit)
 * or when the viewer is not authorized (rendering a 404 in the page is
 * the caller's call; we don't leak existence here).
 */
export async function GET(
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
    const submission = await convex.query(
      (api as any).onboardingQuestionnaire.getQuestionnaireForCurrentUser,
      { onboardingId } as any
    );
    const workExamples = await convex.query(
      (api as any).onboardingWorkExamples.listWorkExamples,
      { onboardingId } as any
    );

    return NextResponse.json({ submission, workExamples });
  } catch (err) {
    if (isUnauthorizedError(err) || isForbiddenError(err)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    reportError({ source: "api:onboarding.questionnaire.GET", error: err instanceof Error ? err : new Error(String(err)) });
    return NextResponse.json(
      { error: "Failed to read questionnaire" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/onboarding/[id]/questionnaire — auto-save a draft. Debounced
 * client-side at `ONBOARDING_AUTOSAVE_DEBOUNCE_MS`. Only the assigned
 * student can save; server-side `saveQuestionnaireDraft` re-checks
 * `assignedStudentClerkId` so a forged body still rejects.
 *
 * Returns the updated submission row.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const onboardingId = convexIdSchema.parse(params.id) as Id<"adminOnboardings">;
    const body = await readJsonBody(req);
    const parsed = saveDraftSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const convex = await getAuthenticatedConvexClient();
    const submission = await convex.mutation(
      (api as any).onboardingQuestionnaire.saveQuestionnaireDraft,
      {
        onboardingId,
        answers: parsed.data.answers,
        inspirations: parsed.data.inspirations,
      } as any
    );

    return NextResponse.json({ submission });
  } catch (err) {
    if (isUnauthorizedError(err) || isForbiddenError(err)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    reportError({ source: "api:onboarding.questionnaire.PATCH", error: err instanceof Error ? err : new Error(String(err)) });
    return NextResponse.json(
      { error: "Failed to save draft" },
      { status: 500 }
    );
  }
}
