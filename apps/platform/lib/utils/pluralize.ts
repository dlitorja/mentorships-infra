/**
 * Pluralization helpers for displaying session counts.
 */

/**
 * Returns "session remaining" when n === 1, otherwise "sessions
 * remaining". Use this for visible text on the workspace pill,
 * dashboard badge, toasts, etc.
 */
export function pluralizeRemaining(n: number): "session remaining" | "sessions remaining" {
  return n === 1 ? "session remaining" : "sessions remaining";
}
