import { eq } from "drizzle-orm";
import { db } from "../drizzle";
import { users } from "../../schema";

/**
 * Get user by Clerk user ID
 */
export async function getUserById(clerkUserId: string) {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, clerkUserId))
    .limit(1);

  return user || null;
}

/**
 * Get user by email
 */
export async function getUserByEmail(email: string) {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  return user || null;
}

/**
 * Update user role
 */
export async function updateUserRole(
  clerkUserId: string,
  role: "student" | "mentor" | "admin"
) {
  const [updated] = await db
    .update(users)
    .set({
      role,
      updatedAt: new Date(),
    })
    .where(eq(users.id, clerkUserId))
    .returning();

  return updated;
}

