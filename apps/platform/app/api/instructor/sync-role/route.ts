import { NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { isUnauthorizedError } from "@/lib/errors";
import { getAuthenticatedConvexClient } from "@/lib/convex";
import { convexServerCall } from "@/lib/convex-server-call";
import { setInstructorPublicMetadataOnUser } from "@/lib/clerk-invitations";

/**
 * POST /api/instructor/sync-role
 * Ensures the current user exists in Convex with role "instructor"
 * AND has `publicMetadata.role = "instructor"` on their Clerk user.
 * Idempotent and safe to call on first post-invite sign-in.
 *
 * Self-heal path (Greptile P1 #1, first pass): if Clerk metadata
 * lacks the instructor flag but a Convex `instructors` row exists for
 * this user (admin "create instructor" adopted an existing Clerk
 * user by email), we accept the request AND stamp the missing Clerk
 * role flag so the next sign-in routes correctly. Without this
 * branch, the route refuses — leaving the user unable to self-recover
 * from the missing metadata bootstrap.
 *
 * Demotion gate (Greptile P1 #2, second pass): an explicit
 * `roleClaim === "student"` on Clerk — set by an admin downgrading a
 * user back to student — is treated as authoritative. The self-heal
 * path is bypassed so the demoted user stays a student even if a
 * stale Convex `instructors` row still exists. Without this check,
 * the demoted user would be silently re-upped to instructor on every
 * sign-in.
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
        // Fall through — the Convex fallback below will gate for us.
      }
    }

    const convex = await getAuthenticatedConvexClient();

    // Greptile P1 #1 (self-heal path): if Clerk metadata doesn't already
    // assert "instructor", accept the request when an active, non-deleted
    // Convex `instructors` row exists for this user. The admin "create
    // instructor" flow can adopt an existing Clerk user by email without
    // stamping publicMetadata — those users would otherwise be locked
    // out of this endpoint and unable to repair the bootstrap.
    //
    // Greptile P1 #2 (second pass, demotion loophole): an explicit
    // `roleClaim === "student"` on Clerk (set by an admin downgrading the
    // user) must OVERRIDE the Convex-row self-heal branch. Otherwise an
    // instructor who was deliberately demoted would be silently re-upped
    // to instructor on every sign-in, defeating the demotion. Check the
    // demotion gate BEFORE the Convex-row fallback below.
    if (roleClaim === "student") {
      return NextResponse.json(
        { error: "Forbidden: Instructor invite required" },
        { status: 403 },
      );
    }

    let existingInstructor = await convex.query(api.instructors.getInstructorByUserId, { userId });
    const hasActiveConvexInstructor =
      !!existingInstructor &&
      existingInstructor.deletedAt == null &&
      existingInstructor.isActive !== false;

    if (!isInstructorFlag && roleClaim !== "instructor" && !hasActiveConvexInstructor) {
      return NextResponse.json({ error: "Forbidden: Instructor invite required" }, { status: 403 });
    }

    // Backfill the Clerk metadata so the next sign-in routes correctly.
    // Best-effort: a 32x failure here is logged but does not block the
    // Convex role sync, which is what the user-facing page actually
    // depends on for direct-navigation access (`lib/auth-helpers.ts`
    // DB fallback). Skipped entirely when the user is in the "student"
    // demotion gate (handled above) — we must not write instructor
    // metadata for a user an admin has explicitly demoted.
    if (!isInstructorFlag || roleClaim !== "instructor") {
      try {
        await setInstructorPublicMetadataOnUser({
          userId,
          instructorId: existingInstructor?._id as string | undefined,
        });
      } catch (e) {
        console.warn(
          "[platform:sync-role] failed to backfill Clerk publicMetadata:",
          e instanceof Error ? e.message : String(e),
        );
      }
    }

    if (!existingInstructor) {
      const client = await clerkClient();
      const clerkUser = await client.users.getUser(userId);
      const email = clerkUser.emailAddresses[0]?.emailAddress;
      const name = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") || undefined;
      // Greptile P1 (fifteenth pass, follow-up): this is the
      // JWT-driven self-heal path. The instructor claim here is
      // best-effort reconciliation of JWT-derived metadata, NOT
      // an explicit Clerk demotion proceed. Pass
      // enforceElevatedPreservation: true so an account whose
      // Convex users.role is admin / video_editor / support is
      // NOT silently demoted. The webhook-driven callers
      // (Inngest clerk-user-lifecycle, Clerk webhook handler)
      // omit this flag because their demotions are explicit.
      const result = await convexServerCall<{ success: boolean; reason?: string }>(
        "/instructors/create-for-clerk-user",
        { userId, email, name, enforceElevatedPreservation: true }
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
