import { decrypt } from "@mentorships/db/lib/encryption";

/**
 * Decrypts a Google refresh token from storage.
 *
 * Three storage formats are supported:
 * 1. Legacy plain text (Convex, no encryption): stored as-is without encryption
 * 2. Legacy format (old Postgres): base64("__decrypted__" + actual_token)
 * 3. Encrypted (migrated Postgres): AES-256-GCM encrypted, base64 encoded
 *
 * @param instructor - Object with optional googleRefreshToken field
 * @returns Decrypted token string, or null if not present/invalid
 */
export function decryptMentorRefreshToken(instructor: { googleRefreshToken?: string | null }): string | null {
  const token = instructor.googleRefreshToken;
  if (!token) return null;

  try {
    if (token.startsWith("__decrypted__")) {
      const decoded = Buffer.from(token.replace("__decrypted__", ""), "base64").toString("utf-8");
      return decoded;
    }

    const decrypted = decrypt(token);
    return decrypted;
  } catch {
    return null;
  }
}