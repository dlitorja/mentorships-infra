import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { convexServerCall, ConvexServerCallError } from "@/lib/convex-server-call";
import { isAdminUser, resolveUserRole } from "@/lib/auth";

/**
 * GET /api/auth/sync
 *
 * Promotes the signed-in Clerk user into the Convex `users.role` table.
 * Runs server-side so we can use the trusted `CONVEX_HTTP_KEY` path
 * (the client-side `api.users.syncUser` mutation intentionally refuses
 * to elevate non-admin callers — see `convex/users.ts:syncUser`).
 *
 * Strategy:
 *   1. Verify the caller is signed in via Clerk (server-side auth()).
 *   2. Read the role from Clerk (claims fast path → Backend API fallback
 *      via `resolveUserRole`).
 *   3. POST to the trusted Convex HTTP action `/users/set-role`, which
 *      authenticates the bearer against `CONVEX_HTTP_KEY` and calls
 *      `internal.users.setUserRoleTrusted`. This is the only path that
 *      can elevate a user to `admin`.
 *
 * Why server-side and not client-side:
 *   - The client `syncUser` mutation runs as the *user* identity and
 *     refuses to set `role` to anything more privileged than what the
 *     caller already is. Without this route, first-time admin sign-in
 *     leaves Convex `users.role` empty, which fails
 *     `convex/admin.ts:isAdminUser` and gates `/admin`.
 *   - apps/platform avoids this with a Clerk webhook → Inngest →
 *     `setUserRoleTrusted` chain. apps/marketing has no webhook, so
 *     this route is the equivalent for marketing.
 *
 * Security:
 *   - Returns 401 if the caller isn't signed in.
 *   - We only *forward* the Clerk role; if Clerk says "admin", the
 *     trusted endpoint will set the Convex role to admin. The trusted
 *     endpoint is the source of truth on the Convex side; we never
 *     pick a role on behalf of Clerk here.
 *   - Bearer value (`CONVEX_HTTP_KEY`) is never logged.
 */
export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Resolve the user's role from Clerk (claims → Backend API fallback).
    // Use the full resolver so we get the same answer the admin layout
    // would gate on, not just the JWT claim.
    const role = await resolveUserRole();
    if (!role) {
      // Signed-in but Clerk doesn't have a known role on this account.
      // Don't elevate; mirror the deny in `convex/users.ts:syncUser`.
      return NextResponse.json(
        {
          success: true,
          action: "noop",
          reason: "Clerk has no role on this account; nothing to sync",
          user: { id: userId, role: null },
        },
        { status: 200 }
      );
    }

    const result = await convexServerCall<{
      ok: boolean;
      userId?: string;
      role?: string;
      audit?: { actorId: string };
    }>("/users/set-role", { userId, role });

    if (!result.ok) {
      return NextResponse.json(
        { error: "Convex refused to set role" },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      user: {
        id: userId,
        role: result.role ?? role,
        clerkIsAdmin: await isAdminUser(),
      },
    });
  } catch (error) {
    if (error instanceof ConvexServerCallError) {
      console.error(`[marketing/auth/sync] Convex HTTP error: ${error.message}`);
      return NextResponse.json(
        { error: "Failed to reach Convex" },
        { status: error.status }
      );
    }
    console.error("[marketing/auth/sync] unexpected error", error);
    return NextResponse.json(
      { error: "Failed to sync user" },
      { status: 500 }
    );
  }
}
