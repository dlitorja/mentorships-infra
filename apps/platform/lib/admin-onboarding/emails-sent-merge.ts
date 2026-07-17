// R7 (PR 8): pure helper extracted from `appendTimelineEntry` in
// `convex/adminOnboarding.ts` so the per-email-send merge logic is
// testable without a live Convex mutation.
//
// Background: `appendTimelineEntry` accepts an `emailsSentPatch`
// describing which legs of the email fan-out succeeded on this tick.
// The merge has three subtle invariants that the original inline code
// got wrong in earlier iterations (PR 4 fixes):
//
//   1. `instructors` arrays are concatenated and deduplicated so a
//      retry does not re-send to all-but-the-last instructor.
//   2. `adminSummaryByEmail` is keyed-merged so a retry does not
//      overwrite prior successful addresses.
//   3. Other top-level fields (`student`, `adminSummary`, `stub`)
//      follow a shallow patch where the latest value wins.
//
// This helper is the canonical implementation; the Convex mutation
// delegates to it.

export type EmailsSentState = {
  student?: boolean;
  instructors?: readonly string[];
  adminSummary?: boolean;
  adminSummaryByEmail?: Readonly<Record<string, boolean>>;
  stub?: boolean;
};

export type EmailsSentPatch = {
  student?: boolean;
  instructors?: readonly string[];
  adminSummary?: boolean;
  adminSummaryByEmail?: Readonly<Record<string, boolean>>;
  stub?: boolean;
};

/**
 * Merge a new `emailsSentPatch` into the existing `emailsSent` state,
 * returning a fresh object. Returns `existing` unchanged when no
 * patch is supplied.
 */
export function mergeEmailsSentPatch(
  existing: EmailsSentState | null | undefined,
  patch: EmailsSentPatch | null | undefined,
): EmailsSentState {
  if (!patch) return existing ?? {};

  const existingInstructors: readonly string[] = existing?.instructors ?? [];
  const patchInstructors: readonly string[] = patch.instructors ?? [];
  const mergedInstructors = Array.from(
    new Set([...existingInstructors, ...patchInstructors]),
  );

  const existingByEmail: Readonly<Record<string, boolean>> =
    existing?.adminSummaryByEmail ?? {};
  const patchByEmail: Readonly<Record<string, boolean>> =
    patch.adminSummaryByEmail ?? {};
  const mergedByEmail: Record<string, boolean> = {
    ...existingByEmail,
    ...patchByEmail,
  };

  return {
    ...(existing ?? {}),
    ...patch,
    instructors: mergedInstructors,
    adminSummaryByEmail: mergedByEmail,
  };
}
