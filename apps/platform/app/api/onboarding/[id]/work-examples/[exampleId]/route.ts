import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getAuthenticatedConvexClient } from "@/lib/convex";
import { convexIdSchema } from "@/lib/validators";
import { isUnauthorizedError, isForbiddenError } from "@/lib/errors";
import { reportError } from "@/lib/observability";

/**
 * DELETE /api/onboarding/[id]/work-examples/[exampleId] — remove a
 * work example the student uploaded. Server-side `deleteWorkExample`
 * verifies ownership + that the row is still `pending` or `active`
 * (cannot delete an already-deleted row).
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; exampleId: string }> }
): Promise<NextResponse> {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id, exampleId } = await params;
    const onboardingId = convexIdSchema.parse(id) as Id<"adminOnboardings">;
    const workExampleId = convexIdSchema.parse(exampleId) as Id<"onboardingWorkExamples">;

    const convex = await getAuthenticatedConvexClient();
    const result = await convex.mutation(
      (api as any).onboardingWorkExamples.deleteWorkExample,
      { onboardingId, workExampleId } as any
    );

    return NextResponse.json(result);
  } catch (err) {
    if (isUnauthorizedError(err) || isForbiddenError(err)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    reportError({ source: "api:onboarding.work-examples.DELETE", error: err instanceof Error ? err : new Error(String(err)) });
    return NextResponse.json(
      { error: "Failed to delete work example" },
      { status: 500 }
    );
  }
}
