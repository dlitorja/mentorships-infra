import { NextRequest, NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { getConvexClient } from "@/lib/convex";
import { isUnauthorizedError, isForbiddenError } from "@/lib/errors";
import { requireRoleForApi } from "@/lib/auth-helpers";
import { protectWithRateLimit } from "@/lib/ratelimit";

/** Fetch all mentors with their associated user emails */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const rateLimitResponse = await protectWithRateLimit(request, { policy: "default" });
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  try {
    await requireRoleForApi("admin");

    const convex = getConvexClient();
    type MentorResult = {
      id: string;
      userId: string | null;
      email: string | null;
      maxActiveStudents: number | null;
      oneOnOneInventory: number | null;
      groupInventory: number | null;
      createdAt: number | null;
    };
    const result = await convex.query((api as any).admin.getAllMentors, {}) as MentorResult[];

    const formattedMentors = result
      .filter((mentor) => mentor.userId !== null && mentor.email !== null)
      .map((mentor) => ({
        id: mentor.id,
        userId: mentor.userId!,
        email: mentor.email!,
        maxActiveStudents: mentor.maxActiveStudents ?? 0,
        oneOnOneInventory: mentor.oneOnOneInventory ?? 0,
        groupInventory: mentor.groupInventory ?? 0,
        createdAt: mentor.createdAt ? new Date(mentor.createdAt).toISOString() : null,
      }));

    return NextResponse.json({ items: formattedMentors });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Forbidden: Admin role required" }, { status: 403 });
    }

    console.error("Error listing instructors:", error);
    return NextResponse.json(
      { error: "Failed to list instructors" },
      { status: 500 }
    );
  }
}
