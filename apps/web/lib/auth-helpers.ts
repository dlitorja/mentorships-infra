import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { UnauthorizedError, ForbiddenError } from "./errors";

/**
 * Get a Convex-compatible JWT for the current Clerk session, or null
 * if the user is not signed in. Mirrors the helper in
 * `apps/platform/lib/auth-helpers.ts` so REST routes in both apps can
 * call it directly without re-importing Clerk.
 */
export async function getConvexAuthToken(): Promise<string | null> {
  const clerkAuth = await auth();
  if (!clerkAuth.userId) {
    return null;
  }
  return clerkAuth.getToken({ template: "convex" });
}

/**
 * Redirect to sign-in if user is not authenticated
 * Use this in Server Components that require authentication
 */
export async function requireAuthRedirect() {
  const { userId } = await auth();
  
  if (!userId) {
    redirect("/sign-in");
  }
  
  return userId;
}

/**
 * Check if user has a specific role
 * Returns true if user has the role, false otherwise
 */
export async function hasRole(role: "student" | "instructor" | "admin") {
  const { userId } = await auth();
  if (!userId) return false;

  const { requireDbUser } = await import("./auth");
  const user = await requireDbUser();
  
  return user.role === role;
}

/**
 * Require a specific role - redirects if user doesn't have it
 * Use this for role-based access control in Server Components
 * 
 * ⚠️ WARNING: This function redirects, which doesn't work in API routes.
 * For API routes, use requireRoleForApi() instead.
 */
export async function requireRole(role: "student" | "instructor" | "admin") {
  const userId = await requireAuthRedirect();
  
  const { requireDbUser } = await import("./auth");
  const user = await requireDbUser();
  
  if (user.role !== role) {
    redirect("/dashboard?error=insufficient_permissions");
  }
  
  return user;
}

/**
 * Require a specific role for API routes - throws error instead of redirecting
 * Use this in API route handlers that need role-based access control
 * 
 * @param role - Required role
 * @throws UnauthorizedError if not authenticated
 * @throws ForbiddenError if role check fails
 */
export async function requireRoleForApi(role: "student" | "instructor" | "admin") {
  const { auth } = await import("@clerk/nextjs/server");
  const { userId } = await auth();
  
  if (!userId) {
    throw new UnauthorizedError("Authentication required");
  }
  
  const { requireDbUser } = await import("./auth");
  const user = await requireDbUser();
  
  if (user.role !== role) {
    throw new ForbiddenError(`${role.charAt(0).toUpperCase() + role.slice(1)} access required`);
  }
  
  return user;
}
