import { NextRequest, NextResponse } from "next/server";
import { db, mentors, users, eq, isUnauthorizedError, isForbiddenError } from "@mentorships/db";
import { requireRoleForApi } from "@/lib/auth-helpers";
import { protectWithRateLimit } from "@/lib/ratelimit";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const rateLimitResponse = await protectWithRateLimit(request, { policy: "default" });
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  try {
    await requireRoleForApi("admin");

    const allMentors: { mentor: typeof mentors.$inferSelect; email: string | null }[] = await db
      .select({
        mentor: mentors,
        email: users.email,
      })
      .from(mentors)
      .leftJoin(users, eq(mentors.userId, users.id))
      .orderBy(mentors.createdAt);

    const formattedMentors = allMentors.map(({ mentor, email }) => ({
      id: mentor.id,
      userId: mentor.userId,
      email: email ?? null,
      maxActiveStudents: mentor.maxActiveStudents,
      oneOnOneInventory: mentor.oneOnOneInventory,
      groupInventory: mentor.groupInventory,
      createdAt: mentor.createdAt ? mentor.createdAt.toISOString() : null,
    }));

    return NextResponse.json({ items: formattedMentors });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Forbidden: Admin role required" }, { status: 403 });
    }

    console.error("Error listing mentors:", error);
    return NextResponse.json(
      { error: "Failed to list mentors" },
      { status: 500 }
    );
  }
}
