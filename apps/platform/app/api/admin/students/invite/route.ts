import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import { getConvexClient } from "@/lib/convex";
import { requireRoleForApi } from "@/lib/auth-helpers";
import { isUnauthorizedError, isForbiddenError } from "@/lib/errors";
import { auth } from "@clerk/nextjs/server";
import { createStudentClerkInvitation } from "@/lib/clerk-invitations";

const inviteSchema = z.object({
  email: z.string().email("Invalid email address"),
  instructorId: z.string(),
});

/**
 * GET /api/admin/students/invite
 * Returns paginated list of student invitations.
 */
export async function GET(req: NextRequest) {
  try {
    await requireRoleForApi("admin");

    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status") || "pending";

    const convex = getConvexClient();
    const clerkAuth = await auth();
    const token = await clerkAuth.getToken({ template: "convex" });
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    convex.setAuth(token);

    const result = await convex.query(api.studentInvitations.listStudentInvitations, {
      status: status === "all" ? "all" : status as "pending" | "accepted" | "expired" | "cancelled",
      limit: 50,
    }) as any;

    return NextResponse.json({
      items: result.items.map((item: any) => ({
        ...item,
        expiresAt: new Date(item.expiresAt).toISOString(),
        createdAt: new Date(item.createdAt).toISOString(),
      })),
      total: result.total,
      page: 1,
      pageSize: 50,
    });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Forbidden: Admin role required" }, { status: 403 });
    }
    console.error("Error listing invitations:", error);
    return NextResponse.json({ error: "Failed to list invitations" }, { status: 500 });
  }
}

/**
 * POST /api/admin/students/invite
 * Creates a new student invitation for an instructor.
 * Body: { email: string, instructorId: string }
 */
export async function POST(req: NextRequest) {
  try {
    await requireRoleForApi("admin");

    const body = await req.json();
    const parsed = inviteSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.issues },
        { status: 400 }
      );
    }

    const { email, instructorId } = parsed.data;

    const convex = getConvexClient();
    const clerkAuth = await auth();
    const token = await clerkAuth.getToken({ template: "convex" });
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    convex.setAuth(token);

    // Set expiration to 7 days from now
    const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;

    const invitationId = await convex.mutation(
      api.studentInvitations.createStudentInvitation,
      {
        email,
        instructorId: instructorId as any,
        expiresAt,
      }
    );

    // Create Clerk invitation to send email to prospective student
    const clerkResult = await createStudentClerkInvitation({
      emailAddress: email,
      redirectUrl: `${process.env.NEXT_PUBLIC_APP_URL || "https://dev.mentorships.huckleberry.art"}/sign-up`,
    });

    // Update the invitation record with the Clerk invitation ID if successful
    if (clerkResult.success && clerkResult.invitationId) {
      await convex.mutation(api.studentInvitations.updateStudentInvitationClerkId, {
        invitationId,
        clerkInvitationId: clerkResult.invitationId,
      });
    }

    // Return 201 only when invitation email was sent successfully
    // If Clerk failed, return 502 to indicate gateway failure
    if (!clerkResult.success) {
      return NextResponse.json({
        success: false,
        invitationId,
        invitationSent: false,
        invitationError: clerkResult.error,
      }, { status: 502 });
    }

    return NextResponse.json({
      success: true,
      invitationId,
      invitationSent: true,
    }, { status: 201 });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Forbidden: Admin role required" }, { status: 403 });
    }

    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    if (errorMessage.includes("already exists")) {
      return NextResponse.json({ error: errorMessage }, { status: 409 });
    }

    console.error("Error creating invitation:", error);
    return NextResponse.json({ error: "Failed to create invitation" }, { status: 500 });
  }
}
