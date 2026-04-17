import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  db,
  sessionPacks,
  users,
  instructors,
  mentors,
  eq,
  and,
  ilike,
  or,
  desc,
  sql,
  isNull,
  gt,
  isUnauthorizedError,
  isForbiddenError,
} from "@mentorships/db";

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
      const searchPattern = `%${search.toLowerCase()}%`;
      conditions.push(
        or(
          ilike(users.email, searchPattern),
          ilike(users.id, searchPattern)
        )
      );
    }

    if (instructorId) {
      conditions.push(eq(sessionPacks.mentorId, instructorId));
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

    return NextResponse.json({
      items: mentees.map((m) => ({
        id: m.id,
        userId: m.userId,
        email: m.email || "Unknown",
        mentorId: m.mentorId,
        instructorName: m.instructorName || "Unknown",
        instructorSlug: m.instructorSlug,
        totalSessions: Number(m.totalSessions),
        remainingSessions: Number(m.remainingSessions),
        status: m.status,
        expiresAt: m.expiresAt?.toISOString() || null,
        purchasedAt: m.purchasedAt.toISOString(),
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

    console.error("Error listing mentees:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to list mentees" },
      { status: 500 }
    );
  }
}
