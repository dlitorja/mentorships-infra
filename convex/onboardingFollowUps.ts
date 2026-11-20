import { internalMutation, internalQuery } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";

/**
 * Follow-up reminder scan for onboarding.
 *
 * Four nudges:
 *   - 48h after onboarding, student still has no account → student reminder
 *   - 5d after onboarding, still no account → final student reminder
 *   - 7d after onboarding, still no account → admin check-in digest
 *   - 3d after questionnaire submission, instructor has not reviewed → nudge
 *
 * Every send is recorded in `onboardingReminders` by dedupe key, so a cron
 * replay or overlapping run cannot double-send.
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

async function isSent(ctx: QueryCtx, dedupeKey: string): Promise<boolean> {
  const row = await ctx.db
    .query("onboardingReminders")
    .withIndex("by_dedupeKey", (q) => q.eq("dedupeKey", dedupeKey))
    .first();
  return !!row;
}

type OnboardingRow = Doc<"adminOnboardings">;

/**
 * A pair is "already working together" once the student has used any session
 * from the pack that onboarding created. The student has met the instructor at
 * that point, so a "3 days, still unreviewed" nudge is noise (and a confusing
 * one — the questionnaire is no longer what's blocking the relationship).
 */
async function pairAlreadyWorking(
  ctx: QueryCtx,
  row: OnboardingRow
): Promise<boolean> {
  for (const pair of row.perInstructor) {
    if (!pair.sessionPackId) continue;
    const pack = await ctx.db.get(pair.sessionPackId);
    if (pack && pack.remainingSessions < pack.totalSessions) return true;
  }
  return false;
}

/**
 * The review link in the nudge opens `/onboarding/<id>`, which the auth gate
 * only admits for the Clerk user stored on the instructor row. A row that is
 * not linked to a live account — or whose account email differs from the one
 * we are about to email — sends the instructor to a 404. Skip those instead of
 * mailing a dead link.
 */
