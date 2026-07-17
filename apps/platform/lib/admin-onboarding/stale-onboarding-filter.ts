// R7 (PR 8): pure helper extracted from `getStaleOnboardingRows` in
// `convex/adminOnboarding.ts` so the per-row filter logic is testable
// without a live Convex database.
//
// The helper takes a `fetchPack` callback instead of importing the
// Convex `db` client so it stays a pure function and can be unit-tested
// with stub data.

/**
 * Minimum shape of a `perInstructor` entry that the stale filter
 * needs to inspect. Mirrors the relevant fields from
 * `convex/schema.ts` so the helper stays decoupled from the generated
 * Convex types.
 */
export type StalePerInstructorEntry = {
  isRenewal?: boolean;
  sessionPackId?: string | null;
};

/**
 * Minimum shape of a `sessionPacks` row that the stale filter needs.
 * We only inspect `status` and the `userId` prefix to detect a
 * still-placeholder (not-yet-linked) pack.
 */
export type StaleSessionPack = {
  status?: string | null;
  userId?: string | null;
};

/**
 * Minimum shape of an `adminOnboardings` row that the stale filter
 * needs. The full Convex `Doc<"adminOnboardings">` is structurally
 * compatible with this type.
 */
export type StaleOnboardingRow = {
  createdAt: number;
  email: string;
  perInstructor?: StalePerInstructorEntry[] | null;
};

/**
 * Async loader for the placeholder-pack probe. Lets the caller fetch
 * packs via `ctx.db.get` from inside Convex while the helper remains
 * pure and synchronous-ish for tests.
 */
export type FetchPack = (
  sessionPackId: string,
) => Promise<StaleSessionPack | null>;

/**
 * Decide whether a single `adminOnboardings` row belongs in the daily
 * stale digest. The semantics intentionally mirror the original
 * inline filter in `convex/adminOnboarding.ts:1382-1403`:
 *
 *  - skip rows newer than `cutoffMs` (the digest is "older than N days")
 *  - skip rows whose `email` starts with the `clerk:` prefix used by
 *    the stub onboarding path
 *  - skip rows with no `perInstructor` entries (nothing to do)
 *  - keep the row only if at least one non-renewal pair points at a
 *    still-placeholder session pack (`status === "active"` AND
 *    `userId` starts with `email:`)
 *
 * Returns `true` when the row should appear in the digest.
 */
export async function isStaleOnboardingRow(
  row: StaleOnboardingRow,
  cutoffMs: number,
  fetchPack: FetchPack,
): Promise<boolean> {
  if (row.createdAt >= cutoffMs) return false;
  if (row.email.startsWith("clerk:")) return false;
  if (!Array.isArray(row.perInstructor) || row.perInstructor.length === 0) {
    return false;
  }

  for (const pair of row.perInstructor) {
    if (!pair || pair.isRenewal || !pair.sessionPackId) continue;
    const pack = await fetchPack(pair.sessionPackId);
    if (
      pack &&
      pack.status === "active" &&
      typeof pack.userId === "string" &&
      pack.userId.startsWith("email:")
    ) {
      return true;
    }
  }
  return false;
}
