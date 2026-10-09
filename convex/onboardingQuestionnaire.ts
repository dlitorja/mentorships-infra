import {
  mutation,
  query,
  internalMutation,
  internalQuery,
  MutationCtx,
  QueryCtx,
} from "./_generated/server";
import { v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";

import {
  MAX_WORK_EXAMPLES_PER_ONBOARDING,
  MIN_INSPIRATIONS,
  MAX_INSPIRATIONS,
  MIN_WORK_EXAMPLES_PER_SUBMISSION,
  ONBOARDING_REQUIRED_QUESTION_IDS,
  ONBOARDING_REMINDER_STALE_MS,
  ONBOARDING_REMINDER_MAX_COUNT,
  ONBOARDING_REMINDER_MIN_INTERVAL_MS,
} from "./workspaceConstants";

/**
 * PR 12 PR 4 — student-facing onboarding questionnaire.
 *
 * Mutations:
 *   - `saveQuestionnaireDraft` — auto-save on every field change,
 *     debounced client-side at ~500ms. Upserts the
 *     `onboardingQuestionnaireSubmissions` row keyed by
 *     `onboardingId`. No-op once `status === "submitted"`.
 *   - `submitQuestionnaire`    — locks the row to `submitted`,
 *     stamps `submittedAt`. The submission status is read by
 *     `getSubmittedQuestionnaireForViewer` for the instructor
 *     view; we do NOT append a `adminOnboardings.timeline`
 *     event here because widening that union requires
 *     regenerating `_generated/` (only happens on push to main
 *     per `.github/workflows/ci.yml`, not on PRs).
 *   - `getQuestionnaireForCurrentUser` — read-side query used by
 *     the `/onboarding/[id]/questionnaire` page to hydrate the
 *     form on mount.
 *   - `getSubmittedQuestionnaireForViewer` — read-side query
 *     used by the instructor view on `/onboarding/[id]` to
 *     render submitted answers + image gallery read-only.
 *   - `recordQuestionnaireSeen` (internal) — stamps `lastSeenAt`
 *     on the submission row, called by the beacon API route.
 *     Does NOT count toward `reminderCount` — only the cron
 *     does that.
 *
 * Permissions:
 *   - Save/submit/getQuestionnaireForCurrentUser: gated on
 *     `assignedStudentClerkId === identity.subject`.
 *   - getSubmittedQuestionnaireForViewer: gated on assigned
 *     student OR matching instructor OR admin/support.
 *
 * Greptile P2 (carryover from PR 2 #5): avoid letting
 * `inspirations` grow unbounded — capped at 4 client-side
 * (`MAX_INSPIRATIONS`) AND server-side (`submitQuestionnaire`
 * throws on > 4).
 */

async function loadDraftOrNull(
  ctx: QueryCtx | MutationCtx,
  onboardingId: Id<"adminOnboardings">
): Promise<Doc<"onboardingQuestionnaireSubmissions"> | null> {
  const rows = await ctx.db
    .query("onboardingQuestionnaireSubmissions")
    .withIndex("by_onboardingId", (q) => q.eq("onboardingId", onboardingId))
    .take(1);
  return rows[0] ?? null;
}

async function ensureAssignedStudent(
  ctx: MutationCtx,
  onboardingId: Id<"adminOnboardings">
): Promise<Doc<"adminOnboardings">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("UNAUTHORIZED: sign-in required");
  }
  const row = await ctx.db.get("adminOnboardings", onboardingId);
  if (!row) {
    throw new Error("NOT_FOUND: onboarding row missing");
  }
  if (row.assignedStudentClerkId !== identity.subject) {
    // 404-equivalent: throw a stable error code so the page renders
    // notFound() instead of leaking existence (PR 3 plan §5.3).
    throw new Error("NOT_FOUND: not your onboarding");
  }
  if (row.status === "cancelled") {
    throw new Error("TERMINAL: onboarding was cancelled");
  }
  return row;
}

const QUESTIONNAIRE_ANSWERS_VALIDATOR = v.array(
  v.object({
    questionId: v.string(),
    questionText: v.string(),
    answerText: v.string(),
  })
);

const QUESTIONNAIRE_INSPIRATIONS_VALIDATOR = v.array(
  v.object({
    name: v.string(),
  })
);

/**
 * Auto-save a draft. Called by the form on every field change
 * (debounced ~500ms). Upserts the submission row.
 *
 * Validation here is intentionally LAX — we accept partial
 * answers so the student can save mid-thought. The hard gate
 * lives in `submitQuestionnaire`.
 */
