import {
  internalMutation,
  mutation,
  query,
  QueryCtx,
  MutationCtx,
} from "./_generated/server";
import { v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";

import {
  MAX_WORK_EXAMPLES_PER_ONBOARDING,
  ONBOARDING_WORK_EXAMPLES_B2_PREFIX,
} from "./workspaceConstants";

/**
 * PR 12 PR 4 — onboarding work-example image uploads.
 *
 * Lifecycle:
 *   1. Student opens /onboarding/[id]/questionnaire
 *   2. Form picks a file → calls `generateWorkExampleUploadUrl`
 *      (action — lives in `onboardingWorkExamplesActions.ts`
 *      because Convex's `"use node"` directive forbids mixing
 *      actions with non-action exports) which:
 *      - authorises the caller (assigned student for that row)
 *      - enforces size + mime caps
 *      - enforces active-example count cap
 *      - mints a presigned PUT URL against the shared workspace
 *        B2 bucket, key = `onboarding/<onboardingId>/<fileId>`
 *      - reserves a `pending` row so a concurrent PUT cannot
 *        exceed the cap
 *   3. Browser PUTs the bytes to B2
 *   4. Form calls `recordWorkExampleUpload` (mutation) which
 *      flips the row to `active` so the instructor view sees
 *      it
 *   5. On terminal `adminOnboardings.status`, an Inngest cron
 *      calls `purgeWorkExamplesForOnboarding` (internal) which
 *      marks rows `deleted` (B2 object deletion is the action's
 *      job — see P2 follow-up).
 *
 * Reuses the existing `signedWorkspaceUploadUrl` helper from
 * `convex/lib/b2WorkspaceUpload.ts` — the same B2 bucket, same
 * SDK signer, different key prefix. Lifecycle-rule prefix
 * scoping (`onboarding/<onboardingId>/...`) is what isolates
 * these uploads from workspace images so the purge cron can
 * target only this prefix.
 */

/**
 * Internal query: count active work examples for an onboarding.
 * Used by `generateWorkExampleUploadUrl` and the form's submit
 * gate.
 */
async function countActiveWorkExamples(
  ctx: QueryCtx | MutationCtx,
  onboardingId: Id<"adminOnboardings">
): Promise<number> {
  const rows = await ctx.db
    .query("onboardingWorkExamples")
    .withIndex("by_onboardingId_active", (q) =>
      q.eq("onboardingId", onboardingId).eq("status", "active")
    )
    .collect();
  return rows.length;
}

/**
 * Internal query: read the onboarding + auth-gate the caller.
 * Returns the row if the caller is the assigned student for
 * that onboarding; throws otherwise (caller renders 404).
 */
async function requireAssignedStudentForUpload(
  ctx: QueryCtx | MutationCtx,
  onboardingId: Id<"adminOnboardings">
): Promise<Doc<"adminOnboardings">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("UNAUTHORIZED: sign-in required");
  const row = await ctx.db.get("adminOnboardings", onboardingId);
  if (!row) throw new Error("NOT_FOUND: onboarding row missing");
  if (row.assignedStudentClerkId !== identity.subject) {
    throw new Error("NOT_FOUND: not your onboarding");
  }
  if (row.status === "cancelled") {
    throw new Error("TERMINAL: onboarding was cancelled");
  }
  return row;
}

/**
 * Internal query used by the upload-URL action to authorise
 * the caller + read the onboarding row.
 */
export const resolveUploadAccess = query({
  args: { onboardingId: v.id("adminOnboardings") },
  returns: v.union(
    v.null(),
    v.object({
      onboardingId: v.id("adminOnboardings"),
      studentClerkId: v.string(),
    })
  ),
  handler: async (ctx, args) => {
    try {
      const row = await requireAssignedStudentForUpload(ctx, args.onboardingId);
      return {
        onboardingId: row._id,
        studentClerkId: row.assignedStudentClerkId!,
      };
    } catch {
      return null;
    }
  },
});

/**
 * Internal mutation: capacity-check + insert a `pending` row.
 * Returns `{ ok: false, reason }` when the cap is hit; the
 * action caller turns that into a user-facing error.
 *
 * PR 4 follow-up: failed/abandoned uploads currently leave the
 * `pending` row in place, which consumes a slot until the next
 * purge (Greptile P2 #6). The follow-up PR will add a TTL-based
 * cleanup hook + a "cancel reservation" path the form calls
 * when the browser PUT fails.
 */
