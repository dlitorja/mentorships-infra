import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

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
 * Use this for role-based access control
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

