import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { writeAuditLog } from "./auditLog";
import {
  anyPairWorking,
  instructorCanOpenReview,
  instructorIdFromDedupeKey,
  pairAlreadyWorking,
} from "./lib/onboardingReminderEligibility";

/**
 * Staged outbox for the automated onboarding follow-ups.
 *
 * The hourly worker scans, builds each nudge, and *stages* it here. Nothing is
 * sent until an admin approves it. "Do not send this one" is expressed by
 * suppressing the row with a reason; because the dedupe key is the primary
 * lookup, a suppressed row also stops the scan from queueing the same nudge
 * again (see `onboardingFollowUps.scan` → `isSent`).
 */

const REMINDER_KIND = v.union(
  v.literal("student_invite_48h"),
  v.literal("student_invite_5d"),
  v.literal("admin_stale_7d"),
  v.literal("instructor_review_3d")
);

const RECIPIENT_KIND = v.union(
  v.literal("student"),
  v.literal("instructor"),
  v.literal("admin")
);

const REVIEW_STATUS = v.union(
  v.literal("pending_review"),
  v.literal("approved"),
  v.literal("sending"),
  v.literal("sent"),
  v.literal("suppressed")
);

type ReviewStatus =
  | "pending_review"
  | "approved"
  | "sending"
  | "sent"
  | "suppressed";
type ReminderDoc = Doc<"onboardingReminders">;

function effectiveStatus(row: ReminderDoc): ReviewStatus {
  // Rows written before the outbox existed have no status and were sent.
  return (row.status ?? "sent") as ReviewStatus;
}

async function requireStaff(
  ctx: QueryCtx | MutationCtx
): Promise<{ subject: string; role: "admin" | "support" }> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Unauthorized");
  const user = await ctx.db
    .query("users")
    .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
    .first();
  if (!user || (user.role !== "admin" && user.role !== "support")) {
    throw new Error("Forbidden: admin or support role required");
  }
  return { subject: identity.subject, role: user.role };
}

const enqueueItem = v.object({
  dedupeKey: v.string(),
  onboardingId: v.id("adminOnboardings"),
  kind: REMINDER_KIND,
  recipient: v.string(),
  recipientName: v.optional(v.string()),
  recipientKind: RECIPIENT_KIND,
  subject: v.string(),
  previewText: v.string(),
  context: v.string(),
  reason: v.string(),
});

/**
 * Stage a batch of nudges. Keyed on `dedupeKey`, so a cron replay (or a
 * reminder that was already sent/suppressed) is a no-op rather than a second
 * row.
 */
export const enqueue = internalMutation({
  args: { items: v.array(enqueueItem) },
  handler: async (ctx, args) => {
    let inserted = 0;
    let skipped = 0;
    // `createdAt` doubles as the review-page cursor. A batch inserted with one
    // `Date.now()` would give every row the same value, and a cursor of
    // `createdAt < before` would then skip the rows that tie across a page
    // boundary. A fractional, monotonically-unique value keeps the cursor
    // exact without a compound key.
    const base = Date.now();
    for (const [index, item] of args.items.entries()) {
      const existing = await ctx.db
        .query("onboardingReminders")
        .withIndex("by_dedupeKey", (q) => q.eq("dedupeKey", item.dedupeKey))
        .first();
      if (existing) {
        skipped += 1;
        continue;
      }
      await ctx.db.insert("onboardingReminders", {
        dedupeKey: item.dedupeKey,
        onboardingId: item.onboardingId,
        kind: item.kind,
        recipient: item.recipient,
        status: "pending_review",
        // Deterministic sub-millisecond offset. `Math.random()` could put an
        // adjacent pair closer than a double's ulp at `base` (~2.4e-4 for a
        // 2026 epoch), so two rows occasionally rounded to the same value and
        // the `createdAt` cursor skipped one across a page boundary. A fixed
        // 1ms/1000 step is always several ulps apart.
        createdAt: base + (index + 1) / 1000,
        recipientName: item.recipientName,
        recipientKind: item.recipientKind,
        subject: item.subject,
        previewText: item.previewText,
        context: item.context,
        reason: item.reason,
      });
      inserted += 1;
    }
    return { inserted, skipped };
  },
});

