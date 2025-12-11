import { auth, currentUser } from "@clerk/nextjs/server";
import { db } from "./drizzle";
import { users } from "../schema";
import { eq } from "drizzle-orm";

/**
 * Gets the current Clerk user ID from the session
 * 
 * @returns Clerk user ID or null if not authenticated
 */
export async function getClerkUserId(): Promise<string | null> {
  const { userId } = await auth();
  return userId;
}

/**
 * Gets the current Clerk user object
 * 
 * @returns Clerk user object or null if not authenticated
 */
export async function getClerkUser() {
  return await currentUser();
}

/**
 * Ensures the user is authenticated and returns their Clerk user ID
 * Throws an error if not authenticated
 * 
 * @returns Clerk user ID
 * @throws Error if user is not authenticated
 */
export async function requireAuth(): Promise<string> {
  const userId = await getClerkUserId();
  if (!userId) {
    throw new Error("Unauthorized: User must be authenticated");
  }
  return userId;
}

/**
 * Syncs Clerk user to Supabase users table
 * Creates or updates the user record with Clerk user ID
 * 
 * @param clerkUserId - Clerk user ID
 * @param email - User email from Clerk
 * @param role - User role (defaults to 'student')
 * @returns Created or updated user record
 */
export async function syncClerkUserToSupabase(
  clerkUserId: string,
  email: string,
  role: "student" | "mentor" | "admin" = "student"
) {
  // Check if user exists
  let existingUser;
  try {
    existingUser = await db
      .select()
      .from(users)
      .where(eq(users.id, clerkUserId))
      .limit(1);
  } catch (error: unknown) {
    // Extract all error information
    const errorObj = error as Error & { 
      cause?: Error | unknown; 
      query?: string; 
      params?: unknown;
      code?: string;
      detail?: string;
      hint?: string;
    };
    
    const errorMessage = errorObj?.message || String(error);
    const errorStack = errorObj?.stack;
    
    // Extract underlying cause error (this is where the real postgres error is)
    let underlyingError: Error | null = null;
    if (errorObj?.cause) {
      if (errorObj.cause instanceof Error) {
        underlyingError = errorObj.cause;
      } else if (typeof errorObj.cause === 'object') {
        const causeObj = errorObj.cause as Record<string, unknown>;
        underlyingError = {
          name: String(causeObj.name || 'Error'),
          message: String(causeObj.message || causeObj),
        } as Error;
      }
    }
    
    // Log complete error details including underlying cause
    console.error("[Database] Query failed - Full details:", {
      message: errorMessage,
      code: errorObj?.code,
      detail: errorObj?.detail,
      hint: errorObj?.hint,
      query: errorObj?.query,
      params: errorObj?.params,
      cause: errorObj?.cause,
      underlyingError: underlyingError ? {
        name: underlyingError.name,
        message: underlyingError.message,
        stack: underlyingError.stack,
        code: (underlyingError as { code?: string }).code,
      } : null,
      stack: errorStack,
      clerkUserId,
      errorType: error?.constructor?.name,
      allProperties: error ? Object.getOwnPropertyNames(error) : [],
    });
    
    // Use underlying error message if available (this is the real postgres error)
    const actualError = underlyingError || errorObj;
    const actualCode = (actualError as { code?: string })?.code || errorObj?.code;
    const actualDetail = (actualError as { detail?: string })?.detail || errorObj?.detail;
    const actualHint = (actualError as { hint?: string })?.hint || errorObj?.hint;
    
    // Re-throw with more context
    const fullErrorMessage = [
      `Database query failed: ${actualError.message || errorMessage}`,
      actualCode ? `Error code: ${actualCode}` : null,
      actualDetail ? `Detail: ${actualDetail}` : null,
      actualHint ? `Hint: ${actualHint}` : null,
    ].filter(Boolean).join('\n');
    
    throw new Error(fullErrorMessage);
  }

  if (existingUser.length > 0) {
    // Update existing user
    const [updated] = await db
      .update(users)
      .set({
        email,
        updatedAt: new Date(),
      })
      .where(eq(users.id, clerkUserId))
      .returning();

    return updated;
  } else {
    // Create new user
    const [created] = await db
      .insert(users)
      .values({
        id: clerkUserId,
        email,
        role,
      })
      .returning();

    return created;
  }
}

/**
 * Gets or creates a user in Supabase from Clerk session
 * Automatically syncs Clerk user data to Supabase
 * 
 * @returns User record from Supabase
 * @throws Error if user is not authenticated
 */
export async function getOrCreateUser() {
  const clerkUser = await getClerkUser();
  if (!clerkUser) {
    throw new Error("Unauthorized: User must be authenticated");
  }

  const email = clerkUser.emailAddresses[0]?.emailAddress;
  if (!email) {
    throw new Error("User email not found in Clerk");
  }

  // Sync user to Supabase
  return await syncClerkUserToSupabase(
    clerkUser.id,
    email,
    // You can determine role from Clerk metadata if needed
    (clerkUser.publicMetadata?.role as "student" | "mentor" | "admin") || "student"
  );
}

