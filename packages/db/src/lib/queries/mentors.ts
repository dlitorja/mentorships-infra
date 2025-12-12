import { eq } from "drizzle-orm";
import { db } from "../drizzle";
import { mentors } from "../../schema";
import type { MentorWorkingHours } from "../../schema/mentors";

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

/**
 * Update mentor Google Calendar auth settings (refresh token + calendar id)
 *
 * IMPORTANT: Never return tokens to the client.
 */
export async function updateMentorGoogleCalendarAuth(
  mentorId: string,
  data: { googleRefreshToken?: string; googleCalendarId?: string | null }
) {
  const [updated] = await db
    .update(mentors)
    .set({
      ...(data.googleRefreshToken !== undefined
        ? { googleRefreshToken: data.googleRefreshToken }
        : {}),
      ...(data.googleCalendarId !== undefined
        ? { googleCalendarId: data.googleCalendarId }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(mentors.id, mentorId))
    .returning();

  return updated || null;
}

export async function updateMentorSchedulingSettings(
  mentorId: string,
  data: { timeZone?: string | null; workingHours?: MentorWorkingHours | null }
) {
  const [updated] = await db
    .update(mentors)
    .set({
      ...(data.timeZone !== undefined ? { timeZone: data.timeZone } : {}),
      ...(data.workingHours !== undefined ? { workingHours: data.workingHours } : {}),
      updatedAt: new Date(),
    })
    .where(eq(mentors.id, mentorId))
    .returning();

  return updated || null;
}

