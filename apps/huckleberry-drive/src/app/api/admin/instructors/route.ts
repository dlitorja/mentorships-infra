import { NextResponse } from "next/server";
import { requireAdmin, UnauthorizedError, ForbiddenError } from "@/lib/auth";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";

interface User {
  _id: string;
  userId: string;
  role: string;
}

interface InstructorWithName {
  userId: string;
  name: string;
  email: string;
}

interface InstructorResponse {
  id: string;
  name: string | null;
  email: string;
}

export async function GET(): Promise<NextResponse> {
  try {
    await requireAdmin() as User;

    const instructors = await fetchQuery(api.users.getAllInstructors, {}) as InstructorWithName[];

    const formatted: InstructorResponse[] = instructors.map((i) => ({
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
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}