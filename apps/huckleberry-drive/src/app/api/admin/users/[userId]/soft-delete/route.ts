import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { requireAdmin, UnauthorizedError, ForbiddenError } from "@/lib/auth";
import { fetchMutation, fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { revokeClerkInvitation } from "@/lib/clerk-invitations";

interface Params {
  params: Promise<{ userId: string }>;
}

export async function POST(
  _request: NextRequest,
  { params }: Params
): Promise<NextResponse> {
  try {
    const { userId } = await params;
    await requireAdmin();
    const { getToken } = await auth();
    const convexToken = await getToken({ template: "convex" }) ?? undefined;

    const userWithFiles = await fetchQuery(api.users.getUserWithFiles, { userId }, { token: convexToken });

    if (!userWithFiles) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const pendingInvitations = await fetchQuery(
      api.hdInvitations.getPendingInvitationsByEmail,
      { email: userWithFiles.user.email },
      { token: convexToken }
    );

    await fetchMutation(api.users.softDeleteUser, { userId }, { token: convexToken });

    const clerkErrors: string[] = [];
    for (const inv of pendingInvitations) {
      if (inv.clerkInvitationId) {
        const result = await revokeClerkInvitation(inv.clerkInvitationId);
        if (!result.success) {
          clerkErrors.push(`Invitation ${inv.clerkInvitationId}: ${result.message}`);
        }
      }
    }

    return NextResponse.json({
      success: true,
      userId,
      filesCount: userWithFiles.files.total,
      activeFilesCount: userWithFiles.files.active,
      clerkRevocationErrors: clerkErrors.length > 0 ? clerkErrors : undefined,
    });
  } catch (error) {
    console.error("Soft delete user error:", error);

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