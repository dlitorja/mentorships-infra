import { eq } from "drizzle-orm";
import { db } from "../drizzle";
import { mentors } from "../../schema";

/**
 * Get mentor by Clerk user ID
 */
export async function getMentorByUserId(userId: string) {
  const [mentor] = await db
    .select()
    .from(mentors)
    .where(eq(mentors.userId, userId))
    .limit(1);

  return mentor || null;
}

/**
 * Get mentor by mentor ID (UUID)
 */
export async function getMentorById(mentorId: string) {
  const [mentor] = await db
    .select()
    .from(mentors)
    .where(eq(mentors.id, mentorId))
    .limit(1);

  return mentor || null;
}

