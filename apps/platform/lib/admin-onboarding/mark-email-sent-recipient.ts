/**
 * R5 (PR 14): pure helper that maps a semantic recipient kind to the
 * corresponding `emailsSentPatch` shape used by `appendTimelineEntry`.
 *
 * Lives in `apps/platform/lib/admin-onboarding/` so it can be unit-tested
 * without a Convex runtime; the Convex mutation `markEmailSent`
 * (`convex/adminOnboarding.ts`) imports this mapping function and
 * delegates the actual merge + status patch to `appendTimelineEntry`.
 *
 * Why this exists: the original PR 4 callers pass three different patch
 * shapes (`{ student: true }`, `{ instructors: [id] }`,
 * `{ adminSummaryByEmail: { email: true } }`) depending on which email
 * leg they're tracking. The `markEmailSent` helper consolidates these
 * into a single discriminated-union API so callers say "what was sent"
 * instead of "what patch shape do I need". This file locks down the
 * mapping in isolation; the merge invariants are already covered by
 * `emails-sent-merge.test.ts` (PR 8 / R7).
 *
 * Note: the adminSummary recipient maps BOTH `adminSummary: true` AND
 * `adminSummaryByEmail: { email: true }`. No current caller invokes this
 * mapping for adminSummary sends — `send-admin-email-finalize` uses
 * aggregate semantics (one timeline entry per run with a per-address
 * map) and continues to call `appendTimelineEntryAction` directly.
 * The adminSummary mapping is provided for future per-recipient admin
 * tracking; if a future PR wants to migrate the aggregate path to
 * per-recipient, this helper is the single source of truth.
 */

export type MarkEmailSentRecipient =
  | { kind: "student" }
  | { kind: "instructor"; instructorId: string }
  | { kind: "adminSummary"; email: string };

export interface EmailsSentPatchShape {
  student?: boolean;
  instructors?: string[];
  adminSummary?: boolean;
  adminSummaryByEmail?: Record<string, boolean>;
}

export function emailsSentPatchForRecipient(
  recipient: MarkEmailSentRecipient,
): EmailsSentPatchShape {
  switch (recipient.kind) {
    case "student":
      return { student: true };
    case "instructor":
      return { instructors: [recipient.instructorId] };
    case "adminSummary":
      return {
        adminSummary: true,
        adminSummaryByEmail: { [recipient.email]: true },
      };
  }
}
