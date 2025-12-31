import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { UnauthorizedError, ForbiddenError } from "@mentorships/db";

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
export async function hasRole(role: "student" | "mentor" | "admin") {
  const { userId } = await auth();
  if (!userId) return false;

  const { getDbUser } = await import("./auth");
  const user = await getDbUser();
  
  return user.role === role;
}

/**
 * Require a specific role - redirects if user doesn't have it
 * Use this for role-based access control in Server Components
 * 
 * ⚠️ WARNING: This function redirects, which doesn't work in API routes.
 * For API routes, use requireRoleForApi() instead.
 */
export async function requireRole(role: "student" | "mentor" | "admin") {
  const userId = await requireAuthRedirect();
  
  const { getDbUser } = await import("./auth");
  const user = await getDbUser();
  
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
export async function requireRoleForApi(role: "student" | "mentor" | "admin") {
  const { auth } = await import("@clerk/nextjs/server");
  const { userId } = await auth();
  
  if (!userId) {
    throw new UnauthorizedError("Authentication required");
  }
  
  const { getDbUser } = await import("./auth");
  const user = await getDbUser();
  
  if (user.role !== role) {
    throw new ForbiddenError("Admin access required");
  }
  
  return user;
}
