import { NextResponse } from "next/server";
import { requireAdmin, UnauthorizedError, ForbiddenError } from "@/lib/auth";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";

interface User {
  _id: string;
  userId: string;
  role: string;
}

interface AdminStats {
  totalInstructors: number;
  totalFiles: number;
  totalBytes: number;
  activeFiles: number;
  activeBytes: number;
}

export async function GET(): Promise<NextResponse> {
  try {
    await requireAdmin() as User;

    const stats = await fetchQuery(api.users.getAdminStats, {}) as AdminStats;

    return NextResponse.json(stats);
  } catch (error) {
    console.error("Admin stats error:", error);

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