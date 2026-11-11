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
 * `getWorkExampleDownloadUrl` takes a `b2Key` (PR 4a Greptile P1
 * hardening), so this route resolves the `workExampleId` to its
 * stored b2Key first via a regular Convex query and then passes that
 * key through. Two round trips, but the resolve is server-checked.
 *
 * `?download=1` bakes `Content-Disposition: attachment` into the
 * signed URL so the reviewer gets a real file save. The `download`
 * attribute on an <a> is ignored for cross-origin (B2) URLs.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; exampleId: string }> }
): Promise<NextResponse> {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // `req.nextUrl` is NextRequest-only; the route is exercised with a
    // plain `Request` in unit tests, so parse the URL directly.
    const download = new URL(req.url).searchParams.get("download") === "1";
    const { id, exampleId } = await params;
    const onboardingId = convexIdSchema.parse(id) as Id<"adminOnboardings">;
    const workExampleId = convexIdSchema.parse(exampleId) as Id<"onboardingWorkExamples">;

    const convex = await getAuthenticatedConvexClient();
    const workExample = await convex.query(
      (api as any).onboardingWorkExamples.getWorkExampleByIdForViewer,
      { onboardingId, workExampleId } as any
    );
    if (!workExample) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const result = await convex.action(
      (api as any).onboardingWorkExamplesActions.getWorkExampleDownloadUrl,
      // Only add `download` when requested so the default (preview)
      // call keeps the historical two-arg shape.
      (download
        ? { onboardingId, b2Key: workExample.b2Key, download: true }
        : { onboardingId, b2Key: workExample.b2Key }) as any
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
