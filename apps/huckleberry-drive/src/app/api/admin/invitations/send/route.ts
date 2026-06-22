import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, UnauthorizedError, ForbiddenError } from "@/lib/auth";
import { fetchMutation } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { createHdClerkInvitation, revokeClerkInvitation } from "@/lib/clerk-invitations";

export async function POST(request: NextRequest): Promise<NextResponse> {
  let clerkInvitationId: string | undefined = undefined;

  try {
    await requireAdmin();

    const body = await request.json();
    const { email, role, expiresInDays } = body;

    if (!email || !role) {
      return NextResponse.json(
        { error: "Email and role are required" },
        { status: 400 }
      );
    }

    const validRoles = ["student", "instructor", "admin", "video_editor"];
    if (!validRoles.includes(role)) {
      return NextResponse.json(
        { error: "Invalid role" },
        { status: 400 }
      );
    }

    const clerkResult = await createHdClerkInvitation({
      emailAddress: email,
      role,
    });

    if (!clerkResult.success) {
      return NextResponse.json({
        success: false,
        invitationSent: false,
        invitationError: clerkResult.error,
      }, { status: 502 });
    }

    clerkInvitationId = clerkResult.invitationId;

    const invitationId = await fetchMutation(api.hdInvitations.createHdInvitation, {
      email,
      role,
      expiresInDays: expiresInDays ?? 7,
      clerkInvitationId,
    });

    return NextResponse.json({
      success: true,
      invitationId,
      invitationSent: true,
    }, { status: 201 });
  } catch (error) {
    console.error("Create invitation error:", error);

    if (clerkInvitationId) {
      const revoked = await revokeClerkInvitation(clerkInvitationId);
      if (!revoked) {
        console.error(`CRITICAL: Clerk invitation ${clerkInvitationId} was sent but Convex insert failed and rollback failed. Manual cleanup required in Clerk dashboard.`);
      }
    }

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