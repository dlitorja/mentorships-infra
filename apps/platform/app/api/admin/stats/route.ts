import { NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { getAuthenticatedConvexClient } from "@/lib/convex";
import { isUnauthorizedError, isForbiddenError } from "@/lib/errors";

/**
 * GET /api/admin/stats
 *
 * Admin dashboard statistics: active students plus month/last-month/YTD revenue.
 *
 * This route used to return hard-coded zeros under a placeholder comment, while
 * the client expected `totalActiveStudents` / `hasStudentData` (it received
 * `totalActiveMentees` / `hasMenteeData`), so the dashboard permanently read
 * "No students yet" and $0.00 regardless of business state. `admin.getStats`
 * already returns exactly the shape `AdminStats` in `api-client.ts` expects.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const { requireRoleForApi } = await import("@/lib/auth-helpers");
    await requireRoleForApi("admin");

    const convex = await getAuthenticatedConvexClient();
    const stats = await convex.query(api.admin.getStats, {});

    return NextResponse.json(stats);
  } catch (error) {
    console.error("Error fetching admin stats:", error);
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Forbidden: Admin role required" }, { status: 403 });
    }
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
