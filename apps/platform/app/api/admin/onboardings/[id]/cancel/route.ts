import { NextRequest, NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getConvexClient } from "@/lib/convex";
import { requireAdminOrSupportForApi } from "@/lib/auth-helpers";
import { isUnauthorizedError, isForbiddenError } from "@/lib/errors";
import { auth } from "@clerk/nextjs/server";
import { convexIdSchema } from "@/lib/validators";

/**
 * POST /api/admin/onboardings/[id]/cancel
 *
 * Cancels a `queued`, `processing`, or `failed` onboarding. Artifacts
 * (session packs, seats, workspaces) are preserved — the admin can
 * audit what was created and release seats via separate primitives.
 * `cancelled` is a terminal state.
 *
 * Used by the recovery dashboard's per-row Cancel action. The
 * underlying mutation enforces the state machine: cancelling from
 * `completed` is rejected by `cancelAdminOnboarding`.
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
      api.adminOnboarding.cancelAdminOnboarding,
      { onboardingId: idParsed.data as Id<"adminOnboardings"> }
    );

    return NextResponse.json({
      onboardingId: result.onboardingId,
      status: result.status,
    });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Forbidden: admin or support role required" }, { status: 403 });
    }

    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    if (errorMessage.toLowerCase().includes("cannot cancel")) {
      return NextResponse.json({ error: errorMessage }, { status: 409 });
    }
    if (errorMessage.toLowerCase().includes("not found")) {
      return NextResponse.json({ error: errorMessage }, { status: 404 });
    }

    console.error("Error cancelling admin onboarding:", error);
    return NextResponse.json({ error: "Failed to cancel admin onboarding" }, { status: 500 });
  }
}
