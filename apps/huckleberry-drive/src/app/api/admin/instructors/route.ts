import { NextResponse } from "next/server";
import { requireAdmin, UnauthorizedError, ForbiddenError } from "@/lib/auth";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import type { InstructorOption } from "@/lib/api";

export async function GET(): Promise<NextResponse> {
  try {
    await requireAdmin();

    const instructors = await fetchQuery(api.users.getAllInstructors, {}) as {
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