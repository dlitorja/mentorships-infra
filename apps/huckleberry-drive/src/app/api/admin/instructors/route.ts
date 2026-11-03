import { NextResponse } from "next/server";
import { requireAdmin, UnauthorizedError, ForbiddenError } from "@/lib/auth";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import type { InstructorOption } from "@/lib/api";

export async function GET(): Promise<NextResponse> {
  try {
    await requireAdmin();

    // Only list instructors the assignment mutation will accept: active
    // user, active `instructors` profile, and role still "instructor".
    // `getAllInstructors` includes role-only legacy users without a
    // profile, which produced "Target instructor not found" when an
    // admin picked one from the assignment dropdown.
    const instructors = await fetchQuery(
      api.users.getActiveUsersByRole,
      { role: "instructor" },
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