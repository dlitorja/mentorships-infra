import { decrypt } from "@mentorships/db";

/**
 * Decrypts a Google refresh token from storage.
 *
 * Supported formats (to maintain compatibility across migrations):
 * 1) Legacy plain text (Convex) — stored as-is
 * 2) Legacy base64 with "__decrypted__" prefix (old Postgres)
 * 3) AES-256-GCM encrypted, base64 encoded (current)
 */
export function decryptInstructorRefreshToken(instructor: { googleRefreshToken?: string | null }): string | null {
  const token = instructor.googleRefreshToken;
  if (!token) return null;

  try {
    // Try legacy base64-prefixed format
    try {
      const decoded = Buffer.from(token, "base64").toString("utf-8");
      if (decoded.startsWith("__decrypted__")) {
        return decoded.replace("__decrypted__", "");
      }
    } catch {
      // Not base64 or not prefixed — continue
    }

    // Try encrypted format
    try {
      const decrypted = decrypt(token);
      return decrypted;
    } catch {
      // Fall through
    }

    // Fallback: treat as plain text if it doesn't look base64-like
    if (!token.match(/^[A-Za-z0-9+/]+=*$/)) {
      return token;
    }
    return null;
  } catch {
    return null;
  }
}
