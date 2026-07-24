import { NextRequest, NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getConvexClient } from "@/lib/convex";
import { convexServerCall } from "@/lib/convex-server-call";
import { requireAdminOrSupportForApi } from "@/lib/auth-helpers";
import { isUnauthorizedError, isForbiddenError } from "@/lib/errors";
import { auth } from "@clerk/nextjs/server";
import { inngest } from "@/inngest/client";
import { reportError } from "@/lib/observability";
import { convexIdSchema } from "@/lib/validators";

/**
 * Mark the row as `failed` via the bearer-auth HTTP endpoint. Does NOT
 * require a Clerk token — see the same helper in
 * apps/platform/app/api/admin/students/onboard/route.ts for context.
 */
async function markOnboardingFailed(
  onboardingId: string,
  attemptCount: number,
  reason: string
): Promise<void> {
  try {
    await convexServerCall("/admin-onboarding/append-timeline", {
      onboardingId: onboardingId as Id<"adminOnboardings">,
      event: "failed",
      details: reason,
      expectedStatus: "processing",
      expectedAttemptCount: attemptCount,
    });
  } catch (err) {
    await reportError({
      source: "api:admin/onboardings/retry:mark-failed",
      error: err instanceof Error ? err : new Error(String(err)),
      level: "warn",
      message: "Could not mark onboarding as failed after Inngest send failure on retry",
      context: { onboardingId, attemptCount },
    });
  }
}

/**
 * POST /api/admin/onboardings/[id]/retry
 *
 * Resets a `failed` (or `queued`) onboarding back to `processing` and
 * re-emits the Inngest event with the new `attemptCount` so any cached
 * runs are bypassed (Inngest idempotency key includes the attempt).
 *
 * Used by the recovery dashboard's "Needs attention" tab. The
 * underlying mutation enforces the state machine: retries from
 * `completed` or `cancelled` are rejected by `retryAdminOnboarding`.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    await requireAdminOrSupportForApi();

    const convex = getConvexClient();
    const clerkAuth = await auth();
    const token = await clerkAuth.getToken({ template: "convex" });
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    convex.setAuth(token);

    const { id } = await params;
    const idParsed = convexIdSchema.safeParse(id);
    if (!idParsed.success) {
      return NextResponse.json({ error: "Invalid onboarding ID" }, { status: 400 });
    }
    const result = await convex.mutation(
      api.adminOnboarding.retryAdminOnboarding,
      { onboardingId: idParsed.data as Id<"adminOnboardings"> }
    );

    let responseStatus: "processing" | "failed" = "processing";
    let failureReason: string | undefined;
    try {
      await inngest.send({
        name: "admin/onboarding.completed",
        data: {
          onboardingId: result.onboardingId,
          attemptCount: result.attemptCount,
        },
        id: `admin-onboarding:${result.onboardingId}:${result.attemptCount}`,
      });
    } catch (err) {
      // Same recovery path as commit: mark failed so the row doesn't
      // sit in `processing` if the event bus is down.
      await reportError({
        source: "api:admin/onboardings/retry",
        error: err instanceof Error ? err : new Error(String(err)),
        level: "warn",
        message: "Failed to emit admin/onboarding.completed Inngest event on retry",
        context: { onboardingId: result.onboardingId, attemptCount: result.attemptCount },
      });
      await markOnboardingFailed(
        result.onboardingId,
        result.attemptCount,
        "Inngest event send failed on retry; admin must retry again."
      );
      responseStatus = "failed";
      failureReason = "Inngest event send failed on retry; admin must retry again.";
    }

    return NextResponse.json({
      onboardingId: result.onboardingId,
      status: responseStatus,
      failureReason,
      attemptCount: result.attemptCount,
    });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Forbidden: admin or support role required" }, { status: 403 });
    }

    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    if (errorMessage.toLowerCase().includes("cannot retry")) {
      return NextResponse.json({ error: errorMessage }, { status: 409 });
    }
    if (errorMessage.toLowerCase().includes("not found")) {
      return NextResponse.json({ error: errorMessage }, { status: 404 });
    }

    console.error("Error retrying admin onboarding:", error);
    return NextResponse.json({ error: "Failed to retry admin onboarding" }, { status: 500 });
  }
}