export const saveQuestionnaireDraft = mutation({
  args: {
    onboardingId: v.id("adminOnboardings"),
    questionnaireVersion: v.number(),
    answers: QUESTIONNAIRE_ANSWERS_VALIDATOR,
    inspirations: QUESTIONNAIRE_INSPIRATIONS_VALIDATOR,
  },
  returns: v.object({
    submissionId: v.id("onboardingQuestionnaireSubmissions"),
    status: v.union(v.literal("draft"), v.literal("submitted")),
  }),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("UNAUTHORIZED: sign-in required");
    const row = await ensureAssignedStudent(ctx, args.onboardingId);

    // Lame array-length cap to keep the document size bounded —
    // Convex's 1MB doc limit plus the `no unbounded lists` rule
    // from `convex/_generated/ai/guidelines.md`. Client-side
    // already caps at MAX_INSPIRATIONS = 4; this is the
    // server-side backstop.
    if (args.inspirations.length > MAX_INSPIRATIONS) {
      throw new Error(
        `Too many inspirations: ${args.inspirations.length} > ${MAX_INSPIRATIONS}`
      );
    }

    const now = Date.now();
    const existing = await loadDraftOrNull(ctx, args.onboardingId);

    if (existing && existing.status === "submitted") {
      // Locked. Return the existing submission; the form should
      // also have switched to read-only mode.
      return {
        submissionId: existing._id,
        status: "submitted" as const,
      };
    }

    if (existing) {
      await ctx.db.patch(existing._id, {
        questionnaireVersion: args.questionnaireVersion,
        answers: args.answers,
        inspirations: args.inspirations,
        updatedAt: now,
      });
      return {
        submissionId: existing._id,
        status: "draft" as const,
      };
    }

    // First save — insert a new row keyed by onboardingId.
    const submissionId = await ctx.db.insert(
      "onboardingQuestionnaireSubmissions",
      {
        onboardingId: args.onboardingId,
        studentClerkId: row.assignedStudentClerkId!,
        questionnaireVersion: args.questionnaireVersion,
        status: "draft",
        answers: args.answers,
        inspirations: args.inspirations,
        createdAt: now,
        updatedAt: now,
      }
    );
    return {
      submissionId,
      status: "draft" as const,
    };
  },
});

/**
 * Submit a completed questionnaire. Hard-validates against the
 * canonical question bank AND the server-counted active work
 * examples, then flips `status` to "submitted". Idempotent —
 * re-submitting an already-submitted row is a no-op.
 *
 * Greptile P1 #3 fix (this PR): the original draft of this
 * mutation trusted the client-supplied `activeWorkExampleCount`
 * and accepted an empty `answers` array. Both are now
 * server-derived: we read the actual active row count from the
 * `onboardingWorkExamples` table and require one non-empty
 * answer entry per `ONBOARDING_REQUIRED_QUESTION_IDS` id.
 */
