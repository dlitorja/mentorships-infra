import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

/**
 * Shared eligibility checks for onboarding reminders.
 *
 * Both the hourly scan and the send-time claim use these, so a nudge cannot be
 * staged on one set of rules and sent on another.
 */

type OnboardingRow = Doc<"adminOnboardings">;
type Pair = OnboardingRow["perInstructor"][number];

/**
 * True once the student has used any session from the pack that this
 * onboarding/instructor pair created. At that point they have met, so a
 * "questionnaire waiting for review" nudge is noise.
 */
export async function pairAlreadyWorking(
  ctx: QueryCtx,
  pair: Pair
): Promise<boolean> {
  if (!pair.sessionPackId) return false;
  const pack = await ctx.db.get(pair.sessionPackId);
  return Boolean(pack && pack.remainingSessions < pack.totalSessions);
}

export async function anyPairWorking(
  ctx: QueryCtx,
  row: OnboardingRow
): Promise<boolean> {
  for (const pair of row.perInstructor) {
    if (await pairAlreadyWorking(ctx, pair)) return true;
  }
  return false;
}

/**
 * The review link opens `/onboarding/<id>`, which the auth gate only admits for
 * the Clerk user stored on the instructor row. A row that is not linked to a
 * live account — or whose account email differs from the address we are about
 * to mail — sends the instructor to a 404.
 */
export async function instructorCanOpenReview(
  ctx: QueryCtx,
  instructor: Doc<"instructors"> | null,
  email: string
): Promise<boolean> {
  if (!instructor?.userId || !/^user_/.test(instructor.userId)) return false;
  const user = await ctx.db
    .query("users")
    .withIndex("by_userId", (q) => q.eq("userId", instructor.userId as string))
    .first();
  if (!user?.email) return false;
  return user.email.trim().toLowerCase() === email.trim().toLowerCase();
}

/**
 * The instructor id is the last segment of the reminder's dedupe key
 * (`onboarding:<onboardingId>:instructor_review_3d:<instructorId>`). Parsed
 * rather than stored separately so the key stays the single source of truth for
 * what the reminder is about.
 */
export function instructorIdFromDedupeKey(
  dedupeKey: string
): string | null {
  const parts = dedupeKey.split(":");
  const last = parts[parts.length - 1];
  return last && last.length > 0 ? last : null;
}
