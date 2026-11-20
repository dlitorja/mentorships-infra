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
        const page = await ctx.db
          .query("adminOnboardings")
          .withIndex("by_status_createdAt", (q) =>
            q.eq("status", status).lte("createdAt", cutoff)
          )
          .take(100);
        rows.push(...page);
      }
      return rows;
    }

    const studentInvites48h: Awaited<ReturnType<typeof inviteItem>>[] = [];
    const studentInvites5d: Awaited<ReturnType<typeof inviteItem>>[] = [];
    const adminStale7d: Awaited<ReturnType<typeof inviteItem>>[] = [];

    for (const row of await pendingOnboardings(now - 48 * HOUR_MS)) {
      if (row.assignedStudentClerkId) continue;
      const item = await inviteItem(ctx, row, "student_invite_48h", now);
      if (!(await isSent(ctx, item.dedupeKey))) studentInvites48h.push(item);
    }

    for (const row of await pendingOnboardings(now - 5 * DAY_MS)) {
      if (row.assignedStudentClerkId) continue;
      const item = await inviteItem(ctx, row, "student_invite_5d", now);
      if (!(await isSent(ctx, item.dedupeKey))) studentInvites5d.push(item);
    }

    for (const row of await pendingOnboardings(now - 7 * DAY_MS)) {
      if (row.assignedStudentClerkId) continue;
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

    const submissions = await ctx.db
      .query("onboardingQuestionnaireSubmissions")
      .withIndex("by_status_updatedAt", (q) =>
        q.eq("status", "submitted").lte("updatedAt", now - 3 * DAY_MS)
      )
      .take(100);

    for (const submission of submissions) {
      if (submission.reviews && submission.reviews.length > 0) continue;
      if (
        !submission.submittedAt ||
        submission.submittedAt > now - 3 * DAY_MS
      ) {
        continue;
      }
      const row = await ctx.db.get(submission.onboardingId);
      if (!row || row.status === "cancelled") continue;

      for (const pair of row.perInstructor) {
        const instructor = await ctx.db.get(pair.instructorId);
        const email = instructor?.email?.trim();
        if (!email) continue;
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

export const markSent = internalMutation({
  args: {
    dedupeKey: v.string(),
    onboardingId: v.id("adminOnboardings"),
    kind: v.union(
      v.literal("student_invite_48h"),
      v.literal("student_invite_5d"),
      v.literal("admin_stale_7d"),
      v.literal("instructor_review_3d")
    ),
    recipient: v.string(),
    resendId: v.optional(v.string()),
  },
  handler: async (ctx: MutationCtx, args) => {
    const existing = await ctx.db
      .query("onboardingReminders")
      .withIndex("by_dedupeKey", (q) => q.eq("dedupeKey", args.dedupeKey))
      .first();
    if (existing) return { inserted: false as const };

    await ctx.db.insert("onboardingReminders", {
      dedupeKey: args.dedupeKey,
      onboardingId: args.onboardingId,
      kind: args.kind,
      recipient: args.recipient,
      sentAt: Date.now(),
      resendId: args.resendId,
    });
    return { inserted: true as const };
  },
});
