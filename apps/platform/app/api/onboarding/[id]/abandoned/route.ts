import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getAuthenticatedConvexClient } from "@/lib/convex";
import { convexIdSchema } from "@/lib/validators";
import { isUnauthorizedError, isForbiddenError } from "@/lib/errors";
import { reportError } from "@/lib/observability";

/**
 * POST /api/onboarding/[id]/abandoned — heartbeat beacon the client
 * fires on `beforeunload`. Only stamps `lastSeenAt` (does NOT touch
 * `reminderCount`); the abandonment cron uses `lastSeenAt` to decide
 * when a draft is stale.
 *
 * Idempotent and tolerant of network failure on tab close: the body is
 * empty, the response is intentionally tiny so a flaky network on
 * close doesn't keep the page from unloading. We still surface server
 * errors via `reportError` so a regression is observable in logs.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  try {
    const { userId } = await auth();
    if (!userId) {
      // Beacon should not produce noisy auth failures on close.
      return NextResponse.json({ ok: true });
    }

    const onboardingId = convexIdSchema.parse(params.id) as Id<"adminOnboardings">;
    const convex = await getAuthenticatedConvexClient();
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
