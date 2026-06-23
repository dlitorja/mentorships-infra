import { NextResponse } from "next/server";
import { requireAdmin, UnauthorizedError, ForbiddenError } from "@/lib/auth";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";

export async function GET(): Promise<NextResponse> {
  try {
    const adminUser = await requireAdmin();

    const [activeUsers, deletedUsers] = await Promise.all([
      fetchQuery(api.users.listActiveUsers, {}),
      fetchQuery(api.users.listDeletedUsers, {}),
    ]);

    return NextResponse.json({
      active: activeUsers,
      deleted: deletedUsers,
    });
  } catch (error) {
    console.error("Users list error:", error);
    console.error("Error name:", error?.constructor?.name);
    console.error("Error message:", error instanceof Error ? error.message : String(error));

    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }

    if (error instanceof Error) {
      return NextResponse.json({ error: error.message, name: error.name }, { status: 500 });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}