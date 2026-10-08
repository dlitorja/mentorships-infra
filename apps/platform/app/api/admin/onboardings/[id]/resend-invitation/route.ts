import { NextRequest, NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getConvexClient } from "@/lib/convex";
import { requireAdminOrSupportForApi } from "@/lib/auth-helpers";
import { isUnauthorizedError, isForbiddenError } from "@/lib/errors";
import { auth } from "@clerk/nextjs/server";
import { clerkClient } from "@clerk/nextjs/server";
import { createStudentClerkInvitation } from "@/lib/clerk-invitations";
import { inngest } from "@/inngest/client";
import { reportError } from "@/lib/observability";
import { convexIdSchema } from "@/lib/validators";

/**
 * PR 12 PR 2 — Resend the Clerk invitation for an onboarding row.
 *
 * Flow:
 *   1. Auth: requireAdminOrSupportForApi.
 *   2. Load the row via the admin-only `getAdminOnboarding` query to
 *      read `email`, `status`, and prior `clerkInvitationId`s. This
 *      keeps the Clerk revoke loop on the route side (Node runtime)
 *      and only writes state through Convex mutations.
 *   3. Refuse on `completed` / `cancelled` (terminal) → 409.
 *   4. Best-effort revoke prior `clerkInvitationId` via
 *      `clerkClient.invitations.revokeInvitation`. Errors are logged
 *      but do not block the resend — Clerk rejects revoke on already-
 *      accepted or already-revoked invites, and we still want to mint a
 *      fresh one when possible.
 *   5. Mint a fresh Clerk invite via `createStudentClerkInvitation`,
 *      reusing the same redirect URL as the original commit.
 *   6. Call `resendAdminOnboardingInvitation` mutation with the new
 *      invitationId — patches `perInstructor[i].clerkInvitationId`
 *      for non-renewal pairs and appends a timeline entry.
 *   7. If prior status was `failed`, chain `retryAdminOnboarding` to
 *      flip to `processing` + re-emit Inngest event so the workflow
 *      re-drives. For `queued` / `processing` we leave the Inngest
 *      pipeline alone — the new invite is the only side effect.
 *
 * Idempotency:
 *   - Workspace count unchanged before/after (no Convex writes to
 *     `workspaces`, `seatReservations`, or `sessionPacks`).
 *   - Timeline gets exactly one `invitation_resent` entry per
 *     successful resend (one mutation = one entry).
 *
 * Errors:
 *   - 401 unauthorized / 403 forbidden (auth gate)
 *   - 400 invalid onboarding id (zod)
 *   - 404 not found (row missing)
 *   - 409 terminal status (cannot resend from `completed` / `cancelled`)
 *   - 500 unexpected (logged via `reportError`)
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

    const onboardingId = idParsed.data as Id<"adminOnboardings">;

    const row = await convex.query(api.adminOnboarding.getAdminOnboarding, {
      id: onboardingId,
    });
    if (!row) {
      return NextResponse.json({ error: "Onboarding not found" }, { status: 404 });
    }

    if (row.status === "completed" || row.status === "cancelled") {
      return NextResponse.json(
        {
          error: `Cannot resend invitation: onboarding is ${row.status} (terminal state).`,
        },
        { status: 409 }
      );
    }

    const previousInvitationIds = Array.from(
      new Set(
        row.perInstructor
          .map((p) => p.clerkInvitationId)
          .filter((id): id is string => typeof id === "string" && id.length > 0)
      )
    );

    if (previousInvitationIds.length === 0) {
      return NextResponse.json(
        {
          error:
            "Cannot resend: no Clerk invitation was minted for this onboarding (renewal-only or invite creation originally failed).",
        },
        { status: 409 }
      );
    }

    const clerk = await clerkClient();
    for (const prevId of previousInvitationIds) {
      try {
        await clerk.invitations.revokeInvitation(prevId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await reportError({
          source: "api:admin/onboardings/resend-invitation:revoke",
          error: err instanceof Error ? err : new Error(String(err)),
          level: "warn",
          message: `Failed to revoke prior Clerk invitation ${prevId} during resend (continuing)`,
          context: { onboardingId, prevId, clerkErrorMessage: msg },
        });
      }
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL;
    if (!appUrl) {
      return NextResponse.json(
        {
          error:
            "NEXT_PUBLIC_APP_URL is not set; cannot build Clerk invitation redirect URL.",
        },
        { status: 500 }
      );
    }

    const mint = await createStudentClerkInvitation({
      emailAddress: row.email,
      redirectUrl: `${appUrl}/sign-up`,
    });
    if (!mint.success || !mint.invitationId) {
      return NextResponse.json(
        { error: mint.error ?? "Failed to mint new Clerk invitation" },
        { status: 502 }
      );
    }

    const newInvitationId = mint.invitationId;

    await convex.mutation(api.adminOnboarding.resendAdminOnboardingInvitation, {
      onboardingId,
      newInvitationId,
    });

    let responseStatus: "queued" | "processing" | "failed" | "cancelled" = row.status;
    let failureReason: string | undefined;

    if (row.status === "failed") {
      try {
        const retryResult = await convex.mutation(
          api.adminOnboarding.retryAdminOnboarding,
          { onboardingId }
        );
        responseStatus = retryResult.status;
        try {
          await inngest.send({
            name: "admin/onboarding.completed",
            data: {
              onboardingId: retryResult.onboardingId,
              attemptCount: retryResult.attemptCount,
            },
            id: `admin-onboarding:${retryResult.onboardingId}:${retryResult.attemptCount}`,
          });
        } catch (err) {
          await reportError({
            source: "api:admin/onboardings/resend-invitation",
            error: err instanceof Error ? err : new Error(String(err)),
            level: "warn",
            message:
              "Failed to emit admin/onboarding.completed Inngest event after resend+retry",
            context: {
              onboardingId: retryResult.onboardingId,
              attemptCount: retryResult.attemptCount,
            },
          });
          responseStatus = "failed";
          failureReason =
            "Inngest event send failed after resend+retry; admin must retry again.";
        }
      } catch (retryErr) {
        await reportError({
          source: "api:admin/onboardings/resend-invitation:retry",
          error: retryErr instanceof Error ? retryErr : new Error(String(retryErr)),
          level: "warn",
          message: "retryAdminOnboarding threw after a successful resend",
          context: { onboardingId },
        });
        responseStatus = "failed";
        failureReason =
          retryErr instanceof Error ? retryErr.message : "retry failed";
      }
    }

    return NextResponse.json({
      onboardingId,
      status: responseStatus,
      failureReason,
      previousInvitationIds,
      newInvitationId,
    });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isForbiddenError(error)) {
      return NextResponse.json(
        { error: "Forbidden: admin or support role required" },
        { status: 403 }
      );
    }

    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    if (errorMessage.toLowerCase().includes("terminal")) {
      return NextResponse.json({ error: errorMessage }, { status: 409 });
    }
    if (errorMessage.toLowerCase().includes("not found")) {
      return NextResponse.json({ error: errorMessage }, { status: 404 });
    }

    console.error("Error resending admin onboarding invitation:", error);
    return NextResponse.json(
      { error: "Failed to resend admin onboarding invitation" },
      { status: 500 }
    );
  }
}
