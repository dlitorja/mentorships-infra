/**
 * Decrypts a mentor's Google refresh token from base64 encoding.
 * Tokens are stored encrypted and prefixed with "__decrypted__" marker after decryption.
 */
export function decryptMentorRefreshToken(mentor: { googleRefreshToken?: string }): string | null {
  if (!mentor.googleRefreshToken) return null;
  try {
    const decrypted = Buffer.from(mentor.googleRefreshToken, "base64").toString("utf-8");
    return decrypted.startsWith("__decrypted__") ? decrypted.replace("__decrypted__", "") : null;
  } catch {
    return null;
  }
}