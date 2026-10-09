import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getAuthenticatedConvexClient } from "@/lib/convex";
import { convexIdSchema } from "@/lib/validators";
import { isUnauthorizedError, isForbiddenError } from "@/lib/errors";
import { reportError } from "@/lib/observability";

/**
 * GET /api/onboarding/[id]/work-examples/[exampleId]/download-url —
 * mint a short-lived presigned GET URL for an instructor or admin to
 * view a student's work example. The action
 * `getWorkExampleDownloadUrl` re-checks that the b2Key belongs to
 * this onboarding so a forged key from one onboarding can't be used to
 * fetch another onboarding's image (see PR 4a Greptile P1 on
 * `resolveDownloadAccess`).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string; exampleId: string } }
): Promise<NextResponse> {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const onboardingId = convexIdSchema.parse(params.id) as Id<"adminOnboardings">;
    const workExampleId = convexIdSchema.parse(params.exampleId) as Id<"onboardingWorkExamples">;

    const convex = await getAuthenticatedConvexClient();
    const result = await convex.action(
      (api as any).onboardingWorkExamplesActions.getWorkExampleDownloadUrl,
      { onboardingId, workExampleId } as any
    );

    return NextResponse.json(result);
  } catch (err) {
    if (isUnauthorizedError(err) || isForbiddenError(err)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    reportError({ source: "api:onboarding.work-examples.download-url.GET", error: err instanceof Error ? err : new Error(String(err)) });
    return NextResponse.json(
      { error: "Failed to mint download URL" },
      { status: 500 }
    );
  }
}
