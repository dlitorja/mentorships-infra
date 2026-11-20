import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { writeAuditLog } from "./auditLog";

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
  v.literal("sent"),
  v.literal("suppressed")
);

type ReviewStatus = "pending_review" | "approved" | "sent" | "suppressed";
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
    for (const item of args.items) {
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
        createdAt: Date.now(),
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

/**
 * Approved rows, oldest first, for the worker to send. The worker rebuilds the
 * email HTML from `context`.
 */
export const approvedForSend = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 25, 1), 100);
    const rows = await ctx.db
      .query("onboardingReminders")
      .withIndex("by_status_createdAt", (q) => q.eq("status", "approved"))
      .order("asc")
      .take(limit);

    return rows.map((row) => ({
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
  },
  handler: async (ctx, args) => {
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
