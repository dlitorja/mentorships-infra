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

/**
 * POST /api/onboarding/[id]/work-examples — finalize an upload. The
 * client PUT the bytes to B2 using the URL from `/upload-url`; this
 * route tells Convex to flip the row from `pending` → `active`. The
 * reserved `workExampleId` came back in the upload-url response, so
 * the client echoes it here.
 *
 * Idempotent: if the same `workExampleId` is recorded twice, the
 * second call is a no-op (server-side `recordWorkExampleUpload` checks
 * status before mutating).
 *
 * Greptile P1 #4: `recordWorkExampleUpload` only takes
 * `onboardingId` + `workExampleId`. The `fileId` is stored on the
 * pending row at upload-url time and never re-passed here.
 */
const recordSchema = z.object({
  workExampleId: convexIdSchema,
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
    const parsed = recordSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const convex = await getAuthenticatedConvexClient();
    const result = await convex.action(
      (api as any).onboardingWorkExamples.recordWorkExampleUpload,
      {
        onboardingId,
        workExampleId: parsed.data.workExampleId,
      } as any
    );

    return NextResponse.json(result);
  } catch (err) {
    if (isUnauthorizedError(err) || isForbiddenError(err)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    reportError({ source: "api:onboarding.work-examples.POST", error: err instanceof Error ? err : new Error(String(err)) });
    return NextResponse.json(
      { error: "Failed to record upload" },
      { status: 500 }
    );
  }
}
