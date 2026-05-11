import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import { ConvexHttpClient } from "convex/browser";
import { isUnauthorizedError, isForbiddenError } from "@/lib/errors";
import { createClerkInvitation } from "@/lib/clerk-invitations";

function getConvexClient() {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
  }
  return new ConvexHttpClient(convexUrl);
}

const INVITATION_EXPIRY_DAYS = 7;

const createInvitationSchema = z.object({
  email: z.string().email("Invalid email address"),
  instructorId: z.string(),
});

const listInvitationsQuerySchema = z.object({
  status: z.enum(["pending", "accepted", "expired", "cancelled", "all"]).optional(),
  instructorId: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

/**
 * GET /api/admin/mentees/invite
 * List mentee invitations
 */
export async function GET(req: NextRequest) {
  try {
    const { requireRoleForApi } = await import("@/lib/auth-helpers");
    await requireRoleForApi("admin");

    const parsedQuery = listInvitationsQuerySchema.safeParse(
      Object.fromEntries(new URL(req.url).searchParams)
    );

    if (!parsedQuery.success) {
      return NextResponse.json(
        { error: "Invalid query", details: parsedQuery.error.issues },
        { status: 400 }
      );
    }

    const { status, instructorId, page, pageSize } = parsedQuery.data;
    const convex = getConvexClient();

    const result = await convex.query(api.menteeInvitations.listMenteeInvitations, {
      status: status === "all" ? undefined : status,
      instructorId: instructorId as any || undefined,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });

    return NextResponse.json({
      items: result.items.map((inv: any) => ({
        id: inv.id,
        email: inv.email,
        instructorId: inv.instructorId,
        instructorName: inv.instructorName,
        instructorSlug: inv.instructorSlug,
        clerkInvitationId: inv.clerkInvitationId,
        expiresAt: new Date(inv.expiresAt).toISOString(),
        status: inv.status,
        createdAt: new Date(inv.createdAt).toISOString(),
      })),
      total: result.total,
      page,
      pageSize,
    });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Forbidden: Admin role required" }, { status: 403 });
    }

    console.error("Error listing mentee invitations:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to list invitations" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/mentees/invite
 * Create a new mentee invitation
 */
export async function POST(req: NextRequest) {
  try {
    const { requireRoleForApi } = await import("@/lib/auth-helpers");
    await requireRoleForApi("admin");

    const body = await req.json();
    const validationResult = createInvitationSchema.safeParse(body);

    if (!validationResult.success) {
      return NextResponse.json(
        { error: "Invalid request", details: validationResult.error.issues },
        { status: 400 }
      );
    }

    const { email, instructorId } = validationResult.data;
    const normalizedEmail = email.toLowerCase();
    const convex = getConvexClient();

    const instructor = await convex.query(api.instructors.getInstructorById, { id: instructorId as any });
    if (!instructor) {
      return NextResponse.json(
        { error: "Instructor not found" },
        { status: 404 }
      );
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL 
      || (process.env.NEXT_PUBLIC_VERCEL_URL ? `https://${process.env.NEXT_PUBLIC_VERCEL_URL}` : null)
      || "https://huckleberry.art";
    
    const invitationResult = await createClerkInvitation({
      emailAddress: normalizedEmail,
      instructorId,
      redirectUrl: `${baseUrl}/dashboard`,
    });

    if (!invitationResult.success) {
      return NextResponse.json(
        { error: invitationResult.error || "Failed to create Clerk invitation" },
        { status: 400 }
      );
    }

    const expiresAt = Date.now() + (INVITATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    let invitationId: string;
    try {
      invitationId = await convex.mutation(api.menteeInvitations.createMenteeInvitation, {
        email: normalizedEmail,
        instructorId: instructorId as any,
        clerkInvitationId: invitationResult.invitationId,
        expiresAt,
        status: "pending",
      });
    } catch (err: any) {
      if (err.message === "A pending invitation already exists for this email and instructor") {
        return NextResponse.json(
          { error: "A pending invitation already exists for this email and instructor" },
          { status: 400 }
        );
      }
      throw err;
    }

    return NextResponse.json({
      success: true,
      invitation: {
        id: invitationId,
        email: normalizedEmail,
        instructorId,
        instructorName: instructor.name,
        clerkInvitationId: invitationResult.invitationId,
        expiresAt: new Date(expiresAt).toISOString(),
        status: "pending",
        createdAt: new Date().toISOString(),
      },
    }, { status: 201 });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Forbidden: Admin role required" }, { status: 403 });
    }

    console.error("Error creating mentee invitation:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create invitation" },
      { status: 500 }
    );
  }
}