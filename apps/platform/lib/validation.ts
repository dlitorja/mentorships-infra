/**
 * Email validation regex pattern
 * Validates basic email format
 */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validate and normalize email address
 * @param email - Email string to validate
 * @returns Normalized email or null if invalid
 */
export function validateEmail(email: string): string | null {
  if (!email || typeof email !== "string") {
    return null;
  }

  const trimmed = email.trim().toLowerCase();
  if (!trimmed || !EMAIL_REGEX.test(trimmed)) {
    return null;
  }

  return trimmed;
}

/**
 * Sanitize string input by trimming and removing HTML tags
 * @param input - String to sanitize
 * @returns Sanitized string
 */
export function sanitizeString(input: unknown): string {
  if (typeof input !== "string") {
    return "";
  }

  // Remove HTML tags and trim whitespace
  const sanitized = input
    .trim()
    .replace(/<[^>]*>/g, "")
    .replace(/[<>]/g, "");

  return sanitized;
}

/**
 * Sanitize artGoals - can be string or array of strings
 * @param artGoals - Art goals input
 * @returns Sanitized string or empty string
 */
export function sanitizeArtGoals(artGoals: unknown): string {
  if (Array.isArray(artGoals)) {
    return artGoals
      .map((item) => sanitizeString(item))
      .filter(Boolean)
      .join(" ");
  }

  return sanitizeString(artGoals);
}