const CLAIM_TIMEOUT_MS = 10 * 60 * 1000;

type Eligibility = { ok: true } | { ok: false; reason: string };

/**
 * Re-check a staged reminder against current state at send time. The review
 * queue can sit for hours or days, during which the student may sign up, the
 * instructor may review, a session may be used, or the onboarding may be
 * cancelled.
 */
async function stillEligible(
  ctx: MutationCtx,
  row: ReminderDoc
): Promise<Eligibility> {
  const onboarding = await ctx.db.get(row.onboardingId);
  if (!onboarding) {
    return { ok: false, reason: "the onboarding no longer exists" };
  }
  if (onboarding.status === "cancelled") {
    return { ok: false, reason: "the onboarding was cancelled" };
  }

  if (row.kind === "student_invite_48h" || row.kind === "student_invite_5d") {
    if (onboarding.assignedStudentClerkId) {
      return { ok: false, reason: "the student has already signed up" };
    }
    return { ok: true };
  }

  if (row.kind === "admin_stale_7d") {
    if (onboarding.assignedStudentClerkId) {
      return { ok: false, reason: "the student has already signed up" };
    }
    if (await anyPairWorking(ctx, onboarding)) {
      return { ok: false, reason: "a session has already been used" };
    }
    return { ok: true };
  }

  const instructorId = instructorIdFromDedupeKey(row.dedupeKey);
  if (!instructorId) {
    return { ok: false, reason: "the reminder has no instructor" };
  }
  const pair = onboarding.perInstructor.find(
    (candidate) => String(candidate.instructorId) === instructorId
  );
  if (!pair) {
    return { ok: false, reason: "the instructor is no longer assigned" };
  }
  if (await pairAlreadyWorking(ctx, pair)) {
    return { ok: false, reason: "a session has already been used" };
  }

  const instructor = await ctx.db.get(pair.instructorId);
  if (!instructor?.email) {
    return { ok: false, reason: "the instructor has no email on file" };
  }
  if (!(await instructorCanOpenReview(ctx, instructor, row.recipient))) {
    return { ok: false, reason: "the instructor cannot open the review link" };
  }

  const submissions = await ctx.db
    .query("onboardingQuestionnaireSubmissions")
    .withIndex("by_onboardingId", (q) =>
      q.eq("onboardingId", row.onboardingId)
    )
    .collect();
  const alreadyReviewed = submissions.some((submission) =>
    (submission.reviews ?? []).some(
      (review) => review.userId === instructor.userId
    )
  );
  if (alreadyReviewed) {
    return { ok: false, reason: "the instructor has already reviewed it" };
  }

  return { ok: true };
}

/**
 * Claim a batch for sending.
 *
 * Claiming (rather than reading and sending) is what makes overlapping worker
 * runs safe: a row can only be sent by the run that moved it to `sending`.
 * Rows whose claim is older than 10 minutes are re-claimed, so a crashed run
 * does not strand them. Ineligible rows are auto-suppressed with the reason
 * instead of being sent stale.
 */
