import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { requireAdmin, UnauthorizedError, ForbiddenError } from "@/lib/auth";
import { fetchMutation, fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { createHdClerkInvitation, revokeClerkInvitation } from "@/lib/clerk-invitations";

export async function POST(request: NextRequest): Promise<NextResponse> {
  let newClerkInvitationId: string | undefined = undefined;

  try {
    await requireAdmin();
    const { getToken } = await auth();
    const convexToken = await getToken({ template: "convex" }) ?? undefined;

    const body = await request.json();
    const { invitationId, expiresInDays } = body;

    if (!invitationId) {
      return NextResponse.json(
        { error: "Invitation ID is required" },
        { status: 400 }
      );
    }

    const invitation = await fetchQuery(api.hdInvitations.getHdInvitation, {
      invitationId,
    }, { token: convexToken });

    if (!invitation) {
      return NextResponse.json(
        { error: "Invitation not found" },
        { status: 404 }
      );
    }

    if (invitation.status !== "pending") {
      return NextResponse.json(
        { error: "Can only resend pending invitations" },
        { status: 400 }
      );
    }

    if (invitation.clerkInvitationId) {
      const revokeResult = await revokeClerkInvitation(invitation.clerkInvitationId);

      if (!revokeResult.success) {
        if (revokeResult.reason === "already_consumed" || revokeResult.reason === "not_found" || revokeResult.reason === "not_revocable") {
          console.log(
            `Existing Clerk invitation ${invitation.clerkInvitationId} ${revokeResult.reason}, proceeding with resend`
          );
        } else {
          return NextResponse.json(
            { error: revokeResult.message },
            { status: 502 }
          );
        }
      }
    }

    const clerkResult = await createHdClerkInvitation({
      emailAddress: invitation.email,
      role: invitation.role,
    });

    if (!clerkResult.success) {
      return NextResponse.json({
        success: false,
        error: clerkResult.error,
      }, { status: 502 });
    }

    newClerkInvitationId = clerkResult.invitationId;

    try {
      const result = await fetchMutation(api.hdInvitations.resendHdInvitation, {
        invitationId,
        clerkInvitationId: newClerkInvitationId,
        expiresInDays: expiresInDays ?? 7,
      }, { token: convexToken });

      return NextResponse.json({
        success: true,
        newExpiresAt: result.newExpiresAt,
      });
    } catch (error) {
      if (newClerkInvitationId) {
        const revoked = await revokeClerkInvitation(newClerkInvitationId);
        if (revoked.success !== true) {
          console.error(`CRITICAL: New Clerk invitation ${newClerkInvitationId} was created but Convex update failed and rollback failed. Manual cleanup required. Revoke result: ${revoked.reason} - ${revoked.message}`);
        }
      }
      throw error;
    }
  } catch (error) {
    console.error("Resend invitation error:", error);

    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }

    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}