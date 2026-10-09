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
 * route tells Convex to flip the row from `pending` → `active` and
 * record the B2 file id.
 *
 * Idempotent: if the same `workExampleId` is recorded twice, the
 * second call is a no-op (server-side `recordWorkExampleUpload` checks
 * status before mutating).
 */
const recordSchema = z.object({
  workExampleId: convexIdSchema,
  fileId: z.string().min(1),
});

export async function POST(
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
    const parsed = recordSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const convex = await getAuthenticatedConvexClient();
    const result = await convex.mutation(
      (api as any).onboardingWorkExamples.recordWorkExampleUpload,
      {
        onboardingId,
        workExampleId: parsed.data.workExampleId,
        fileId: parsed.data.fileId,
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