export const claim = internalMutation({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 25, 1), 100);
    const now = Date.now();

    const approved = await ctx.db
      .query("onboardingReminders")
      .withIndex("by_status_createdAt", (q) => q.eq("status", "approved"))
      .order("asc")
      .take(limit);

    const sending = await ctx.db
      .query("onboardingReminders")
      .withIndex("by_status_createdAt", (q) => q.eq("status", "sending"))
      .order("asc")
      .take(limit);
    const stale = sending.filter(
      (row) => (row.claimedAt ?? 0) < now - CLAIM_TIMEOUT_MS
    );

    const claimed: ReminderDoc[] = [];
    const seen = new Set<string>();
    for (const row of [...approved, ...stale]) {
      if (claimed.length >= limit) break;
      if (seen.has(row._id)) continue;
      seen.add(row._id);

      const eligible = await stillEligible(ctx, row);
      if (!eligible.ok) {
        await ctx.db.patch(row._id, {
          status: "suppressed",
          suppressReason: `No longer applies: ${eligible.reason}`,
          reviewedAt: now,
          reviewedByUserId: "system",
        });
        await writeAuditLog(ctx, {
          actorId: "system",
          actorRole: "system",
          action: "auto_suppress_onboarding_reminder",
          targetType: "onboardingReminder",
          targetId: row._id,
          details: `Dropped ${row.kind} to ${row.recipient}: ${eligible.reason}`,
          metadata: {
            kind: row.kind,
            recipient: row.recipient,
            onboardingId: row.onboardingId,
            dedupeKey: row.dedupeKey,
            suppressReason: eligible.reason,
          },
        });
        continue;
      }

      await ctx.db.patch(row._id, { status: "sending", claimedAt: now });
      claimed.push({ ...row, status: "sending", claimedAt: now });
    }

    return claimed.map((row) => ({
      dedupeKey: row.dedupeKey,
      onboardingId: row.onboardingId,
      kind: row.kind,
      recipient: row.recipient,
      recipientName: row.recipientName ?? null,
      subject: row.subject ?? "",
      context: row.context ?? "{}",
    }));
  },
});

/**
 * One-off: rows written before the outbox existed have no `status`, so the
 * Sent tab (which filters on `status === "sent"`) cannot see them. Run once
 * after the deploy that introduces the outbox.
 */
export const backfillLegacyStatus = internalMutation({
  args: {},
  handler: async (ctx) => {
    let patched = 0;
    const rows = await ctx.db.query("onboardingReminders").collect();
    for (const row of rows) {
      if (row.status !== undefined) continue;
      await ctx.db.patch(row._id, {
        status: "sent",
        createdAt: row.createdAt ?? row.sentAt ?? row._creationTime,
      });
      patched += 1;
    }
    return { patched };
  },
});

/**
 * Record a successful send. Updates the staged row when present and inserts a
 * legacy-shaped row otherwise (e.g. a reminder staged before a deploy).
 */
export const markSent = internalMutation({
  args: {
    dedupeKey: v.string(),
    onboardingId: v.id("adminOnboardings"),
    kind: REMINDER_KIND,
    recipient: v.string(),
    resendId: v.optional(v.string()),
    // Optional so an automatic send can record what it delivered. Without
    // these the Sent tab shows a blank subject and "(no preview)".
    recipientName: v.optional(v.string()),
    recipientKind: v.optional(RECIPIENT_KIND),
    subject: v.optional(v.string()),
    previewText: v.optional(v.string()),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const details: {
      recipientName?: string;
      recipientKind?: "student" | "instructor" | "admin";
      subject?: string;
      previewText?: string;
      reason?: string;
    } = {};
    if (args.recipientName !== undefined) details.recipientName = args.recipientName;
    if (args.recipientKind !== undefined) details.recipientKind = args.recipientKind;
    if (args.subject !== undefined) details.subject = args.subject;
    if (args.previewText !== undefined) details.previewText = args.previewText;
    if (args.reason !== undefined) details.reason = args.reason;

    const existing = await ctx.db
      .query("onboardingReminders")
      .withIndex("by_dedupeKey", (q) => q.eq("dedupeKey", args.dedupeKey))
      .first();

    if (existing) {
      if (effectiveStatus(existing) === "sent") {
        return { inserted: false as const };
      }
      await ctx.db.patch(existing._id, {
        status: "sent",
        sentAt: Date.now(),
        resendId: args.resendId,
        ...details,
      });
      return { inserted: true as const };
    }

    await ctx.db.insert("onboardingReminders", {
      dedupeKey: args.dedupeKey,
      onboardingId: args.onboardingId,
      kind: args.kind,
      recipient: args.recipient,
      status: "sent",
      createdAt: Date.now(),
      sentAt: Date.now(),
      resendId: args.resendId,
      ...details,
    });
    return { inserted: true as const };
  },
});

