import { NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { auth } from "@clerk/nextjs/server";

function getConvexClient() {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
  return new ConvexHttpClient(convexUrl);
}

/**
 * POST /api/instructor/sync-role
 * Ensures the current user exists in Convex with role "instructor".
 * Idempotent and safe to call on first post-invite sign-in.
 */
export async function POST() {
  try {
    const clerkAuth = await auth();
    const token = await clerkAuth.getToken({ template: "convex" });
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const convex = getConvexClient();
    convex.setAuth(token);

    await convex.mutation(api.users.syncUser, { role: "instructor" });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("sync-role error:", error);
    return NextResponse.json({ error: "Failed to sync role" }, { status: 500 });
  }
}
