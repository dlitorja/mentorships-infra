import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { fetchAction } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { isForbiddenError, isUnauthorizedError } from "@/lib/errors";

export const runtime = "nodejs";

/**
 * POST /api/admin/convex/set-clerk-id
 * Server-verified update of the clerkId field for multi-Clerk-app support.
 * This allows setting the clerkId (for apps like huckleberry-drive) without
 * changing the userId field that apps/platform depends on.
 * 
 * Requires Clerk admin via requireRoleForApi("admin") and HMAC using CONVEX_SERVER_SHARED_SECRET.
 */
export async function POST(request: Request) {
  try {
    const { requireRoleForApi } = await import("@/lib/auth-helpers");
    await requireRoleForApi("admin");

    const clerkAuth = await auth();
    const token = await clerkAuth.getToken({ template: "convex" });
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const secret = process.env.CONVEX_SERVER_SHARED_SECRET;
    if (!secret) {
      return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
    }

    const userId = clerkAuth.userId;
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Get the clerkId to set from request body
    const body = await request.json();
    const { clerkId } = body;
    if (!clerkId) {
      return NextResponse.json({ error: "clerkId is required" }, { status: 400 });
    }

    const ts = Date.now();
    const msg = `${userId}:clerkId:${clerkId}:${ts}`;
    const { createHmac } = await import("node:crypto");
    const sig = createHmac("sha256", secret).update(msg).digest("hex");

    const updated = await fetchAction(
      api.users_actions.serverVerifiedSetUserClerkId,
      { userId, clerkId, ts, sig },
      { token, url: process.env.NEXT_PUBLIC_CONVEX_URL }
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