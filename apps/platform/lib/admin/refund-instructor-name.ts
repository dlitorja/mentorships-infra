/**
 * Best-effort instructor name for a student-facing refund email.
 *
 * The pack that produced a payment is not identifiable from the order alone
 * (`sessionPacks` has no `paymentId` index), so this only commits to a name when
 * the student's packs all point at one instructor. Ambiguity must not put the
 * wrong person's name on a refund receipt, and a generic "your instructor" reads
 * better than a wrong one.
 *
 * Lives outside the route module: Next.js rejects non-route exports from
 * `route.ts` under `next build --webpack`.
 */
export function pickInstructorName(names: Array<string | null | undefined>): string {
  const unique = Array.from(
    new Set(names.map((name) => name?.trim()).filter((name): name is string => Boolean(name)))
  );
  return unique.length === 1 ? unique[0] : "your instructor";
}
