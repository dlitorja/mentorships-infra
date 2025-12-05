import { auth, currentUser } from "@clerk/nextjs/server";
import { getOrCreateUser } from "@mentorships/db";

/**
 * Get the current authenticated user's Clerk ID
 * Returns null if not authenticated
 */
export async function getUserId() {
  const { userId } = await auth();
  return userId;
}

/**
 * Get the current authenticated Clerk user object
 * Returns null if not authenticated
 */
export async function getUser() {
  return await currentUser();
}

/**
 * Require authentication - throws error if user is not authenticated
 * Use this in API routes and server components that require auth
 */
export async function requireAuth() {
  const userId = await getUserId();
  if (!userId) {
    throw new Error("Unauthorized: Authentication required");
  }
  return userId;
}

/**
 * Get or create user in Supabase database
 * This syncs Clerk user data to our database
 * 
 * Use this when you need the user record from the database
 * (e.g., checking user role, accessing user-specific data)
 */
export async function getDbUser() {
  return await getOrCreateUser();
}

/**
 * Require authentication and return database user
 * Throws error if not authenticated
 */
export async function requireDbUser() {
  await requireAuth();
  return await getDbUser();
}

