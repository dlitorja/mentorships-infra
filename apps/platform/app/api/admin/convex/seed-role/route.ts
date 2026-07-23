import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { isForbiddenError, isUnauthorizedError } from "@/lib/errors";
import { convexServerCall } from "@/lib/convex-server-call";

export const runtime = "nodejs";

function getConvexClient() {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
  return new ConvexHttpClient(convexUrl);
}

/**
 * POST /api/admin/convex/seed-role
 * Server-verified elevation of the current caller into Convex with role=admin.
 * Requires Clerk admin via requireRoleForApi("admin"). Authenticates
 * the server-to-Convex call with the CONVEX_HTTP_KEY bearer (R14).
 */
export async function POST() {
  try {
    const { requireRoleForApi } = await import("@/lib/auth-helpers");
    await requireRoleForApi("admin");

    const convex = getConvexClient();
    const clerkAuth = await auth();
    const token = await clerkAuth.getToken({ template: "convex" });
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    convex.setAuth(token);

    const userId = clerkAuth.userId;
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
