import { auth, currentUser } from "@clerk/nextjs/server";
import { db } from "./drizzle";
import { users } from "../schema";
import { eq } from "drizzle-orm";
import { sanitizeErrorForLogging, sanitizeForLogging } from "./errorSanitization";

/**
 * Type guard to check if an error has a 'cause' property
 */
type ErrorWithCause = Error & { cause?: unknown };

function hasCause(error: unknown): error is ErrorWithCause {
  return typeof error === "object" && error !== null && "cause" in error;
}

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
  } catch (error) {
    // Extract the underlying error for better debugging
    let errorMessage = "Unknown error";
    let errorDetails = "";
    let underlyingError: unknown = null;
    
    if (error instanceof Error) {
      errorMessage = error.message;
      
      // DrizzleQueryError has a 'cause' property with the underlying error
      if (hasCause(error) && error.cause) {
        underlyingError = error.cause;
        if (underlyingError instanceof Error) {
          errorDetails = underlyingError.message;
        } else {
          errorDetails = String(underlyingError);
        }
      }
    } else {
      errorMessage = String(error);
    }
    
    // Log sanitized error for debugging (prevents sensitive data leakage)
    const sanitizedError = sanitizeErrorForLogging(error);
    const sanitizedDetails = errorDetails ? sanitizeForLogging(errorDetails) : undefined;
    
    console.error("Database query error:", {
      errorType: error?.constructor?.name,
      message: sanitizedError.message,
      details: sanitizedDetails,
      code: sanitizedError.code,
      stack: sanitizedError.stack,
      // Don't log fullError, underlyingError, or raw errorDetails to prevent sensitive data leakage
    });
    
    // Throw a sanitized error message (don't include underlying error details that might be sensitive)
    const sanitizedMessage = sanitizeErrorForLogging(new Error(errorMessage));
    const finalMessage = `Failed to query users table: ${sanitizedMessage.message}`;
    
    throw new Error(`Failed to query users table: ${finalMessage}`);
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

