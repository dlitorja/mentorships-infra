import { eq } from "drizzle-orm";
import { db } from "../drizzle";
import { mentors } from "../../schema";
import type { MentorWorkingHours } from "../../schema/mentors";
import { encrypt, decrypt } from "../encryption";

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
 * The refresh token is automatically encrypted before storage.
 */
export async function updateMentorGoogleCalendarAuth(
  mentorId: string,
  data: { googleRefreshToken?: string; googleCalendarId?: string | null }
) {
  const updateData: {
    googleRefreshToken?: string | null;
    googleCalendarId?: string | null;
    updatedAt: Date;
  } = {
    updatedAt: new Date(),
  };

  // Encrypt refresh token before storing
  if (data.googleRefreshToken !== undefined) {
    updateData.googleRefreshToken = data.googleRefreshToken
      ? encrypt(data.googleRefreshToken)
      : null;
  }

  if (data.googleCalendarId !== undefined) {
    updateData.googleCalendarId = data.googleCalendarId;
  }

  const [updated] = await db
    .update(mentors)
    .set(updateData)
    .where(eq(mentors.id, mentorId))
    .returning();

  return updated || null;
}

/**
 * Decrypts the Google refresh token from a mentor object
 * 
 * @param mentor - Mentor object with potentially encrypted refresh token
 * @returns Decrypted refresh token, or null if not present
 * 
 * IMPORTANT: Only use this when you need the plaintext token (e.g., for API calls).
 * Never return decrypted tokens to the client.
 */
export function decryptMentorRefreshToken(mentor: {
  googleRefreshToken: string | null;
} | null | undefined): string | null {
  if (!mentor?.googleRefreshToken) {
    return null;
  }

  try {
    return decrypt(mentor.googleRefreshToken);
  } catch (error) {
    // If decryption fails, it might be unencrypted data from before migration
    // Log error but return the original value to allow graceful migration
    console.error("Failed to decrypt refresh token (may be legacy unencrypted data):", error);
    return mentor.googleRefreshToken;
  }
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

