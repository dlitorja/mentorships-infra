import { NextRequest, NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getConvexClient } from "@/lib/convex";
import { requireAdminOrSupportForApi } from "@/lib/auth-helpers";
import { isUnauthorizedError, isForbiddenError } from "@/lib/errors";
import { auth } from "@clerk/nextjs/server";
import { clerkClient } from "@clerk/nextjs/server";
import { reportError } from "@/lib/observability";
import { convexIdSchema } from "@/lib/validators";
import { createStudentClerkInvitation } from "@/lib/clerk-invitations";

/**
 * Resend a single `studentInvitations` row's Clerk invitation.
 *
 * Mirrors `apps/platform/app/api/admin/onboardings/[id]/resend-invitation/route.ts`
 * but with the simpler row shape of `studentInvitations` (no per-instructor
 * pairs, no `adminOnboardings` timeline).
 *
 * Flow (PR-B / Issue 3):
 *
 *   1. Verify the caller is admin or support (`requireAdminOrSupportForApi`).
 *   2. Read the row via the admin-gated query
 *      `convex/studentInvitations.getStudentInvitationById`. Refuse early
 *      if missing or already in a terminal status (`accepted`, `cancelled`).
 *   3. Mint a FRESH Clerk invitation FIRST, via
 *      `lib/clerk-invitations.createStudentClerkInvitation`. This ordering
 *      matters: if the Convex write fails after the mint we still have a
 *      live Clerk link (matches the onboarding-resend ordering).
 *   4. Convex mutation `studentInvitations.resendStudentInvitation` patches
 *      the row's `clerkInvitationId`, `expiresAt`, and resets `status` to
 *      `pending`. The mutation writes an `auditLogs` entry itself; we
 *      don't need a second write here.
 *   5. Best-effort revoke the previous Clerk invitation AFTER the save.
 *      A revoke failure does NOT undo the new invite — the new invite is
 *      the live one, and Clerk keeps the stale row invisible to
 *      `client.invitations.getInvitationList`.
 *
 * Errors:
 *   - `401 Unauthorized` (caller has no Clerk session).
 *   - `403 Forbidden` (caller is signed in but not admin/support, or the
 *     Convex gate throws "Forbidden: admin or support role required" via
 *     `isForbiddenError`).
 *   - `404 Not Found` (invitationId doesn't resolve to a row in
 *     `getStudentInvitationById`).
 *   - `409 Conflict` (terminal status — resend refused; matches the
 *     OnboardingCancel error mapping).
 *   - `400 Bad Request` (malformed invitationId).
 *   - `502 Bad Gateway` (Clerk mint failed — propagated as the original
 *     error string so the UI can show it).
 *
 * NOTE: this route handler is intentionally narrow — it does NOT create
 * a new `studentInvitations` row. If the row is missing or in a
 * terminal state, the operator should use the existing
 * `/admin/students/invite` form to issue a fresh invitation, not resend.
 */
const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdminOrSupportForApi();

    const { id: rawInvitationId } = await context.params;
    const parsed = convexIdSchema.safeParse(rawInvitationId);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid invitationId" },
        { status: 400 }
      );
    }
    const invitationId = rawInvitationId as Id<"studentInvitations">;

    const convex = getConvexClient();
    const clerkAuth = await auth();
    const token = await clerkAuth.getToken({ template: "convex" });
    if (!token) {
      return NextResponse.json(
        { error: "Missing Convex auth token" },
        { status: 401 }
      );
    }
    convex.setAuth(token);

    const row = await convex.query(api.studentInvitations.getStudentInvitationById, {
      id: invitationId,
    });
    if (!row) {
      return NextResponse.json(
        { error: "Student invitation not found" },
        { status: 404 }
      );
    }
    if (row.status === "accepted" || row.status === "cancelled") {
      return NextResponse.json(
        {
          error: `Cannot resend invitation from terminal status '${row.status}'`,
        },
        { status: 409 }
      );
    }

    // Step 1: mint a fresh Clerk invitation BEFORE the Convex write so a
    // failed mint never strands the student with no link.
    const clerkResult = await createStudentClerkInvitation({
      emailAddress: row.email,
    });
    if (!clerkResult.success || !clerkResult.invitationId) {
      return NextResponse.json(
        {
          error: clerkResult.error ?? "Failed to mint Clerk invitation",
        },
        { status: 502 }
      );
    }

    const previousClerkInvitationId = row.clerkInvitationId;
    const newExpiresAt = Date.now() + INVITATION_TTL_MS;

    // Step 2: patch the row via the admin-gated Resend mutation. The
    // mutation's gate is a second line of defense — if service-side
    // gating fails (e.g. someone bypasses this route), Convex still
    // refuses.
    const patch = await convex.mutation(
      api.studentInvitations.resendStudentInvitation,
      {
        invitationId,
        newClerkInvitationId: clerkResult.invitationId,
        expiresAt: newExpiresAt,
      }
    );

    // Step 3: best-effort revoke the previous Clerk invitation. If this
    // fails, the new invite is still active and valid; we just log and
    // keep going. matches onboarding-resend's revoke-after-save ordering.
    if (previousClerkInvitationId && previousClerkInvitationId !== clerkResult.invitationId) {
      try {
        const client = await clerkClient();
        await client.invitations.revokeInvitation(previousClerkInvitationId);
      } catch (revokeErr) {
        reportError(revokeErr, {
          source: "/api/admin/students/invitations/[id]/resend",
          stage: "revoke_prior_clerk_invitation",
          invitationId,
          previousClerkInvitationId,
        });
      }
    }

    return NextResponse.json({
      invitationId,
      previousClerkInvitationId,
      newClerkInvitationId: clerkResult.invitationId,
      expiresAt: newExpiresAt,
      previousStatus: patch.previousStatus,
      newStatus: "pending",
    });
  } catch (err) {
    if (isUnauthorizedError(err)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isForbiddenError(err)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Convex's admin/support gate surfaces its own `Forbidden` substring.
    // Map to HTTP 403.
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("Forbidden") || message.includes("Forbidden: admin or support role required")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    reportError(err, {
      source: "/api/admin/students/invitations/[id]/resend",
    });
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
