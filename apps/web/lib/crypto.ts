/**
 * Decrypts a Google refresh token from storage.
 *
 * Two storage formats are supported:
 * 1. Legacy Postgres (encrypted): base64-encoded with "__decrypted__" prefix
 * 2. Convex (plain text): stored as-is without encryption
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
    return token;
  } catch {
    return null;
  }
}