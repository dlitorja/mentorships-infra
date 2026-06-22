import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, UnauthorizedError, ForbiddenError } from "@/lib/auth";
import { fetchMutation } from "convex/nextjs";
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

    const result = await fetchMutation(api.hdInvitations.cancelHdInvitation, {
      invitationId,
    }) as { invitationId: string; clerkInvitationId: string | null };

    let clerkRevoked = true;
    if (result.clerkInvitationId) {
      clerkRevoked = await revokeClerkInvitation(result.clerkInvitationId);
    }

    return NextResponse.json({
      success: true,
      clerkInvitationRevoked: clerkRevoked,
      warning: clerkRevoked ? undefined : "Clerk invitation revocation failed - the invitation link may still be active",
    });
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