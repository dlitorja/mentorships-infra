import { NextRequest, NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { getConvexClient } from "@/lib/convex";
import { requireAdminOrSupportForApi } from "@/lib/auth-helpers";
import { isUnauthorizedError, isForbiddenError } from "@/lib/errors";
import { auth } from "@clerk/nextjs/server";
import { inngest } from "@/inngest/client";
import { reportError } from "@/lib/observability";

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
) {
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
    const result = await convex.mutation(
      api.adminOnboarding.retryAdminOnboarding,
      { onboardingId: id as any }
    );

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
      await reportError({
        source: "api:admin/onboardings/retry",
        error: err instanceof Error ? err : new Error(String(err)),
        level: "warn",
        message: "Failed to emit admin/onboarding.completed Inngest event on retry",
        context: { onboardingId: result.onboardingId, attemptCount: result.attemptCount },
      });
    }

    return NextResponse.json({
      onboardingId: result.onboardingId,
      status: result.status,
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
