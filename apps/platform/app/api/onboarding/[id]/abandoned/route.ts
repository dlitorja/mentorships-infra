import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@clerk/nextjs/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getAuthenticatedConvexClient } from "@/lib/convex";
import { convexIdSchema } from "@/lib/validators";
import { isUnauthorizedError, isForbiddenError } from "@/lib/errors";
import { reportError } from "@/lib/observability";
import { ONBOARDING_QUESTIONNAIRE_VERSION } from "@/lib/workspace-constants";
import { readJsonBody } from "@/lib/api/read-json-body";

/**
 * POST /api/onboarding/[id]/abandoned — heartbeat beacon the
 * client fires on `beforeunload`. Greptile round-17 P1:
 * previously this only stamped `lastSeenAt`. If the student
 * had pending debounced autosaves when they closed the tab,
 * those answers were lost. The route now ALSO saves any
 * answers/inspirations the client included in the beacon
 * body so closing the tab during the 500 ms debounce
 * window doesn't drop the latest edits.
 *
 * Both writes are best-effort: the response is intentionally
 * tiny and always `ok: true` so a flaky network on close
 * doesn't keep the page from unloading. Server-side errors
 * are surfaced via `reportError` so a regression is
 * observable in logs.
 */
const beaconBodySchema = z
  .object({
    answers: z
      .array(
        z.object({
          questionId: z.string().min(1),
          answerText: z.string().max(8000),
        })
      )
      .optional(),
    inspirations: z
      .array(z.object({ name: z.string().min(1).max(120) }))
      .max(8)
      .optional(),
  })
  .partial();

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { userId } = await auth();
    if (!userId) {
      // Beacon should not produce noisy auth failures on close.
      return NextResponse.json({ ok: true });
    }

    const { id } = await params;
    const onboardingId = convexIdSchema.parse(id) as Id<"adminOnboardings">;
    const convex = await getAuthenticatedConvexClient();

    // Try to parse the body, but treat parse failure as an
    // empty beacon — we never want to block the unload.
    let parsed: z.infer<typeof beaconBodySchema> = {};
    try {
      const raw = await readJsonBody(req);
      parsed = beaconBodySchema.parse(raw);
    } catch {
      parsed = {};
    }

    // If the client included pending answers/inspirations,
    // flush them through the same save mutation the autosave
    // chain uses. Only stamp the server's known questionText
    // so we don't accept arbitrary text from the wire.
    if (
      (parsed.answers && parsed.answers.length > 0) ||
      (parsed.inspirations && parsed.inspirations.length > 0)
    ) {
      const { ONBOARDING_QUESTIONS } = await import(
        "@/lib/onboarding-questions"
      );
      const stamped = (parsed.answers ?? []).map((a) => ({
        questionId: a.questionId,
        questionText:
          ONBOARDING_QUESTIONS.find((q) => q.id === a.questionId)?.label ?? "",
        answerText: a.answerText,
      }));
      await convex.mutation(
        (api as any).onboardingQuestionnaire.saveQuestionnaireDraft,
        {
          onboardingId,
          questionnaireVersion: ONBOARDING_QUESTIONNAIRE_VERSION,
          answers: stamped,
          inspirations: parsed.inspirations ?? [],
        } as any
      );
    }

    await convex.mutation(
      (api as any).onboardingQuestionnaire.recordQuestionnaireSeen,
      { onboardingId } as any
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (isUnauthorizedError(err) || isForbiddenError(err)) {
      return NextResponse.json({ ok: true });
    }
    reportError({ source: "api:onboarding.abandoned.POST", error: err instanceof Error ? err : new Error(String(err)) });
    return NextResponse.json({ ok: true });
  }
}
