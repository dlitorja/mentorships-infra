import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { isForbiddenError, isUnauthorizedError } from "@/lib/errors";
import { getAuthenticatedConvexClient } from "@/lib/convex";
import { convexServerCall } from "@/lib/convex-server-call";

export const runtime = "nodejs";

/**
 * POST /api/admin/convex/seed-role
 * Server-verified bootstrap of the current caller into Convex with role=admin.
 *
 * Strict precondition: the caller must have NO existing Convex `users.role`
 * row. This route exists ONLY for the first-time bootstrap of a brand-new
 * Clerk admin (set up via the Clerk dashboard) — a brand-new admin has
 * `publicMetadata.role === "admin"` in their Clerk JWT but no Convex row
 * yet, so the normal Convex authoritative admin gate would chicken-and-egg
 * the elevation.
 *
 * Why we can't just trust the Clerk JWT alone: a demoted admin (whose
 * Convex `users.role` was changed to "student" by another admin) still has
 * `publicMetadata.role === "admin"` in their Clerk JWT until the
 * dashboard sync updates. Without the "no existing row" check, that
 * demoted admin could call this route to re-elevate themselves. The
 * "no existing row" precondition closes that hole: existing admins must
 * be re-elevated through the proper admin path (`updateUserRole`), and
 * brand-new admins legitimately fall into the bootstrap case.
 *
 * Authenticates the server-to-Convex call with the CONVEX_HTTP_KEY bearer
 * (the only path that can write `role: "admin"`).
 */
export async function POST() {
  try {
    const { requireRoleForApi } = await import("@/lib/auth-helpers");
    await requireRoleForApi("admin", { skipConvexAdminCheck: true });

    const clerkAuth = await auth();
    const userId = clerkAuth.userId;
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // "No existing Convex row" precondition. Run BEFORE any role write —
    // a 409 here is what stops a demoted admin from re-elevating through
    // this bootstrap path.
    const token = await clerkAuth.getToken({ template: "convex" });
    if (!token) {
      return NextResponse.json({ error: "Unable to mint Convex auth token" }, { status: 401 });
    }
    const existing = await fetchQuery(api.admin.getMyRole, {}, { token });
    if (existing.role !== null) {
      return NextResponse.json(
        {
          error:
            "Convex users.role already set for this account; bootstrap is only allowed for first-time admins. Contact an existing Convex admin to change your role through the admin tooling.",
        },
        { status: 409 },
      );
    }

    const convex = await getAuthenticatedConvexClient();

    await convex.mutation(api.users.syncUser, {});

    const updated = await convexServerCall<{ _id: string; role: string }>(
      "/users/set-role",
      { userId, role: "admin" }
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
      const msg = (error.message || "").toLowerCase();
      if (msg.includes("unauthorized")) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      if (msg.includes("forbidden")) {
        return NextResponse.json({ error: "Forbidden: Admin role required" }, { status: 403 });
      }
    }
    console.error("seed-role error:", error);
    return NextResponse.json({ error: "Failed to seed role" }, { status: 500 });
  }
}
