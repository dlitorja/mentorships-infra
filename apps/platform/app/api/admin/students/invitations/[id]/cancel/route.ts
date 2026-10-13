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

/**
 * Cancel a single `studentInvitations` row AND revoke the live Clerk
 * invitation so the recipient cannot still sign up via the emailed
 * link. Registered alongside the resend route at
 * `apps/platform/app/api/admin/students/invitations/[id]/cancel`.
 *
 * PR-B (Issue 3) round-1 Greptile fix (P1 #4264777494). The PR-B
 * Cancel UI initially invoked `studentInvitations.updateStudentInvitationStatus`
 * directly via `useConvexMutation`, which only flipped the Convex
 * status — the Clerk invitation stayed active and the recipient
 * could still complete Clerk `SignUp`. Status flips from the client
 * cannot revoke Clerk. This route runs server-side where the Clerk
 * SDK lives.
 *
 * Flow:
 *   1. Verify the caller is admin or support.
 *   2. Read the row via the admin-gated query
 *      `convex/studentInvitations.getStudentInvitationById`. 404 if
 *      missing.
 *   3. If `row.clerkInvitationId` is set, best-effort revoke the
 *      Clerk invitation. Failure here is logged and does not block
 *      the status flip (the Convex row stays as the authoritative
 *      record; the student will hit `accepted` on next signup attempt
 *      which the system refuses anyway via the existing
 *      `updateStudentInvitationStatus` admin-gate).
 *   4. Patch the Convex row's status to `cancelled` via the gated
 *      `updateStudentInvitationStatus` mutation. If THIS fails, log
 *      and return 500 — the caller can retry; the row is unchanged.
 *
 * Idempotency: cancelling an already-cancelled row is a no-op (the
 * mutation preserves the existing status; the new value is the same
 * terminal status). Cancelling an `accepted` row is refused with 409 —
 * the student already signed up, revoking would orphan their account.
 */
async function bestEffortRevoke(invitationId: string): Promise<void> {
  try {
    const client = await clerkClient();
    await client.invitations.revokeInvitation(invitationId);
  } catch (err) {
    reportError({
      source: "/api/admin/students/invitations/[id]/cancel",
      error: err,
      context: {
        stage: "best_effort_revoke",
        clerkInvitationId: invitationId,
      },
    });
  }
}

export async function POST(
  _req: NextRequest,
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
    if (row.status === "accepted") {
      return NextResponse.json(
        {
          error: `Cannot cancel invitation from terminal status 'accepted'`,
        },
        { status: 409 }
      );
    }
    if (row.status === "cancelled") {
      // Idempotent — nothing to do.
      return NextResponse.json({
        invitationId,
        previousClerkInvitationId: row.clerkInvitationId,
        previousStatus: row.status,
        newStatus: "cancelled",
      });
    }

    // Step A: revoke the Clerk invitation FIRST so even if the Convex
    // patch fails, the recipient loses the live signup link.
    if (row.clerkInvitationId) {
      await bestEffortRevoke(row.clerkInvitationId);
    }

    // Step B: flip the Convex row to `cancelled` via the gated mutation.
    // The mutation is the audit-logging seam — it writes a row to
    // `auditLogs` with the actor's userId / role.
    await convex.mutation(api.studentInvitations.updateStudentInvitationStatus, {
      id: invitationId,
      status: "cancelled",
    });

    return NextResponse.json({
      invitationId,
      previousClerkInvitationId: row.clerkInvitationId ?? null,
      previousStatus: row.status,
      newStatus: "cancelled",
    });
  } catch (err) {
    if (isUnauthorizedError(err)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isForbiddenError(err)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("Forbidden") || message.includes("Forbidden: admin or support role required")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    reportError({
      source: "/api/admin/students/invitations/[id]/cancel",
      error: err,
    });
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
