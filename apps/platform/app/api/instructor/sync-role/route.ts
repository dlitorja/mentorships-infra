import { NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { isUnauthorizedError } from "@/lib/errors";
import { getAuthenticatedConvexClient } from "@/lib/convex";
import { convexServerCall } from "@/lib/convex-server-call";

/**
 * POST /api/instructor/sync-role
 * Ensures the current user exists in Convex with role "instructor".
 * Idempotent and safe to call on first post-invite sign-in.
 */
export async function POST() {
  try {
    const { userId, sessionClaims } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Guard: allow role sync only for users explicitly invited as instructors
    // Fast path via session claims; fallback to Clerk API if missing
    const claimsMeta = (sessionClaims?.publicMetadata || {}) as Record<string, unknown>;
    let isInstructorFlag = Boolean(claimsMeta.isInstructor);
    let roleClaim = typeof claimsMeta.role === "string" ? (claimsMeta.role as string) : undefined;

    if (!isInstructorFlag && !roleClaim) {
      try {
        const client = await clerkClient();
        const user = await client.users.getUser(userId);
        const pm = (user.publicMetadata || {}) as Record<string, unknown>;
        isInstructorFlag = Boolean(pm.isInstructor);
        roleClaim = typeof pm.role === "string" ? (pm.role as string) : undefined;
      } catch {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    if (!isInstructorFlag && roleClaim !== "instructor") {
      return NextResponse.json({ error: "Forbidden: Instructor invite required" }, { status: 403 });
    }

    const convex = await getAuthenticatedConvexClient();

    let existingInstructor = await convex.query(api.instructors.getInstructorByUserId, { userId });
    if (!existingInstructor) {
      const client = await clerkClient();
      const clerkUser = await client.users.getUser(userId);
      const email = clerkUser.emailAddresses[0]?.emailAddress;
      const name = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") || undefined;
      const result = await convexServerCall<{ success: boolean; reason?: string }>(
        "/instructors/create-for-clerk-user",
        { userId, email, name }
      );
      if (!result.success) {
        console.error("sync-role: failed to create instructor:", result.reason);
        return NextResponse.json({ error: "Failed to create instructor profile" }, { status: 500 });
      }
      existingInstructor = await convex.query(api.instructors.getInstructorByUserId, { userId });
    }

    // Idempotent: syncUser sets role; if already set, no change
    await convex.mutation(api.users.syncUser, { role: "instructor" });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("sync-role error:", error);
    return NextResponse.json({ error: "Failed to sync role" }, { status: 500 });
  }
}
