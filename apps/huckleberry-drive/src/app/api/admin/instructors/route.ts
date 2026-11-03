import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { requireAdmin, UnauthorizedError, ForbiddenError } from "@/lib/auth";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import type { InstructorOption } from "@/lib/api";

/**
 * GET /api/admin/instructors
 *
 * Default: every user with role "instructor" (used for display names on
 * files that may point at a legacy profile-less instructor).
 *
 * `?assignable=true`: only instructors the assignment mutation accepts —
 * active user, active `instructors` profile, and role still
 * "instructor". Use this for assignment dropdowns; passing an invalid
 * legacy target otherwise fails with "Target instructor not found".
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    await requireAdmin();
    const { getToken } = await auth();
    const token = await getToken({ template: "convex" }) ?? undefined;

    const assignable =
      new URL(request.url).searchParams.get("assignable") === "true";

    if (assignable) {
      // `getActiveUsersByRole` requires an authenticated Convex identity;
      // without the token it returns an empty list.
      const instructors = await fetchQuery(
        api.users.getActiveUsersByRole,
        { role: "instructor" },
        { token }
      ) as Array<{
        userId: string;
        firstName?: string | null;
        lastName?: string | null;
        email?: string | null;
      }>;

      const formatted: InstructorOption[] = instructors.map((i) => ({
        id: i.userId,
        name:
          [i.firstName, i.lastName].filter(Boolean).join(" ") ||
          i.email ||
          null,
        email: i.email || "",
      }));

      return NextResponse.json({ instructors: formatted });
    }

    const instructors = await fetchQuery(
      api.users.getAllInstructors,
      {},
      { token }
    ) as {
      userId: string;
      name: string;
      email: string;
    }[];

    const formatted: InstructorOption[] = instructors.map((i) => ({
      id: i.userId,
      name: i.name || null,
      email: i.email,
    }));

    return NextResponse.json({ instructors: formatted });
  } catch (error) {
    console.error("Admin instructors error:", error);

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
