export * from "@mentorships/schemas";

import { z } from "zod";

/**
 * Validates a Convex document ID format.
 * Convex IDs are alphanumeric strings that may include hyphens and underscores.
 * This provides a 400 response instead of a 500 when malformed IDs are passed to Convex.
 *
 * Note: This only validates format, not table affinity — the Convex mutation/query
 * will reject IDs that don't belong to the expected table.
 */
export const convexIdSchema = z
  .string()
  .min(1, "ID is required")
  .regex(/^[a-zA-Z0-9_-]{10,}$/, "Invalid Convex document ID format");