export const submitQuestionnaire = mutation({
  args: {
    onboardingId: v.id("adminOnboardings"),
    questionnaireVersion: v.number(),
    answers: QUESTIONNAIRE_ANSWERS_VALIDATOR,
    inspirations: QUESTIONNAIRE_INSPIRATIONS_VALIDATOR,
  },
  returns: v.object({
    submissionId: v.id("onboardingQuestionnaireSubmissions"),
    submittedAt: v.number(),
  }),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("UNAUTHORIZED: sign-in required");
    const row = await ensureAssignedStudent(ctx, args.onboardingId);

    // ---- Canonical question-id coverage check (Greptile P1 #3) ----
    // Require one non-empty answer entry per canonical question id.
    // The validator is intentionally loose (`v.array(v.object({...}))`)
    // so the draft-save path can accept partial / out-of-order
    // answers; the gate lives here, not in the validator.
    const answeredIds = new Set<string>();
    for (const ans of args.answers) {
      if (ans.answerText.trim()) {
        answeredIds.add(ans.questionId);
      }
    }
    const missingIds = ONBOARDING_REQUIRED_QUESTION_IDS.filter(
      (id) => !answeredIds.has(id)
    );
    if (missingIds.length > 0) {
      throw new Error(
        `Missing required answers: ${missingIds.join(", ")}`
      );
    }

    // ---- Inspirations bounds ----
    if (args.inspirations.length < MIN_INSPIRATIONS) {
      throw new Error(
        `Need at least ${MIN_INSPIRATIONS} inspirations (got ${args.inspirations.length})`
      );
    }
    if (args.inspirations.length > MAX_INSPIRATIONS) {
      throw new Error(
        `Too many inspirations: ${args.inspirations.length} > ${MAX_INSPIRATIONS}`
      );
    }
    for (const entry of args.inspirations) {
      if (!entry.name.trim()) {
        throw new Error("Inspiration entry has empty name");
      }
    }

    // ---- Server-counted work-example gate (Greptile P1 #3) ----
    // Don't trust the client arg — read the active row count from
    // `onboardingWorkExamples`. This stops a form from submitting
    // with `activeWorkExampleCount: 4` and zero uploaded bytes.
    const activeWorkExamples = await ctx.db
      .query("onboardingWorkExamples")
      .withIndex("by_onboardingId_active", (q) =>
        q.eq("onboardingId", args.onboardingId).eq("status", "active")
      )
      .collect();
    if (activeWorkExamples.length < MIN_WORK_EXAMPLES_PER_SUBMISSION) {
      throw new Error(
        `Need at least ${MIN_WORK_EXAMPLES_PER_SUBMISSION} active work examples (got ${activeWorkExamples.length})`
      );
    }
    if (activeWorkExamples.length > MAX_WORK_EXAMPLES_PER_ONBOARDING) {
      throw new Error(
        `Too many work examples: ${activeWorkExamples.length} > ${MAX_WORK_EXAMPLES_PER_ONBOARDING}`
      );
    }

    const now = Date.now();
    const existing = await loadDraftOrNull(ctx, args.onboardingId);

    if (existing && existing.status === "submitted") {
      // Idempotent — return the existing submission timestamp
      // so the page can render a confirmation screen.
      return {
        submissionId: existing._id,
        submittedAt: existing.submittedAt ?? existing.updatedAt,
      };
    }

    const submissionId = existing
      ? (await ctx.db.patch(existing._id, {
          questionnaireVersion: args.questionnaireVersion,
          answers: args.answers,
          inspirations: args.inspirations,
          status: "submitted",
          submittedAt: now,
          updatedAt: now,
        }), existing._id)
      : await ctx.db.insert("onboardingQuestionnaireSubmissions", {
          onboardingId: args.onboardingId,
          studentClerkId: row.assignedStudentClerkId!,
          questionnaireVersion: args.questionnaireVersion,
          status: "submitted",
          answers: args.answers,
          inspirations: args.inspirations,
          createdAt: now,
          updatedAt: now,
          submittedAt: now,
        });

    // PR 12 PR 4: do NOT call `appendTimelineEntry` here.
    // Reasoning: the timeline event union in
    // `convex/adminOnboarding.ts` does not include a
    // `questionnaire_submitted` variant (widening the union
    // requires regenerating `convex/_generated/`, which only
    // happens on push to main per `.github/workflows/ci.yml`,
    // not on PRs). The questionnaire submission is surfaced to
    // the admin onboarding detail page and the instructor view
    // by reading the
    // `onboardingQuestionnaireSubmissions` table directly
    // (`getSubmittedQuestionnaireForViewer` in this file). If a
    // future PR wants a timeline event, widen the union AND
    // regenerate `_generated/` in the same PR.

    return {
      submissionId,
      submittedAt: now,
    };
  },
});

/**
 * Read-side: hydrate the questionnaire form on mount. Returns
 * `null` if no draft yet exists (fresh form). Returns the
 * stored answers if a draft exists, OR the submitted payload
 * if the student already submitted.
 */
