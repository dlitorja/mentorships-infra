import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { isForbiddenError, isUnauthorizedError } from "@/lib/errors";
import { convexServerCall } from "@/lib/convex-server-call";

export const runtime = "nodejs";

/**
 * POST /api/admin/convex/seed-role
 * Server-verified bootstrap of the current caller into Convex with role=admin.
 *
 * Strict precondition: the caller must have NO existing Convex `users`
 * row (looked up by either `by_userId` or `by_clerkId`). This route exists
 * ONLY for the first-time bootstrap of a brand-new Clerk admin (set up
 * via the Clerk dashboard) — a brand-new admin has
 * `publicMetadata.role === "admin"` in their Clerk JWT but no Convex row
 * yet, so the normal Convex authoritative admin gate would chicken-and-egg
 * the elevation.
 *
 * Why we can't just trust the Clerk JWT alone: a demoted admin (whose
 * Convex `users.role` was changed to "student" by another admin) still has
 * `publicMetadata.role === "admin"` in their Clerk JWT until the
 * dashboard sync updates. Without the "no existing row" check, that
 * demoted admin could call this route to re-elevate themselves.
 *
 * Greptile P1 #2 (PR #904): the precondition + role write happens in a
 * SINGLE Convex transaction (`internal.users.bootstrapAdminRoleOnce`,
 * exposed via `POST /users/bootstrap-admin-role`). The previous shape
 * used three separate HTTP calls (precondition read → `syncUser` →
 * `/users/set-role`), which had a race window: another admin could
 * write a non-admin role between the precondition check and the role
 * write, and the bootstrap would silently overwrite it.
 *
 * Authentication on the Convex side is CONVEX_HTTP_KEY bearer.
 */
export async function POST() {
  try {
    const { requireRoleForApi } = await import("@/lib/auth-helpers");
    await requireRoleForApi("admin", { skipConvexAdminCheck: true });

    const clerkAuth = await auth();
    const userId = clerkAuth.userId;
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const updated = await convexServerCall<{ _id: string; role: string }>(
      "/users/bootstrap-admin-role",
      { userId, actorId: userId }
    );

    return NextResponse.json({ success: true, user: { id: updated._id, role: updated.role } });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Forbidden: Admin role required" }, { status: 403 });
    }
    if (error instanceof Error) {
      const msg = error.message || "";
      if (msg.startsWith("Refusing bootstrap")) {
        return NextResponse.json({ error: msg }, { status: 409 });
      }
      const lower = msg.toLowerCase();
      if (lower.includes("unauthorized")) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      if (lower.includes("forbidden")) {
        return NextResponse.json({ error: "Forbidden: Admin role required" }, { status: 403 });
      }
    }
    console.error("seed-role error:", error);
    return NextResponse.json({ error: "Failed to seed role" }, { status: 500 });
  }
}
