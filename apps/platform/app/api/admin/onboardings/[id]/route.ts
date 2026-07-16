import { NextRequest, NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { getConvexClient } from "@/lib/convex";
import { requireAdminOrSupportForApi } from "@/lib/auth-helpers";
import { isUnauthorizedError, isForbiddenError } from "@/lib/errors";
import { auth } from "@clerk/nextjs/server";

/**
 * GET /api/admin/onboardings/[id]
 *
 * Returns the current `adminOnboardings` row for the detail page's
 * v1 status polling loop. The Convex hook `useAdminOnboarding` is the
 * preferred read path; this REST endpoint exists so future clients
 * (CLI / dashboard variants / polling on the recovery list page) can
 * also read the row without a Convex client.
 *
 * Returns:
 *   - 200 + row JSON when found.
 *   - 404 when missing or caller is not admin/support.
 *   - 401 / 403 on auth errors.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdminOrSupportForApi();

    const convex = getConvexClient();
    const clerkAuth = await auth();
    const token = await clerkAuth.getToken({ template: "convex" });
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    convex.setAuth(token);

    const { id } = await params;
    const row = await convex.query(api.adminOnboarding.getAdminOnboarding, {
      id: id as any,
    });

    if (!row) {
      return NextResponse.json({ error: "Onboarding not found" }, { status: 404 });
    }

    return NextResponse.json(row);
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Forbidden: admin or support role required" }, { status: 403 });
    }
    console.error("Error fetching admin onboarding:", error);
    return NextResponse.json({ error: "Failed to fetch admin onboarding" }, { status: 500 });
  }
}
