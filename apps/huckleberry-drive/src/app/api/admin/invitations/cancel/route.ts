import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, UnauthorizedError, ForbiddenError } from "@/lib/auth";
import { fetchMutation, fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { revokeClerkInvitation } from "@/lib/clerk-invitations";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    await requireAdmin();

    const body = await request.json();
    const { invitationId } = body;

    if (!invitationId) {
      return NextResponse.json(
        { error: "Invitation ID is required" },
        { status: 400 }
      );
    }

    const invitation = await fetchQuery(api.hdInvitations.getHdInvitation, {
      invitationId,
    });

    if (!invitation) {
      return NextResponse.json(
        { error: "Invitation not found" },
        { status: 404 }
      );
    }

    if (invitation.status !== "pending") {
      return NextResponse.json(
        { error: "Can only cancel pending invitations" },
        { status: 400 }
      );
    }

    let clerkRevoked = false;

    if (invitation.clerkInvitationId) {
      const revokeResult = await revokeClerkInvitation(invitation.clerkInvitationId);

      if (!revokeResult.success) {
        if (revokeResult.reason === "already_consumed" || revokeResult.reason === "not_found") {
          console.log(
            `Clerk invitation ${invitation.clerkInvitationId} already consumed or not found, proceeding with cancellation`
          );
        } else {
          return NextResponse.json(
            { error: revokeResult.message },
            { status: 502 }
          );
        }
      } else {
        clerkRevoked = true;
      }
    }

    try {
      await fetchMutation(api.hdInvitations.updateHdInvitationStatus, {
        invitationId,
        status: "cancelled",
      });
    } catch (error) {
      if (clerkRevoked) {
        console.error(`CRITICAL: Clerk invitation ${invitation.clerkInvitationId} was revoked but Convex update failed. Manual cleanup may be required. Error: ${error instanceof Error ? error.message : String(error)}`);
      }
      throw error;
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Cancel invitation error:", error);

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