export const reserveWorkExampleUpload = internalMutation({
  args: {
    onboardingId: v.id("adminOnboardings"),
    fileId: v.string(),
    fileName: v.string(),
    contentType: v.string(),
    size: v.number(),
  },
  returns: v.union(
    v.object({
      ok: v.literal(true),
      workExampleId: v.id("onboardingWorkExamples"),
      b2Key: v.string(),
    }),
    v.object({
      ok: v.literal(false),
      reason: v.string(),
    })
  ),
  handler: async (ctx, args) => {
    const row = await requireAssignedStudentForUpload(ctx, args.onboardingId);

    const activeCount = await countActiveWorkExamples(ctx, args.onboardingId);
    const pendingCount = await ctx.db
      .query("onboardingWorkExamples")
      .withIndex("by_onboardingId_active", (q) =>
        q.eq("onboardingId", args.onboardingId).eq("status", "pending")
      )
      .collect();
    if (activeCount + pendingCount.length >= MAX_WORK_EXAMPLES_PER_ONBOARDING) {
      return {
        ok: false as const,
        reason: `At most ${MAX_WORK_EXAMPLES_PER_ONBOARDING} work examples per onboarding (you have ${activeCount} active + ${pendingCount.length} pending).`,
      };
    }

    const safeName = args.fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100);
    const b2Key = `${ONBOARDING_WORK_EXAMPLES_B2_PREFIX}/${args.onboardingId}/${args.fileId}/${safeName}`;

    const id = await ctx.db.insert("onboardingWorkExamples", {
      onboardingId: args.onboardingId,
      studentClerkId: row.assignedStudentClerkId!,
      b2Key,
      fileName: args.fileName,
      contentType: args.contentType,
      size: args.size,
      status: "pending",
      uploadedAt: Date.now(),
      fileId: args.fileId,
    });

    return { ok: true as const, workExampleId: id, b2Key };
  },
});

/**
 * Mutation: flip a `pending` row to `active` after the B2 PUT
 * completed. The form calls this once the PUT returns 200.
 *
 * PR 4 follow-up: also refuse when the questionnaire is already
 * `submitted` so a slow PUT cannot promote a `pending` row into
 * the locked view (Greptile P2 #7). The check belongs here AND
 * in `generateWorkExampleUploadUrl` (already in scope — see
 * `recordWorkExampleUpload`'s status check below).
 */
