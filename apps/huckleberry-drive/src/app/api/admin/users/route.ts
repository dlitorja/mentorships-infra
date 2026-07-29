import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { requireAdmin, UnauthorizedError, ForbiddenError } from "@/lib/auth";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";

const DEFAULT_USERS_PAGE_SIZE = 100;

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    await requireAdmin();
    const { getToken } = await auth();
    const convexToken = await getToken({ template: "convex" }) ?? undefined;

    const searchParams = request.nextUrl.searchParams;
    const activeCursor = searchParams.get("activeCursor") ?? null;
    const deletedCursor = searchParams.get("deletedCursor") ?? null;

    const [activeUsers, deletedUsers] = await Promise.all([
      fetchQuery(
        api.users.listActiveUsers,
        {
          paginationOpts: {
            cursor: activeCursor,
            numItems: DEFAULT_USERS_PAGE_SIZE,
          },
        },
        { token: convexToken }
      ),
      fetchQuery(
        api.users.listDeletedUsers,
        {
          paginationOpts: {
            cursor: deletedCursor,
            numItems: DEFAULT_USERS_PAGE_SIZE,
          },
        },
        { token: convexToken }
      ),
    ]);

    return NextResponse.json({
      active: activeUsers.page,
      deleted: deletedUsers.page,
      activeContinueCursor: activeUsers.continueCursor,
      deletedContinueCursor: deletedUsers.continueCursor,
      activeIsDone: activeUsers.isDone,
      deletedIsDone: deletedUsers.isDone,
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
      console.error("Internal error details:", error.name, error.message);
      return NextResponse.json({ error: "An internal error occurred" }, { status: 500 });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}