import { decrypt } from "@mentorships/db";

/**
 * Decrypts a Google refresh token from storage.
 *
 * Three storage formats are supported:
 * 1. Legacy plain text (Convex, no encryption): stored as-is without encryption
 * 2. Legacy format (old Postgres): base64("__decrypted__" + actual_token) then base64 encoded again
 * 3. Encrypted (migrated Postgres): AES-256-GCM encrypted, base64 encoded
 *
 * @param instructor - Object with optional googleRefreshToken field
 * @returns Decrypted token string, or null if not present/invalid
 */
export function decryptMentorRefreshToken(instructor: { googleRefreshToken?: string | null }): string | null {
  const token = instructor.googleRefreshToken;
  if (!token) return null;

  try {
    // Try to decode as base64 first (legacy format: base64("__decrypted__" + actual_token))
    try {
      const decoded = Buffer.from(token, "base64").toString("utf-8");
      if (decoded.startsWith("__decrypted__")) {
        return decoded.replace("__decrypted__", "");
      }
    } catch {
      // Not base64 encoded, fall through to encryption check
    }

    // Try to decrypt as AES-256-GCM (migrated format)
    try {
      const decrypted = decrypt(token);
      return decrypted;
    } catch {
      // Fall through to plain-text fallback
    }

    // Legacy plain-text format (Convex, no encryption): return as-is
    // Only if it doesn't look like base64-encrypted content
    if (!token.match(/^[A-Za-z0-9+/]+=*$/)) {
      return token;
    }

    return null;
  } catch {
    return null;
  }
}