async function instructorCanOpenReview(
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


async function instructorNameForRow(
  ctx: QueryCtx,
  row: OnboardingRow
): Promise<string> {
  const first = row.perInstructor[0];
  if (!first) return "your instructor";
  const instructor = await ctx.db.get(first.instructorId);
  return instructor?.name?.trim() || "your instructor";
}

async function inviteItem(
  ctx: QueryCtx,
  row: OnboardingRow,
  kind: "student_invite_48h" | "student_invite_5d" | "admin_stale_7d",
  now: number
) {
  return {
    onboardingId: row._id,
    dedupeKey: `onboarding:${row._id}:${kind}`,
    kind,
    studentEmail: row.email,
    studentName: row.studentName?.trim() || row.email.split("@")[0],
    instructorName: await instructorNameForRow(ctx, row),
    daysPending: Math.floor((now - row.createdAt) / DAY_MS),
  };
}

export const scan = internalQuery({
  args: { now: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();

    async function pendingOnboardings(cutoff: number): Promise<OnboardingRow[]> {
      const rows: OnboardingRow[] = [];
      for (const status of ["processing", "completed"] as const) {
        let before: number | undefined;
        for (let page = 0; page < 10; page++) {
          const pageRows = await ctx.db
            .query("adminOnboardings")
            .withIndex("by_status_createdAt", (q) => {
              const base = q.eq("status", status);
              return before !== undefined
                ? base.lt("createdAt", before)
                : base.lte("createdAt", cutoff);
            })
            .order("desc")
            .take(100);
          rows.push(...pageRows);
          if (pageRows.length < 100) break;
          before = pageRows[pageRows.length - 1].createdAt;
        }
      }
      return rows;
    }

    const studentInvites48h: Awaited<ReturnType<typeof inviteItem>>[] = [];
    const studentInvites5d: Awaited<ReturnType<typeof inviteItem>>[] = [];
    const adminStale7d: Awaited<ReturnType<typeof inviteItem>>[] = [];

    for (const row of await pendingOnboardings(now - 48 * HOUR_MS)) {
      if (row.assignedStudentClerkId) continue;
      if (await pairAlreadyWorking(ctx, row)) continue;
      const item = await inviteItem(ctx, row, "student_invite_48h", now);
      if (!(await isSent(ctx, item.dedupeKey))) studentInvites48h.push(item);
    }

    for (const row of await pendingOnboardings(now - 5 * DAY_MS)) {
      if (row.assignedStudentClerkId) continue;
      if (await pairAlreadyWorking(ctx, row)) continue;
      const item = await inviteItem(ctx, row, "student_invite_5d", now);
      if (!(await isSent(ctx, item.dedupeKey))) studentInvites5d.push(item);
    }

    for (const row of await pendingOnboardings(now - 7 * DAY_MS)) {
      if (row.assignedStudentClerkId) continue;
      if (await pairAlreadyWorking(ctx, row)) continue;
      const item = await inviteItem(ctx, row, "admin_stale_7d", now);
      if (!(await isSent(ctx, item.dedupeKey))) adminStale7d.push(item);
    }

    const instructorReviews: Array<{
      onboardingId: Id<"adminOnboardings">;
      submissionId: Id<"onboardingQuestionnaireSubmissions">;
      dedupeKey: string;
      kind: "instructor_review_3d";
      instructorId: Id<"instructors">;
      instructorName: string;
      instructorEmail: string;
      studentName: string;
      studentEmail: string;
      submittedAt: number;
    }> = [];

    const submissions: Doc<"onboardingQuestionnaireSubmissions">[] = [];
    let beforeSubmitted: number | undefined;
    for (let page = 0; page < 10; page++) {
      const pageRows = await ctx.db
        .query("onboardingQuestionnaireSubmissions")
        .withIndex("by_status_submittedAt", (q) => {
          const base = q.eq("status", "submitted");
          return beforeSubmitted !== undefined
            ? base.lt("submittedAt", beforeSubmitted)
            : base.lte("submittedAt", now - 3 * DAY_MS);
        })
        .order("desc")
        .take(100);
      submissions.push(...pageRows);
      if (pageRows.length < 100) break;
      const last = pageRows[pageRows.length - 1].submittedAt;
      if (last === undefined) break;
      beforeSubmitted = last;
    }

    for (const submission of submissions) {
      if (
        !submission.submittedAt ||
        submission.submittedAt > now - 3 * DAY_MS
      ) {
        continue;
      }
      const row = await ctx.db.get(submission.onboardingId);
      if (!row || row.status === "cancelled") continue;
      if (await pairAlreadyWorking(ctx, row)) continue;

      for (const pair of row.perInstructor) {
        const instructor = await ctx.db.get(pair.instructorId);
        const email = instructor?.email?.trim();
        if (!email) continue;
        // Mailing a reviewer who cannot open the link is how a nudge turns
        // into a support ticket; skip until the account is linked.
        if (!(await instructorCanOpenReview(ctx, instructor, email))) continue;
        // Reviews are per reviewer. An admin review (or another
        // instructor's review) must not suppress this instructor's nudge.
        const reviewedByThisInstructor = instructor?.userId
          ? (submission.reviews ?? []).some(
              (review) => review.userId === instructor.userId
            )
          : false;
        if (reviewedByThisInstructor) continue;
        const dedupeKey = `onboarding:${row._id}:instructor_review_3d:${pair.instructorId}`;
        if (await isSent(ctx, dedupeKey)) continue;
        instructorReviews.push({
          onboardingId: row._id,
          submissionId: submission._id,
          dedupeKey,
          kind: "instructor_review_3d",
          instructorId: pair.instructorId,
          instructorName: instructor?.name?.trim() || "there",
          instructorEmail: email,
          studentName:
            row.studentName?.trim() || row.email.split("@")[0],
          studentEmail: row.email,
          submittedAt: submission.submittedAt,
        });
      }
    }

    return {
      studentInvites48h,
      studentInvites5d,
      adminStale7d,
      instructorReviews,
    };
  },
});