/**
 * Reviewer surface. `status` defaults to `pending_review`; the `sent` and
 * `suppressed` tabs are the audit trail of what left and what was held back.
 */
export const listForReview = query({
  args: {
    status: v.optional(REVIEW_STATUS),
    limit: v.optional(v.number()),
    before: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireStaff(ctx);
    const status: ReviewStatus = args.status ?? "pending_review";
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 100);

    const rows = await ctx.db
      .query("onboardingReminders")
      .withIndex("by_status_createdAt", (q) => {
        const base = q.eq("status", status);
        return args.before !== undefined
          ? base.lt("createdAt", args.before)
          : base;
      })
      .order("desc")
      .take(limit + 1);

    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);

    return {
      items: page.map((row) => ({
        _id: row._id,
        dedupeKey: row.dedupeKey,
        kind: row.kind,
        onboardingId: row.onboardingId,
        recipient: row.recipient,
        recipientName: row.recipientName,
        recipientKind: row.recipientKind,
        subject: row.subject,
        previewText: row.previewText,
        reason: row.reason,
        status: effectiveStatus(row),
        createdAt: row.createdAt ?? row._creationTime,
        sentAt: row.sentAt,
        reviewedAt: row.reviewedAt,
        suppressReason: row.suppressReason,
      })),
      nextCursor: hasMore ? page[page.length - 1].createdAt : undefined,
    };
  },
});

/** Counts for the admin nav / page header. */
export const counts = query({
  args: {},
  handler: async (ctx) => {
    await requireStaff(ctx);
    const pending = await ctx.db
      .query("onboardingReminders")
      .withIndex("by_status_createdAt", (q) => q.eq("status", "pending_review"))
      .collect();
    const suppressed = await ctx.db
      .query("onboardingReminders")
      .withIndex("by_status_createdAt", (q) => q.eq("status", "suppressed"))
      .collect();
    return { pending: pending.length, suppressed: suppressed.length };
  },
});

/**
 * Approve or suppress a batch. Suppressing requires a reason: it is the
 * record of *why* a specific nudge must not go out, and it is what the next
 * person reads when the same reminder would otherwise be queued again.
 */
export const review = mutation({
  args: {
    ids: v.array(v.id("onboardingReminders")),
    action: v.union(v.literal("approve"), v.literal("suppress")),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const staff = await requireStaff(ctx);
    const reason = args.reason?.trim();
    if (args.action === "suppress" && !reason) {
      throw new Error("A reason is required to suppress a reminder");
    }

    let updated = 0;
    for (const id of args.ids) {
      const row = await ctx.db.get(id);
      if (!row) continue;
      const status = effectiveStatus(row);
      if (status !== "pending_review" && status !== "approved") {
        // Already sent or already suppressed: never resurrect.
        continue;
      }

      const now = Date.now();
      await ctx.db.patch(id, {
        status: args.action === "approve" ? "approved" : "suppressed",
        reviewedByUserId: staff.subject,
        reviewedAt: now,
        suppressReason: args.action === "suppress" ? reason : undefined,
      });

      await writeAuditLog(ctx, {
        actorId: staff.subject,
        actorRole: staff.role,
        action:
          args.action === "approve"
            ? "approve_onboarding_reminder"
            : "suppress_onboarding_reminder",
        targetType: "onboardingReminder",
        targetId: id,
        details:
          args.action === "approve"
            ? `Approved ${row.kind} to ${row.recipient}`
            : `Suppressed ${row.kind} to ${row.recipient}: ${reason}`,
        metadata: {
          kind: row.kind,
          recipient: row.recipient,
          onboardingId: row.onboardingId,
          dedupeKey: row.dedupeKey,
          suppressReason: reason ?? null,
        },
      });
      updated += 1;
    }

    return { updated };
  },
});

export type OnboardingReminderId = Id<"onboardingReminders">;
export type OnboardingReminderKind = ReminderDoc["kind"];