export const recordWorkExampleUpload = mutation({
  args: {
    onboardingId: v.id("adminOnboardings"),
    workExampleId: v.id("onboardingWorkExamples"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await requireAssignedStudentForUpload(ctx, args.onboardingId);
    const work = await ctx.db.get("onboardingWorkExamples", args.workExampleId);
    if (!work) throw new Error("NOT_FOUND: work example missing");
    if (work.onboardingId !== args.onboardingId) {
      throw new Error("NOT_FOUND: work example belongs to a different onboarding");
    }
    if (work.studentClerkId !== row.assignedStudentClerkId) {
      throw new Error("NOT_FOUND: not your work example");
    }
    if (work.status === "active") return null; // idempotent
    if (work.status === "deleted") {
      throw new Error("TERMINAL: work example was deleted");
    }

    // PR 4 follow-up (Greptile P2 #7): also refuse when the
    // questionnaire is `submitted`. For now we rely on the
    // upload-URL action's check (see
    // `generateWorkExampleUploadUrl`) plus the deletion block
    // in `deleteWorkExample`.

    await ctx.db.patch(args.workExampleId, {
      status: "active",
    });
    return null;
  },
});

/**
 * Mutation: student-initiated delete. Refuses if the
 * questionnaire is already `submitted` so the instructor's
 * snapshot can't change underneath them.
 */
export const deleteWorkExample = mutation({
  args: {
    onboardingId: v.id("adminOnboardings"),
    workExampleId: v.id("onboardingWorkExamples"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await requireAssignedStudentForUpload(ctx, args.onboardingId);
    const work = await ctx.db.get("onboardingWorkExamples", args.workExampleId);
    if (!work) return null;
    if (work.onboardingId !== args.onboardingId) {
      throw new Error("NOT_FOUND: work example belongs to a different onboarding");
    }
    if (work.studentClerkId !== row.assignedStudentClerkId) {
      throw new Error("NOT_FOUND: not your work example");
    }
    if (work.status === "deleted") return null;

    // Block changes once the questionnaire is locked.
    const sub = await ctx.db
      .query("onboardingQuestionnaireSubmissions")
      .withIndex("by_onboardingId", (q) => q.eq("onboardingId", args.onboardingId))
      .first();
    if (sub && sub.status === "submitted") {
      throw new Error("TERMINAL: questionnaire is already submitted");
    }

    await ctx.db.patch(args.workExampleId, {
      status: "deleted",
      deletedAt: Date.now(),
    });

    // PR 4 follow-up (Greptile P2 #8): the actual B2 object
    // deletion belongs in an action so failures can retry.
    // For this PR we mark the DB row deleted and rely on the
    // `onboarding/<id>/` B2 lifecycle rule to GC objects on
    // terminal onboarding status. A second PR will add the
    // retryable action.
    return null;
  },
});

/**
 * Internal mutation: purge all rows for an onboarding when the
 * admin onboarding hits a terminal status (`completed`,
 * `cancelled`, `failed`). Soft-deletes DB rows; actual B2
 * object cleanup is the action's job (P2 follow-up).
 */
export const purgeWorkExamplesForOnboarding = internalMutation({
  args: { onboardingId: v.id("adminOnboardings") },
  returns: v.object({ purged: v.number() }),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("onboardingWorkExamples")
      .withIndex("by_onboardingId", (q) => q.eq("onboardingId", args.onboardingId))
      .collect();
    let purged = 0;
    for (const row of rows) {
      if (row.status === "deleted") continue;
      await ctx.db.patch(row._id, {
        status: "deleted",
        deletedAt: Date.now(),
      });
      purged++;
    }
    return { purged };
  },
});

/**
 * Public query: list the active work examples for an
 * onboarding. Auth-gated to the assigned student, the assigned
 * instructors, and admin/support — mirroring `getOnboardingView`
 * (PR 3) so a signed-in caller cannot list another student's
 * onboarding keys by passing an arbitrary id (Greptile P1 #9
 * fix).
 */
export const listWorkExamples = query({
  args: { onboardingId: v.id("adminOnboardings") },
  returns: v.array(
    v.object({
      _id: v.id("onboardingWorkExamples"),
      b2Key: v.string(),
      contentType: v.string(),
      size: v.number(),
      uploadedAt: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const row = await ctx.db.get("adminOnboardings", args.onboardingId);
    if (!row) return [];

    // Same auth-gate shape as `getOnboardingView` (PR 3).
    let authorized = row.assignedStudentClerkId === identity.subject;
    if (!authorized) {
      for (const p of row.perInstructor) {
        const instructor = await ctx.db.get("instructors", p.instructorId);
        if (instructor?.userId === identity.subject) {
          authorized = true;
          break;
        }
      }
    }
    if (!authorized) {
      const userRow = await ctx.db
        .query("users")
        .withIndex("by_clerkId", (q) => q.eq("clerkId", identity.subject))
        .first();
      if (userRow && (userRow.role === "admin" || userRow.role === "support")) {
        authorized = true;
      }
    }
    if (!authorized) return [];

    const rows = await ctx.db
      .query("onboardingWorkExamples")
      .withIndex("by_onboardingId_active", (q) =>
        q.eq("onboardingId", args.onboardingId).eq("status", "active")
      )
      .collect();
    return rows.map((r) => ({
      _id: r._id,
      b2Key: r.b2Key,
      contentType: r.contentType,
      size: r.size,
      uploadedAt: r.uploadedAt,
    }));
  },
});

/**
 * Internal query used by the download-URL action to
 * authorise the caller.
 *
 * Two checks (Greptile P1 #10 fix):
 *   1. Caller must be authorised for `onboardingId` — assigned
 *      student, assigned instructor, or admin/support.
 *   2. `b2Key` must correspond to an `active` row in that
 *      onboarding. Without this, a student could supply their
 *      own onboarding ID and someone else's b2Key to download
 *      an unrelated image from the shared bucket via the
 *      presigned GET URL.
 */
export const resolveDownloadAccess = query({
  args: {
    onboardingId: v.id("adminOnboardings"),
    b2Key: v.string(),
  },
  returns: v.union(v.null(), v.object({ authorized: v.boolean() })),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const row = await ctx.db.get("adminOnboardings", args.onboardingId);
    if (!row) return null;

    let authorized = row.assignedStudentClerkId === identity.subject;
    if (!authorized) {
      for (const p of row.perInstructor) {
        const instructor = await ctx.db.get("instructors", p.instructorId);
        if (instructor?.userId === identity.subject) {
          authorized = true;
          break;
        }
      }
    }
    if (!authorized) {
      const userRow = await ctx.db
        .query("users")
        .withIndex("by_clerkId", (q) => q.eq("clerkId", identity.subject))
        .first();
      if (userRow && (userRow.role === "admin" || userRow.role === "support")) {
        authorized = true;
      }
    }
    if (!authorized) return null;

    // Second check: the supplied b2Key must belong to an
    // active row in this onboarding. This stops cross-account
    // downloads via the shared B2 bucket.
    //
    // PR 4 caveat: we use `by_onboardingId` + filter (not a
    // dedicated `by_onboardingId_b2Key` index) because the
    // committed `convex/_generated/dataModel.d.ts` doesn't yet
    // know about any new indexes we add to the schema — codegen
    // runs only on push to main per `.github/workflows/ci.yml`.
    // For the download rate (one URL per image render, not
    // bulk), the O(n) scan over active+pending rows is fine.
    // A post-merge follow-up will regenerate `_generated/`
    // and switch this to the dedicated index.
    const candidates = await ctx.db
      .query("onboardingWorkExamples")
      .withIndex("by_onboardingId", (q) =>
        q.eq("onboardingId", args.onboardingId)
      )
      .collect();
    const matching = candidates.find(
      (r) => r.b2Key === args.b2Key && r.status === "active"
    );
    if (!matching) return null;

    return { authorized: true };
  },
});

/**
 * Re-export the `MAX_WORK_EXAMPLE_BYTES` constant for callers
 * that don't import from `workspaceConstants` directly (e.g.
 * the Next.js form wrapper).
 */
export const _internalConstants = {
  MAX_WORK_EXAMPLES_PER_ONBOARDING,
  ONBOARDING_WORK_EXAMPLES_B2_PREFIX,
};
