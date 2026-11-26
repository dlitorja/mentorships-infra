import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getAuthenticatedConvexClient } from "@/lib/convex";
import { convexServerCall } from "@/lib/convex-server-call";
import { requireAdminOrSupportForApi } from "@/lib/auth-helpers";
import { isUnauthorizedError, isForbiddenError } from "@/lib/errors";
import { inngest } from "@/inngest/client";
import { convexIdSchema } from "@/lib/validators";
import { readJsonBody } from "@/lib/api/read-json-body";
import { reportError } from "@/lib/observability";

const approveSchema = z.object({
  instructorId: convexIdSchema,
  sessionsPerInstructor: z.number().int().min(1).default(4),
  expiresAt: z.number().int().positive().optional(),
  notes: z.string().max(2000).optional(),
});

/**
 * POST /api/admin/kajabi-purchases/[id]/approve
 *
 * Approves a pending Kajabi purchase confirmation and runs the existing
 * admin-onboarding commit. No Clerk invitation is created: sign-up is public
 * and the student email links to `/sign-up`, so the admin-onboarding flow
 * includes that step automatically when there is no invitation id.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    await requireAdminOrSupportForApi();

    const { id } = await params;
    const purchaseId = convexIdSchema.parse(id) as Id<"kajabiPurchaseInbox">;

    const body = await readJsonBody(req);
    if (body === null) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const parsed = approveSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.issues },
        { status: 400 }
      );
    }

    const convex = await getAuthenticatedConvexClient();
    const expiresAt =
      parsed.data.expiresAt ?? Date.now() + 90 * 24 * 60 * 60 * 1000;

    // Commit + mark the purchase approved in one Convex transaction, so a
    // UI retry after a partial failure returns the existing onboarding
    // instead of creating a duplicate.
    const result = await convex.mutation(
      api.adminOnboarding.approveKajabiPurchase,
      {
        purchaseId,
        instructorId: parsed.data.instructorId as Id<"instructors">,
        sessionsPerInstructor: parsed.data.sessionsPerInstructor,
        expiresAt,
        notes: parsed.data.notes,
      }
    );

    try {
      await inngest.send({
        name: "admin/onboarding.completed",
        data: {
          onboardingId: result.onboardingId,
          attemptCount: 1,
        },
      });
    } catch (sendError) {
      await reportError({
        source: "api:admin/kajabi-purchases:approve",
        error: sendError instanceof Error ? sendError : new Error(String(sendError)),
        level: "error",
        message:
          "Onboarding committed but the email flow event failed; marking the row failed for retry",
        context: { purchaseId, onboardingId: result.onboardingId },
      });
      // The onboarding dashboard only offers Retry for `failed` rows, so
      // flip the row out of `processing` before telling staff to retry.
      try {
        await convexServerCall("/admin-onboarding/append-timeline", {
          onboardingId: result.onboardingId,
          event: "failed",
          details: "Email flow did not start after Kajabi purchase approval",
          expectedStatus: "processing",
          expectedAttemptCount: 1,
        });
      } catch (markError) {
        await reportError({
          source: "api:admin/kajabi-purchases:approve:mark-failed",
          error:
            markError instanceof Error ? markError : new Error(String(markError)),
          level: "warn",
          message: "Could not mark the onboarding failed after the event send failure",
          context: { purchaseId, onboardingId: result.onboardingId },
        });
      }
      return NextResponse.json(
        {
          error:
            "Onboarding was created but the email flow did not start. The onboarding is marked failed; retry it from /admin/onboardings.",
          onboardingId: result.onboardingId,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      onboardingId: result.onboardingId,
    });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    await reportError({
      source: "api:admin/kajabi-purchases:approve",
      error: error instanceof Error ? error : new Error(String(error)),
      level: "error",
      message: "Failed to approve Kajabi purchase",
    });
    return NextResponse.json(
      { error: "Failed to approve purchase" },
      { status: 500 }
    );
  }
}
