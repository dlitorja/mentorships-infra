export * from "@mentorships/schemas";

import { z } from "zod";

/**
 * Validates a Convex document ID format.
 * Convex IDs are base-32 encoded strings (lowercase alphanumeric).
 * This provides a 400 response instead of a 500 when malformed IDs are passed to Convex.
 */
export const convexIdSchema = z
  .string()
  .min(1, "ID is required")
  .regex(/^[a-z0-9]{10,}$/, "Invalid Convex document ID format");