export const getQuestionnaireForCurrentUser = query({
  args: { onboardingId: v.id("adminOnboardings") },
  returns: v.union(
    v.null(),
    v.object({
      submissionId: v.id("onboardingQuestionnaireSubmissions"),
      status: v.union(v.literal("draft"), v.literal("submitted")),
      questionnaireVersion: v.number(),
      answers: QUESTIONNAIRE_ANSWERS_VALIDATOR,
      inspirations: QUESTIONNAIRE_INSPIRATIONS_VALIDATOR,
      submittedAt: v.optional(v.number()),
      updatedAt: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const row = await ctx.db.get("adminOnboardings", args.onboardingId);
    if (!row) return null;
    if (row.assignedStudentClerkId !== identity.subject) {
      // 404-equivalent (matches PR 3 plan §5.3 — no existence
      // leakage to non-assigned identities).
      return null;
    }
    const submission = await loadDraftOrNull(ctx, args.onboardingId);
    if (!submission) return null;
    return {
      submissionId: submission._id,
      status: submission.status,
      questionnaireVersion: submission.questionnaireVersion,
      answers: submission.answers,
      inspirations: submission.inspirations,
      submittedAt: submission.submittedAt,
      updatedAt: submission.updatedAt,
    };
  },
});

/**
 * Read-side: instructor/admin views. Returns the submitted
 * answers + active work-example rows for the given onboarding
 * IF a submitted row exists. Returns `null` when no
 * submission yet (instructor sees "Awaiting student's
 * questionnaire").
 */
export const getSubmittedQuestionnaireForViewer = query({
  args: { onboardingId: v.id("adminOnboardings") },
  returns: v.union(
    v.null(),
    v.object({
      submission: v.object({
        submittedAt: v.number(),
        questionnaireVersion: v.number(),
        answers: QUESTIONNAIRE_ANSWERS_VALIDATOR,
        inspirations: QUESTIONNAIRE_INSPIRATIONS_VALIDATOR,
      }),
      workExamples: v.array(
        v.object({
          _id: v.id("onboardingWorkExamples"),
          b2Key: v.string(),
          contentType: v.string(),
          size: v.number(),
          uploadedAt: v.number(),
        })
      ),
    })
  ),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const row = await ctx.db.get("adminOnboardings", args.onboardingId);
    if (!row) return null;

    // Permission: the assigned student (read-only mirror of
    // their own submission), OR one of the assigned
    // instructors, OR an admin/support. Reuses the same gate
    // shape as `getOnboardingView` so we don't need a separate
    // "is assigned instructor" path.
    const isAssignedStudent =
      row.assignedStudentClerkId === identity.subject;
    let isAssignedInstructor = false;
    if (!isAssignedStudent) {
      for (const p of row.perInstructor) {
        const instructor = await ctx.db.get("instructors", p.instructorId);
        if (instructor?.userId === identity.subject) {
          isAssignedInstructor = true;
          break;
        }
      }
    }
    if (!isAssignedStudent && !isAssignedInstructor) {
      // Defer to admin/support check by querying the users
      // table.
      const userRow = await ctx.db
        .query("users")
        .withIndex("by_clerkId", (q) =>
          q.eq("clerkId", identity.subject)
        )
        .first();
      if (!userRow || (userRow.role !== "admin" && userRow.role !== "support")) {
        return null;
      }
    }

    const submission = await loadDraftOrNull(ctx, args.onboardingId);
    if (!submission || submission.status !== "submitted") {
      return null;
    }

    // Greptile round 1 P1 lesson: instructors with no
    // userId attached must still match. The `perInstructor`
    // entries store instructor IDs; resolve to userIds via
    // the instructors table when needed.
    const examples = await ctx.db
      .query("onboardingWorkExamples")
      .withIndex("by_onboardingId_active", (q) =>
        q.eq("onboardingId", args.onboardingId).eq("status", "active")
      )
      .collect();

    return {
      submission: {
        submittedAt: submission.submittedAt ?? submission.updatedAt,
        questionnaireVersion: submission.questionnaireVersion,
        answers: submission.answers,
        inspirations: submission.inspirations,
      },
      workExamples: examples.map((ex) => ({
        _id: ex._id,
        b2Key: ex.b2Key,
        contentType: ex.contentType,
        size: ex.size,
        uploadedAt: ex.uploadedAt,
      })),
    };
  },
});

/**
 * Stamp `lastSeenAt` on the submission row. Called by the
 * `/api/onboarding/[id]/abandoned` beacon route.
 *
 * Made public (not internal) because the beacon flow requires a
 * browser → Next.js → Convex call path. The auth check is
 * server-side: reads `ctx.auth` and verifies the caller's Clerk
 * subject matches the submission's `studentClerkId`. Does NOT
 * increment `reminderCount` — only the cron does that.
 *
 * Greptile round 1 P2 finding on PR 2: the beacon must not race
 * with the cron. Idempotent on `lastSeenAt` (just patches the
 * timestamp). Returns null silently when unauthorized so the
 * beacon's failure mode is indistinguishable from success on the
 * wire — `beforeunload` requests can be aborted by the browser.
 */
export const recordQuestionnaireSeen = mutation({
  args: {
    onboardingId: v.id("adminOnboardings"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const submission = await loadDraftOrNull(ctx, args.onboardingId);
    if (!submission) return null;
    if (submission.studentClerkId !== identity.subject) return null;
    if (submission.status === "submitted") return null;
    await ctx.db.patch(submission._id, { lastSeenAt: Date.now() });
    return null;
  },
});

/**
 * PR 12 PR 4b — internal helpers for the reminder cron. Bearer-auth
 * via the HTTP actions in `convex/http.ts:httpOnboardingStaleQuestionnaire`
 * etc. The HTTP layer is the auth gate; these functions trust that
 * the caller is the platform cron and run unscoped.
 *
 * Read strategy: scans the `by_status_updatedAt` index for
 * `status === "draft"`, then filters in JS by
 * `ONBOARDING_REMINDER_STALE_MS` and `reminderCount <
 * ONBOARDING_REMINDER_MAX_COUNT`. The Convex query is bounded by the
 * index partition; real cron cadence is hourly and the cron processes
 * whatever the scan returns without pagination (the cap is small).
 */

const STALE_BATCH_LIMIT = 100;

export const listStaleDraftsForReminder = internalQuery({
  args: {},
  returns: v.array(
    v.object({
      onboardingId: v.id("adminOnboardings"),
      submissionId: v.id("onboardingQuestionnaireSubmissions"),
      studentEmail: v.string(),
      studentName: v.union(v.string(), v.null()),
      reminderCount: v.number(),
      lastSeenAt: v.union(v.number(), v.null()),
    })
  ),
  handler: async (ctx) => {
    const now = Date.now();
    const staleCutoff = now - ONBOARDING_REMINDER_STALE_MS;
    const minIntervalCutoff = now - ONBOARDING_REMINDER_MIN_INTERVAL_MS;

    const rows = await ctx.db
      .query("onboardingQuestionnaireSubmissions")
      .withIndex("by_status_updatedAt", (q) => q.eq("status", "draft"))
      .collect();

    const candidates: Array<{
      onboardingId: Id<"adminOnboardings">;
      submissionId: Id<"onboardingQuestionnaireSubmissions">;
      studentEmail: string;
      studentName: string | null;
      reminderCount: number;
      lastSeenAt: number | null;
    }> = [];

    for (const row of rows) {
      const reminderCount = row.reminderCount ?? 0;
      if (reminderCount >= ONBOARDING_REMINDER_MAX_COUNT) continue;
      // Either: never seen (`lastSeenAt` undefined), or seen long
      // enough ago that the row is stale again.
      const isFresh =
        row.lastSeenAt !== undefined && row.lastSeenAt >= staleCutoff;
      if (isFresh) continue;
      // Don't double-fire reminders: respect the min interval since
      // the last send so a slow scan can't spam a student.
      if (
        row.lastReminderSentAt !== undefined &&
        row.lastReminderSentAt > minIntervalCutoff
      ) {
        continue;
      }

      const onboarding = await ctx.db.get(row.onboardingId);
      if (!onboarding) continue;

      const student = onboarding.assignedStudentClerkId
        ? await ctx.db
            .query("users")
            .withIndex("by_clerkId", (q) =>
              q.eq("clerkId", onboarding.assignedStudentClerkId!)
            )
            .first()
        : null;

      candidates.push({
        onboardingId: row.onboardingId,
        submissionId: row._id,
        studentEmail: student?.email ?? onboarding.email,
        studentName: student?.firstName
          ? `${student.firstName}${student.lastName ? " " + student.lastName : ""}`
          : null,
        reminderCount,
        lastSeenAt: row.lastSeenAt ?? null,
      });

      if (candidates.length >= STALE_BATCH_LIMIT) break;
    }

    return candidates;
  },
});

/**
 * Read-only status read used by the cron's per-row race-safe re-check
 * (see `onboarding-questionnaire-reminders.ts:fetchReadOnlyDraftStatus`).
 * Returns `null` if the submission row is missing or has been
 * submitted since the scan.
 */
export const getDraftStatusForReminder = internalQuery({
  args: { onboardingId: v.id("adminOnboardings") },
  returns: v.union(v.literal("draft"), v.literal("submitted"), v.null()),
  handler: async (ctx, args) => {
    const sub = await ctx.db
      .query("onboardingQuestionnaireSubmissions")
      .withIndex("by_onboardingId", (q) => q.eq("onboardingId", args.onboardingId))
      .first();
    if (!sub) return null;
    return sub.status;
  },
});

/**
 * Patch `lastReminderSentAt` + `reminderCount` after a successful
 * send. Idempotent on `next` (advancing twice with the same `next`
 * is a no-op the second time, so a cron retry that re-sent the same
 * reminder email won't double-count).
 */
export const markReminderSent = internalMutation({
  args: {
    submissionId: v.id("onboardingQuestionnaireSubmissions"),
    next: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const sub = await ctx.db.get(args.submissionId);
    if (!sub) return null;
    if (sub.status === "submitted") return null;
    if ((sub.reminderCount ?? 0) + 1 !== args.next) return null;
    await ctx.db.patch(args.submissionId, {
      lastReminderSentAt: Date.now(),
      reminderCount: args.next,
    });
    return null;
  },
});
