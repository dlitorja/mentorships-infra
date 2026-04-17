import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  db,
  menteeInvitations,
  instructors,
  eq,
  and,
  gt,
  desc,
  sql,
  isUnauthorizedError,
  isForbiddenError,
} from "@mentorships/db";
import { createClerkInvitation } from "@/lib/clerk-invitations";

const INVITATION_EXPIRY_DAYS = 7;

const createInvitationSchema = z.object({
  email: z.string().email("Invalid email address"),
  instructorId: z.string().uuid("Invalid instructor ID"),
});

const listInvitationsQuerySchema = z.object({
  status: z.enum(["pending", "accepted", "expired", "cancelled", "all"]).optional(),
  instructorId: z.string().uuid().optional(),
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
    const offset = (page - 1) * pageSize;

    const conditions = [];

    if (status && status !== "all") {
      conditions.push(eq(menteeInvitations.status, status));
    }

    if (instructorId) {
      conditions.push(eq(menteeInvitations.instructorId, instructorId));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [invitations, countResult] = await Promise.all([
      db
        .select({
          id: menteeInvitations.id,
          email: menteeInvitations.email,
          instructorId: menteeInvitations.instructorId,
          clerkInvitationId: menteeInvitations.clerkInvitationId,
          expiresAt: menteeInvitations.expiresAt,
          status: menteeInvitations.status,
          createdAt: menteeInvitations.createdAt,
          instructorName: instructors.name,
          instructorSlug: instructors.slug,
        })
        .from(menteeInvitations)
        .leftJoin(
          instructors,
          eq(menteeInvitations.instructorId, instructors.id)
        )
        .where(whereClause)
        .orderBy(desc(menteeInvitations.createdAt))
        .limit(pageSize)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)` })
        .from(menteeInvitations)
        .where(whereClause),
    ]);

    return NextResponse.json({
      items: invitations.map((inv) => ({
        id: inv.id,
        email: inv.email,
        instructorId: inv.instructorId,
        instructorName: inv.instructorName,
        instructorSlug: inv.instructorSlug,
        clerkInvitationId: inv.clerkInvitationId,
        expiresAt: inv.expiresAt.toISOString(),
        status: inv.status,
        createdAt: inv.createdAt.toISOString(),
      })),
      total: countResult[0]?.count || 0,
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

    // Verify instructor exists
    const instructor = await db
      .select({
        id: instructors.id,
        name: instructors.name,
        mentorId: instructors.mentorId,
      })
      .from(instructors)
      .where(eq(instructors.id, instructorId))
      .limit(1);

    if (instructor.length === 0) {
      return NextResponse.json(
        { error: "Instructor not found" },
        { status: 404 }
      );
    }

    // Check for existing pending invitation
    const existingPending = await db
      .select()
      .from(menteeInvitations)
      .where(
        and(
          eq(menteeInvitations.email, normalizedEmail),
          eq(menteeInvitations.instructorId, instructorId),
          eq(menteeInvitations.status, "pending"),
          gt(menteeInvitations.expiresAt, new Date())
        )
      )
      .limit(1);

    if (existingPending.length > 0) {
      return NextResponse.json(
        { error: "A pending invitation already exists for this email and instructor" },
        { status: 400 }
      );
    }

    // Create Clerk invitation
    const invitationResult = await createClerkInvitation({
      emailAddress: normalizedEmail,
      redirectUrl: `${process.env.NEXT_PUBLIC_APP_URL || "https://huckleberry.art"}/dashboard`,
    });

    if (!invitationResult.success) {
      return NextResponse.json(
        { error: invitationResult.error || "Failed to create Clerk invitation" },
        { status: 400 }
      );
    }

    // Calculate expiration
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + INVITATION_EXPIRY_DAYS);

    // Store invitation in database
    const [storedInvitation] = await db
      .insert(menteeInvitations)
      .values({
        email: normalizedEmail,
        instructorId: instructorId,
        clerkInvitationId: invitationResult.invitationId,
        expiresAt,
        status: "pending",
      })
      .returning();

    return NextResponse.json({
      success: true,
      invitation: {
        id: storedInvitation.id,
        email: storedInvitation.email,
        instructorId: storedInvitation.instructorId,
        instructorName: instructor[0].name,
        clerkInvitationId: storedInvitation.clerkInvitationId,
        expiresAt: storedInvitation.expiresAt.toISOString(),
        status: storedInvitation.status,
        createdAt: storedInvitation.createdAt.toISOString(),
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
