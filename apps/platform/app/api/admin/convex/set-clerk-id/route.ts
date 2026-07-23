import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { isForbiddenError, isUnauthorizedError } from "@/lib/errors";
import { convexServerCall } from "@/lib/convex-server-call";

export const runtime = "nodejs";

/**
 * POST /api/admin/convex/set-clerk-id
 * Server-verified update of the clerkId field for multi-Clerk-app support.
 * This allows setting the clerkId (for apps like huckleberry-drive) without
 * changing the userId field that apps/platform depends on.
 *
 * Requires Clerk admin via requireRoleForApi("admin"). Authenticates
 * the server-to-Convex call with the CONVEX_HTTP_KEY bearer (R14).
 */
export async function POST(request: Request) {
  try {
    const { requireRoleForApi } = await import("@/lib/auth-helpers");
    await requireRoleForApi("admin");

    const clerkAuth = await auth();
    const token = await clerkAuth.getToken({ template: "convex" });
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const userId = clerkAuth.userId;
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json();
    const { clerkId } = body;
    if (!clerkId) {
      return NextResponse.json({ error: "clerkId is required" }, { status: 400 });
    }

    const updated = await convexServerCall<{ _id: string; clerkId: string }>(
      "/users/set-clerk-id",
      { userId, clerkId }
    );

    return NextResponse.json({ success: true, user: { id: updated._id, clerkId: updated.clerkId } });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Forbidden: Admin role required" }, { status: 403 });
    }
    if (error instanceof Error) {
      const msg = (error.message || "").toLowerCase();
      if (msg.includes("unauthorized")) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      if (msg.includes("forbidden")) {
        return NextResponse.json({ error: "Forbidden: Admin role required" }, { status: 403 });
      }
    }
    console.error("set-clerk-id error:", error);
    return NextResponse.json({ error: "Failed to set clerkId" }, { status: 500 });
  }
}
