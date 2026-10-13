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
 * Flow (PR-B / Issue 3, after round-1 Greptile fixes):
 *
 *   1. Verify the caller is admin or support (`requireAdminOrSupportForApi`).
 *   2. Read the row via the admin-gated query
 *      `convex/studentInvitations.getStudentInvitationById`. Refuse early
 *      if missing or already in a terminal status (`accepted`, `cancelled`).
 *   3. Best-effort revoke the PREVIOUS Clerk invitation FIRST so Clerk
 *      will accept the new one (`ignoreExisting: true` does the right
 *      thing in code but `revoke-existing` is the safer path — without it
 *      we leak the prior invitation if a later step fails).
 *   4. Mint a FRESH Clerk invitation with `ignoreExisting: true`
 *      (matches the onboarding-resend `/v1/invitations` semantics).
 *   5. Convex mutation `studentInvitations.resendStudentInvitation` patches
 *      the row's `clerkInvitationId`, `expiresAt`, and resets `status` to
 *      `pending`. The mutation writes an `auditLogs` entry itself; we
 *      don't need a second write here.
 *   6. If the Convex mutation THROWS, revoke the NEW Clerk invitation so
 *      we don't strand the student with a live link that no Convex row
 *      points to. The previous Clerk invitation remains revoked; the
 *      student sees nothing. (Cancelled status would have been cleaner
 *      but the row mutation gates the resend flow.)
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
 *
 * Greptile round-1 fixes addressed:
 *   - P1 #4264777483: prior Clerk invitation is revoked BEFORE minting
 *     the new one, so `ignoreExisting: true` succeeds. Without this the
 *     route 502'd on every resend because Clerk returned "already invited".
 *   - P1 #4264777489: if the Convex mutation throws, the NEW Clerk
 *     invitation is revoked so we don't strand the student with a live
 *     link that no Convex row points to.
 */
const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Strict Clerk revoke (pre-mint step). Treats "already not active"
 * errors (404, already-revoked, not-found, 422) as success so we can
 * proceed to mint a replacement. Re-throws anything else — aborts the
 * resend rather than minting then orphaning the previous link.
 *
 * Greptile round-3 P1 (resend/route.ts:168): if the previous link
 * couldn't be revoked and we still minted with ignoreExisting:true,
 * the prior emailed link stays live. A later Cancel would only revoke
 * the new stored ID, leaving admin-issued invitations usable.
 */
async function strictRevokeOrThrow(clerkInvitationId: string): Promise<true> {
  try {
    const client = await clerkClient();
    await client.invitations.revokeInvitation(clerkInvitationId);
    return true;
  } catch (err) {
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
    if (isAlreadyNotActive) return true;
    throw err;
  }
}

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

    // Step 1: revoke the previous Clerk invitation FIRST so the new
    // mint isn't rejected with "already invited". STRICT — if the previous
    // Clerk invitation can't be revoked (other than "already
    // inactive"), abort the resend. Greptile round-3 P1: otherwise the
    // prior link stays live and a later Cancel only revokes the new
    // minted one, leaving the old link usable for sign-up.
    const previousClerkInvitationId = row.clerkInvitationId;
    if (previousClerkInvitationId) {
      await strictRevokeOrThrow(previousClerkInvitationId);
    }

    // Step 2: mint a fresh Clerk invitation. `ignoreExisting: true`
    // is double-protection — if a duplicate invite somehow slipped
    // past step 1, Clerk will still create the replacement.
    const clerkResult = await createStudentClerkInvitation({
      emailAddress: row.email,
      ignoreExisting: true,
    });
    if (!clerkResult.success || !clerkResult.invitationId) {
      return NextResponse.json(
        {
          error: clerkResult.error ?? "Failed to mint Clerk invitation",
        },
        { status: 502 }
      );
    }

    const newExpiresAt = Date.now() + INVITATION_TTL_MS;

    // Step 3: patch the row via the admin-gated Resend mutation. The
    // mutation's gate is a second line of defense — if service-side
    // gating fails (e.g. someone bypasses this route), Convex still
    // refuses.
    //
    // Greptile round-1 P1: if this throws AFTER the Clerk mint
    // succeeded, revoke the new Clerk invitation so we don't strand
    // the student with a live link that no Convex row points to.
    // `strictRevokeOrThrow` is used here too — if the rescue revoke
    // also fails (network / Clerk outage), the route surfaces the
    // underlying mutation error rather than swallowing it.
    //
    // Greptile round-2 P1: pass `expectedStatus = row.status` (the
    // status we observed on initial read) so a parallel cancel that
    // flipped the row between read and patch refuses. On refusal we
    // revoke the freshly-minted Clerk invite so we don't leak.
    let patch;
    try {
      patch = await convex.mutation(
        api.studentInvitations.resendStudentInvitation,
        {
          invitationId,
          newClerkInvitationId: clerkResult.invitationId,
          expiresAt: newExpiresAt,
          expectedStatus: row.status,
        }
      );
    } catch (saveErr) {
      // Precondition mismatch (race lost) or any Convex write failure
      // — either way the new Clerk invite is orphaned. Revoke it
      // strictly; if revoke itself fails we'll surface upstream.
      try {
        await strictRevokeOrThrow(clerkResult.invitationId);
      } catch (revokeErr) {
        reportError({
          source: "/api/admin/students/invitations/[id]/resend",
          error: revokeErr,
          context: {
            stage: "rescue_revoke_after_save_failure",
            clerkInvitationId: clerkResult.invitationId,
          },
        });
      }
      throw saveErr;
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
    if (message.includes("Precondition mismatch:")) {
      return NextResponse.json(
        { error: "Concurrent update detected; please retry." },
        { status: 409 }
      );
    }

    reportError({
      source: "/api/admin/students/invitations/[id]/resend",
      error: err,
    });
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
