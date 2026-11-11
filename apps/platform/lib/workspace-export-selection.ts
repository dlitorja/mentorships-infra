/**
 * Helpers for the workspace export tabs' "export selected" flow.
 */

/**
 * True when the ids an export was built from match the current
 * selection. Order-insensitive; both sides are compared as sets.
 *
 * The selection bar uses this so a completed "selected" archive is only
 * offered while the checkboxes still describe the same set — otherwise
 * the user would download a CSV/ZIP for a different selection than the
 * one on screen.
 */
export function sameIdSet(
  stored: readonly string[] | undefined,
  current: Iterable<string>
): boolean {
  const a = new Set(stored ?? []);
  const b = new Set(current);
  if (a.size === 0 || a.size !== b.size) return false;
  for (const id of b) {
    if (!a.has(id)) return false;
  }
  return true;
}
