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
 * PR-B (Issue 3) round-1 Greptile fix (P1 #4264777494). The original
 * `PendingInvitationsCard` Cancel invoked
 * `studentInvitations.updateStudentInvitationStatus` directly from
 * React via `useConvexMutation`, which only flipped the Convex status
 * — the Clerk invitation stayed active and the recipient could still
 * complete sign-up. Status flips from the client cannot revoke Clerk;
 * only a Node route handler can.
 *
 * PR-B round-2 Greptile fixes (review c0cc97c0):
 *
 *   P1 (bestEffortRevoke swallowed errors): the revoker is now strict.
 *   If Clerk rejects the revoke (network error, rate limit, 5xx) for
 *   any reason other than "already revoked" / "not found", the route
 *   returns 502 and does NOT patch the row to `cancelled`. The Convex
 *   row keeps its previous status, the admin retries, and once the
 *   revoke succeeds the row flips to `cancelled`. Idempotency is
 *   preserved because Clerk's revoke-already-revoked returns a
 *   recognised shape ("already revoked" / 404) that we treat as success.
 *
 *   P1 (overlapping actions leave links active): the
 *   `updateStudentInvitationStatus` mutation now accepts an optional
 *   `expectedStatus` precondition (see `convex/studentInvitations.ts:200+`).
 *   We pass `expectedStatus = row.status` (the value we just read). If
 *   a parallel resend flipped the row's status between our read and
 *   the patch, the precondition refuses; the route re-reads and either
 *   surfaces 409 or maps to a retry path. Without this the prior
 *   version would patch to `cancelled` and leave any newly-minted Clerk
 *   link live (the cancel revoked only the OLD id we read).
 *
 * Flow:
 *   1. Verify the caller is admin or support.
 *   2. Read the row via the admin-gated query
 *      `convex/studentInvitations.getStudentInvitationById`. 404 if
 *      missing.
 *   3. If `row.status === "accepted"` → 409 (cannot orphan a real
 *      account).
 *   4. If `row.status === "cancelled"` → idempotent 200 (already done).
 *   5. STRICTLY revoke the Clerk invitation. Errors that mean
 *      "already-not-active" (already revoked / not found / 404 / 422)
 *      are treated as success (so a previously-canceled-but-status-
 *      not-yet-flipped retry still completes); other errors propagate.
 *      If the revoke throws, return 502 without patching the row.
 *   6. Patch the Convex row's status to `cancelled` via the gated
 *      mutation WITH the `expectedStatus = row.status` precondition.
 *      If the precondition fails (race), we re-read; if status is now
 *      `accepted` or `cancelled`, we treat as 409 and skip the patch.
 *      If status is otherwise surprising, surface 500 (operator review).
 */

/**
 * Strict Clerk revoke. Returns `true` if the invitation is revoked
 * (or was already not active — Clerk returned 404 / 422 / "already
 * revoked"). Re-throws for any other error so the caller can fail the
 * route without patch the Convex row.
 */
async function strictRevokeOrThrow(clerkInvitationId: string): Promise<true> {
  try {
    const client = await clerkClient();
    await client.invitations.revokeInvitation(clerkInvitationId);
    return true;
  } catch (err) {
    // Clerk's `ClerkAPIResponseError` exposes `.status` (HTTP code) and
    // `.errors[]` (per-field metadata). Both are best-effort checks
    // because shape varies between SDK versions.
    const status = (err as { status?: number })?.status ?? null;
    const message = err instanceof Error ? err.message : String(err);
    const lowered = message.toLowerCase();
    const isAlreadyNotActive =
      status === 404 ||
      status === 422 ||
      lowered.includes("already revoked") ||
      lowered.includes("not found") ||
      lowered.includes("does not exist") ||
      lowered.includes("already accepted") ||
      lowered.includes("already used");
    if (isAlreadyNotActive) {
      // The invitation is no longer a viable signup link — treat as
      // success so we can proceed to patch the row.
      return true;
    }
    // Anything else (network, rate limit, 5xx, malformed response) is
    // a real failure. Surface to the caller; do NOT patch the row.
    throw err;
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
      // Idempotent — nothing to do. We deliberately don't retry the
      // revoke here because (1) the prior row-level status flip ALREADY
      // happened on a previous request and (2) we have no signal that
      // the original revoke failed; the dashed-row is a best effort,
      // and re-revoking an already-revoked Clerk invitation would 422.
      return NextResponse.json({
        invitationId,
        previousClerkInvitationId: row.clerkInvitationId,
        previousStatus: row.status,
        newStatus: "cancelled",
        alreadyCancelled: true,
      });
    }

    // Step A: strictly revoke the Clerk invitation. Any non-
    // already-revoked error propagates so we don't patch the row to
    // `cancelled` while a live signup link still exists.
    if (row.clerkInvitationId) {
      await strictRevokeOrThrow(row.clerkInvitationId);
    }

    // Step B: flip the Convex row to `cancelled` via the gated mutation
    // WITH the precondition. The mutation writes the audit log entry.
    try {
      await convex.mutation(api.studentInvitations.updateStudentInvitationStatus, {
        id: invitationId,
        status: "cancelled",
        expectedStatus: row.status,
      });
    } catch (mutateErr) {
      // Race lost — a parallel mutation flipped the row between our
      // read and our patch. Re-read: if the row is now `cancelled`,
      // treat as success (because Step A already revoked Clerk); if
      // it's `accepted`, return 409 (we'd orphan a real account); for
      // any other status, return 500 — operator review.
      const fresh = await convex.query(api.studentInvitations.getStudentInvitationById, {
        id: invitationId,
      });
      if (fresh?.status === "cancelled") {
        return NextResponse.json({
          invitationId,
          previousClerkInvitationId: row.clerkInvitationId ?? null,
          previousStatus: row.status,
          newStatus: "cancelled",
          alreadyCancelled: true,
        });
      }
      if (fresh?.status === "accepted") {
        return NextResponse.json(
          {
            error:
              "Cannot cancel invitation: a parallel signup completed before the status flip could commit.",
          },
          { status: 409 }
        );
      }
      // Unknown race outcome — surface upstream; the revoke already
      // happened so the live link is dead regardless.
      throw mutateErr;
    }

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
    if (message.includes("Precondition mismatch:")) {
      // Should not surface — caught above with the re-read. If we
      // reach here, surface as 409 so the UI knows the action did
      // not commit.
      return NextResponse.json(
        { error: "Concurrent update detected; please retry." },
        { status: 409 }
      );
    }

    // If we got here from `strictRevokeOrThrow`, the row is unchanged.
    // Treat Clerk 4xx/5xx-style errors as 502 to distinguish them from
    // generic 500s.
    if (
      /already revoked/i.test(message) === false &&
      /clerk/i.test(message) ||
      /status code/i.test(message) ||
      /network/i.test(message)
    ) {
      reportError({
        source: "/api/admin/students/invitations/[id]/cancel",
        error: err,
        context: { stage: "revoke_clerk_invitation_failed" },
      });
      return NextResponse.json(
        {
          error: `Clerk revoke failed: ${message}`,
        },
        { status: 502 }
      );
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
