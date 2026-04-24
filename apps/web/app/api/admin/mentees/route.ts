import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { clerkClient } from "@clerk/nextjs/server";
import {
  db,
  sessionPacks,
  users,
  instructors,
  mentors,
  eq,
  and,
  or,
  ilike,
  desc,
  sql,
  isNull,
  gt,
  isUnauthorizedError,
  isForbiddenError,
} from "@mentorships/db";

interface ClerkUserName {
  firstName?: string | null;
  lastName?: string | null;
}

const listMenteesQuerySchema = z.object({
  search: z.string().trim().default(""),
  instructorId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

/**
 * GET /api/admin/mentees
 * List all mentees with their session packs and instructor info
 */
export async function GET(req: NextRequest) {
  try {
    const { requireRoleForApi } = await import("@/lib/auth-helpers");
    await requireRoleForApi("admin");

    const parsedQuery = listMenteesQuerySchema.safeParse(
      Object.fromEntries(new URL(req.url).searchParams)
    );

    if (!parsedQuery.success) {
      return NextResponse.json(
        { error: "Invalid query", details: parsedQuery.error.issues },
        { status: 400 }
      );
    }

    const { search, instructorId, page, pageSize } = parsedQuery.data;
    const offset = (page - 1) * pageSize;

    const conditions = [];

    if (search) {
      const searchPattern = `%${search.toLowerCase().replace(/%/g, "\\%").replace(/_/g, "\\_")}%`;
      conditions.push(
        or(
          ilike(users.email, searchPattern),
          ilike(users.id, searchPattern)
        )
      );
    }

    let resolvedMentorId: string | undefined;
    if (instructorId) {
      const instructor = await db
        .select({ mentorId: instructors.mentorId })
        .from(instructors)
        .where(eq(instructors.id, instructorId))
        .limit(1);
      
      if (instructor.length > 0 && instructor[0].mentorId) {
        resolvedMentorId = instructor[0].mentorId;
        conditions.push(eq(sessionPacks.mentorId, resolvedMentorId));
      }
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [mentees, countResult] = await Promise.all([
      db
        .select({
          id: sessionPacks.id,
          userId: sessionPacks.userId,
          email: users.email,
          mentorId: sessionPacks.mentorId,
          instructorName: instructors.name,
          instructorSlug: instructors.slug,
          totalSessions: sessionPacks.totalSessions,
          remainingSessions: sessionPacks.remainingSessions,
          status: sessionPacks.status,
          expiresAt: sessionPacks.expiresAt,
          purchasedAt: sessionPacks.purchasedAt,
        })
        .from(sessionPacks)
        .innerJoin(users, eq(sessionPacks.userId, users.id))
        .innerJoin(mentors, eq(sessionPacks.mentorId, mentors.id))
        .leftJoin(instructors, eq(mentors.id, instructors.mentorId))
        .where(whereClause)
        .orderBy(desc(sessionPacks.purchasedAt))
        .limit(pageSize)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)` })
        .from(sessionPacks)
        .innerJoin(users, eq(sessionPacks.userId, users.id))
        .where(whereClause),
    ]);

    // Batch-fetch Clerk user data for firstName/lastName
    const userIds = [...new Set(mentees.map((m) => m.userId))];
    let clerkUserMap = new Map<string, ClerkUserName>();

    if (userIds.length > 0) {
      try {
        const client = await clerkClient();
        const clerkResponse = await client.users.getUserList({ userId: userIds, limit: Math.min(userIds.length, 500) });
        clerkUserMap = new Map(clerkResponse.data.map((u) => [u.id, { firstName: u.firstName, lastName: u.lastName }]));
      } catch (error) {
        console.error("Failed to fetch Clerk user names for mentees:", error);
      }
    }

    return NextResponse.json({
      items: mentees.map((m) => {
        const clerkUser = clerkUserMap.get(m.userId);
        return {
          kind: "mentee" as const,
          id: m.id,
          userId: m.userId,
          email: m.email || "Unknown",
          firstName: clerkUser?.firstName ?? null,
          lastName: clerkUser?.lastName ?? null,
          mentorId: m.mentorId,
          instructorName: m.instructorName || "Unknown",
          instructorSlug: m.instructorSlug,
          totalSessions: Number(m.totalSessions),
          remainingSessions: Number(m.remainingSessions),
          status: m.status,
          expiresAt: m.expiresAt?.toISOString() || null,
          purchasedAt: m.purchasedAt.toISOString(),
        };
      }),
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

    console.error("Error listing mentees:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to list mentees" },
      { status: 500 }
    );
  }
}
