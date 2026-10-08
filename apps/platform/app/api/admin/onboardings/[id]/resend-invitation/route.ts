import { NextRequest, NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getConvexClient } from "@/lib/convex";
import { convexServerCall } from "@/lib/convex-server-call";
import { requireAdminOrSupportForApi } from "@/lib/auth-helpers";
import { isUnauthorizedError, isForbiddenError } from "@/lib/errors";
import { auth } from "@clerk/nextjs/server";
import { clerkClient } from "@clerk/nextjs/server";
import { createStudentClerkInvitation } from "@/lib/clerk-invitations";
import { inngest } from "@/inngest/client";
import { reportError } from "@/lib/observability";
import { convexIdSchema } from "@/lib/validators";

/**
 * Mark the row as `failed` via the bearer-auth HTTP endpoint after a
 * failed Inngest event send. Mirrors the same helper in
 * `apps/platform/app/api/admin/onboardings/[id]/retry/route.ts:18-40`.
 * Uses `expectedStatus: "processing"` so a concurrent state change
 * (e.g. another admin clicks Cancel) doesn't silently overwrite a
 * newer status.
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
      source: "api:admin/onboardings/resend-invitation:mark-failed",
      error: err instanceof Error ? err : new Error(String(err)),
      level: "warn",
      message: "Could not mark onboarding as failed after Inngest send failure on resend",
      context: { onboardingId, attemptCount },
    });
  }
}

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
 *   4. Refuse on renewal-only rows (no `clerkInvitationId` on any
 *      pair) → 409. Without an existing invitation there's nothing
 *      to revoke or replace.
 *   5. Verify `NEXT_PUBLIC_APP_URL` is set BEFORE touching Clerk —
 *      otherwise we'd revoke the prior invite without minting a
 *      replacement and the student would be locked out (Greptile
 *      P2 finding).
 *   6. Best-effort revoke prior `clerkInvitationId` via
 *      `clerkClient.invitations.revokeInvitation`. Errors are logged
 *      but do not block the resend — Clerk rejects revoke on already-
 *      accepted or already-revoked invites, and we still want to mint a
 *      fresh one when possible.
 *   7. Mint a fresh Clerk invite via `createStudentClerkInvitation`,
 *      reusing the same redirect URL as the original commit.
 *   8. Call `resendAdminOnboardingInvitation` mutation with the new
 *      invitationId — patches `perInstructor[i].clerkInvitationId`
 *      for non-renewal pairs and appends a timeline entry. If the
 *      mutation throws (e.g. concurrent state change flipped the row
 *      to terminal), revoke the freshly-minted invite so the student
 *      doesn't receive a signup link to a stale onboarding (Greptile
 *      P2 finding).
 *   9. If prior status was `failed`, chain `retryAdminOnboarding` to
 *      flip to `processing` + re-emit Inngest event. If the Inngest
 *      send then fails, mark the row as `failed` via the bearer-auth
 *      append-timeline endpoint so staff can still retry from the
 *      recovery dashboard (Greptile P1 finding — without this, the
 *      row sits in `processing` forever and the staff's only escape
 *      is another resend, which won't re-emit the event).
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
 *   - 409 renewal-only row (no `clerkInvitationId` to replace)
 *   - 500 missing `NEXT_PUBLIC_APP_URL` (would leak state — caught
 *     before any Clerk call)
 *   - 502 Clerk mint failure
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

    // Verify the redirect URL is available BEFORE we revoke anything.
    // If we revoked first and then discovered the env var was missing,
    // the student would lose their original signup link with no
    // replacement. Greptile P2 finding.
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

    try {
      await convex.mutation(api.adminOnboarding.resendAdminOnboardingInvitation, {
        onboardingId,
        newInvitationId,
      });
    } catch (saveErr) {
      // The mutation rejected (e.g. concurrent cancel flipped the row
      // to terminal between our check and the save). Revoke the
      // freshly-minted invitation so the student doesn't receive a
      // signup link to a stale onboarding. Greptile P2 finding.
      try {
        await clerk.invitations.revokeInvitation(newInvitationId);
      } catch (revokeErr) {
        await reportError({
          source: "api:admin/onboardings/resend-invitation:rollback-revoke",
          error: revokeErr instanceof Error ? revokeErr : new Error(String(revokeErr)),
          level: "warn",
          message: `Failed to revoke freshly-minted Clerk invitation ${newInvitationId} after save rejection`,
          context: { onboardingId, newInvitationId },
        });
      }
      throw saveErr;
    }

    let responseStatus: "queued" | "processing" | "failed" | "cancelled" = row.status;
    let failureReason: string | undefined;

    if (row.status === "failed") {
      let retryResult: { onboardingId: string; status: "processing"; attemptCount: number } | null = null;
      try {
        retryResult = await convex.mutation(
          api.adminOnboarding.retryAdminOnboarding,
          { onboardingId }
        );
        responseStatus = retryResult.status;
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

      if (retryResult) {
        try {
          await inngest.send({
            name: "admin/onboarding.completed",
            data: {
              onboardingId: retryResult.onboardingId,
              attemptCount: retryResult.attemptCount,
            },
            id: `admin-onboarding:${retryResult.onboardingId}:${retryResult.attemptCount}`,
          });
        } catch (sendErr) {
          // Without this, the row sits in `processing` forever and
          // the staff's only escape is another resend (which won't
          // re-emit the Inngest event). Mark the row failed so the
          // recovery dashboard's "Needs attention" tab can pick it up.
          // Greptile P1 finding.
          await reportError({
            source: "api:admin/onboardings/resend-invitation",
            error: sendErr instanceof Error ? sendErr : new Error(String(sendErr)),
            level: "warn",
            message:
              "Failed to emit admin/onboarding.completed Inngest event after resend+retry",
            context: {
              onboardingId: retryResult.onboardingId,
              attemptCount: retryResult.attemptCount,
            },
          });
          await markOnboardingFailed(
            retryResult.onboardingId,
            retryResult.attemptCount,
            "Inngest event send failed after resend+retry; admin must retry again."
          );
          responseStatus = "failed";
          failureReason =
            "Inngest event send failed after resend+retry; admin must retry again.";
        }
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
