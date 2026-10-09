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
import { ONBOARDING_WORK_EXAMPLES_B2_PREFIX } from "@/lib/workspace-constants";

/**
 * POST /api/onboarding/[id]/work-examples/upload-url — mint a presigned
 * PUT URL for a work-example image upload. The action
 * `generateWorkExampleUploadUrl` returns both the URL and the reserved
 * `workExampleId`; the client PUTs to B2 with that URL, then calls
 * `/api/onboarding/[id]/work-examples` POST with the id to flip the row
 * from `pending` → `active`.
 *
 * Validates mime/size at the API boundary so a forged client can't
 * request an upload that would just be rejected server-side after the
 * B2 PUT (saves a wasted PUT round-trip).
 */
const uploadUrlSchema = z.object({
  fileName: z.string().min(1).max(255),
  contentType: z
    .string()
    .regex(/^image\/(jpeg|png|webp|gif)$/, "Unsupported image type"),
  size: z.number().int().positive().max(8 * 1024 * 1024, "Image too large"),
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
    const parsed = uploadUrlSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const convex = await getAuthenticatedConvexClient();
    const result = await convex.action(
      (api as any).onboardingWorkExamplesActions.generateWorkExampleUploadUrl,
      {
        onboardingId,
        fileName: parsed.data.fileName,
        contentType: parsed.data.contentType,
        size: parsed.data.size,
        keyPrefix: ONBOARDING_WORK_EXAMPLES_B2_PREFIX,
      } as any
    );

    return NextResponse.json(result);
  } catch (err) {
    if (isUnauthorizedError(err) || isForbiddenError(err)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const msg = err instanceof Error ? err.message : "Failed to mint upload URL";
    if (/capacity|limit|too large|too many/i.test(msg)) {
      return NextResponse.json({ error: msg }, { status: 422 });
    }
    reportError({ source: "api:onboarding.work-examples.upload-url.POST", error: err instanceof Error ? err : new Error(String(err)) });
    return NextResponse.json({ error: "Failed to mint upload URL" }, { status: 500 });
  }
}
