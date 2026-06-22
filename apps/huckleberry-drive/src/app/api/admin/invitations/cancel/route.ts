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

    if (invitation.clerkInvitationId) {
      const clerkRevoked = await revokeClerkInvitation(invitation.clerkInvitationId);
      if (!clerkRevoked) {
        return NextResponse.json(
          { error: "Failed to revoke Clerk invitation. Please try again." },
          { status: 502 }
        );
      }
    }

    await fetchMutation(api.hdInvitations.updateHdInvitationStatus, {
      invitationId,
      status: "cancelled",
    });

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