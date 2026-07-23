import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { requireAdmin, UnauthorizedError, ForbiddenError } from "@/lib/auth";
import { fetchMutation, fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { createHdClerkInvitation, revokeClerkInvitation } from "@/lib/clerk-invitations";

export async function POST(request: NextRequest): Promise<NextResponse> {
  let newClerkInvitationId: string | undefined = undefined;

  try {
    await requireAdmin();
    const { getToken } = await auth();
    const convexToken = await getToken({ template: "convex" }) ?? undefined;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON payload" },
        { status: 400 }
      );
    }

    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "Invalid JSON payload" },
        { status: 400 }
      );
    }

    const { invitationId, expiresInDays } = body as { invitationId?: unknown; expiresInDays?: unknown };

    if (!invitationId || typeof invitationId !== "string") {
      return NextResponse.json(
        { error: "Invitation ID is required" },
        { status: 400 }
      );
    }

    const validInvitationId = invitationId as Id<"hdInvitations">;

    if (expiresInDays !== undefined && expiresInDays !== null) {
      if (typeof expiresInDays !== "number" || !Number.isInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > 30) {
        return NextResponse.json(
          { error: "expiresInDays must be an integer between 1 and 30" },
          { status: 400 }
        );
      }
    }

    const invitation = await fetchQuery(api.hdInvitations.getHdInvitation, {
      invitationId: validInvitationId,
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

    if (invitation.role === "student") {
      return NextResponse.json(
        { error: "Cannot resend a student invitation; the student role is no longer supported" },
        { status: 400 }
      );
    }

    const clerkResult = await createHdClerkInvitation({
      emailAddress: invitation.email,
      role: invitation.role,
      expiresInDays: expiresInDays ?? 7,
      ignoreExisting: true,
    });

    if (!clerkResult.success) {
      console.error("Failed to create Clerk invitation:", clerkResult.error);
      const status = clerkResult.status === 409 ? 409 : 502;
      return NextResponse.json({
        success: false,
        error: clerkResult.error,
      }, { status });
    }

    newClerkInvitationId = clerkResult.invitationId;

    try {
      const result = await fetchMutation(api.hdInvitations.resendHdInvitation, {
        invitationId: validInvitationId,
        clerkInvitationId: newClerkInvitationId,
        expiresInDays: expiresInDays ?? 7,
      }, { token: convexToken });

      if (result.previousClerkInvitationId) {
        const revokeResult = await revokeClerkInvitation(result.previousClerkInvitationId);
        if (!revokeResult.success && revokeResult.reason !== "already_consumed" && revokeResult.reason !== "not_found" && revokeResult.reason !== "not_revocable") {
          console.error(`Failed to revoke old Clerk invitation ${result.previousClerkInvitationId}: ${revokeResult.message}`);
        }
      }

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

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
