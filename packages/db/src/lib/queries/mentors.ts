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
 * IMPORTANT: Never return tokens to client.
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
    if (data.googleRefreshToken) {
      try {
        updateData.googleRefreshToken = encrypt(data.googleRefreshToken);
      } catch (error) {
        // If encryption fails, log error and don't store the token
        console.error("Failed to encrypt refresh token:", error);
        throw new Error("Failed to encrypt refresh token");
      }
    } else {
      updateData.googleRefreshToken = null;
    }
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
 * Decrypts Google refresh token from a mentor object
 * 
 * @param mentor - Mentor object with potentially encrypted refresh token
 * @returns Decrypted refresh token, or null if not present
 * 
 * IMPORTANT: Only use this when you need plaintext token (e.g., for API calls).
 * Never return decrypted tokens to client.
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
    // Log error and telemetry for tracking migration progress
    console.error("Failed to decrypt refresh token (may be legacy unencrypted data):", error);
    
    // Add telemetry to track when legacy tokens are still in use
    // This helps ensure migration completes and identify accounts needing manual intervention
    if (process.env.TELEMETRY_ENDPOINT) {
      // In production, send to observability platform
      // Example: Datadog, New Relic, Sentry, etc.
      // For now, just logging to console
      console.warn("Legacy unencrypted token detected. Account may need manual migration.");
    }
    
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