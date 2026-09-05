import { NextResponse } from "next/server";
import { getAuthenticatedConvexClient } from "@/lib/convex";
import { isUnauthorizedError, isForbiddenError } from "@/lib/errors";
import { createClerkInvitation } from "@/lib/clerk-invitations";
import { resolveInstructorByIdOrSlug } from "@/lib/admin/instructors";

/**
 * POST /api/admin/instructors/[id]/invite
 * Sends a Clerk invitation to the instructor's email so they can create a
 * Clerk user account and gain access to their workspace.
 *
 * Prerequisites (enforced below):
 * - Instructor must have an `email` set on the profile (saved via PUT first).
 * - Instructor must not already have a connected `userId`.
 *
 * Linking happens automatically via the Clerk webhook once the user accepts.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { requireRoleForApi } = await import("@/lib/auth-helpers");
    await requireRoleForApi("admin");

    const { id } = await params;
    const convex = await getAuthenticatedConvexClient();

    const resolved = await resolveInstructorByIdOrSlug(convex, id);
    const existing = resolved.instructor as
      | { _id: string; email?: string | null; userId?: string | null }
      | null;
    const resolvedId = resolved.resolvedId;

    if (!existing || !resolvedId) {
      return NextResponse.json({ error: "Instructor not found" }, { status: 404 });
    }

    const email = (existing.email || "").trim().toLowerCase();
    if (!email) {
      return NextResponse.json(
        { error: "Instructor has no email on file. Save an email in the profile first." },
        { status: 400 }
      );
    }

    if (existing.userId) {
      return NextResponse.json(
        { error: "Instructor is already connected to a Clerk user." },
        { status: 409 }
      );
    }

    const result = await createClerkInvitation({
      emailAddress: email,
      instructorId: resolvedId,
    });

    if (!result.success) {
      const status = result.error?.toLowerCase().includes("already exists") ? 409 : 502;
      return NextResponse.json(
        { error: result.error || "Failed to send Clerk invitation" },
        { status }
      );
    }

    return NextResponse.json(
      {
        success: true,
        message: "Invitation sent",
        invitationId: result.invitationId,
        email,
      },
      { status: 200 }
    );
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Forbidden: Admin role required" }, { status: 403 });
    }
    console.error("[admin:sendInstructorInvite] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to send invitation" },
      { status: 500 }
    );
  }
}
