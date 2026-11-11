import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
  QueryCtx,
  MutationCtx,
} from "./_generated/server";
import { v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";

import {
  MAX_WORK_EXAMPLES_PER_ONBOARDING,
  ONBOARDING_WORK_EXAMPLES_B2_PREFIX,
  ONBOARDING_WORK_EXAMPLE_RETENTION_MS,
} from "./workspaceConstants";

/**
 * Greptile P1 follow-up: staff records can have
 * `clerkId !== userId` (split identity — e.g. one operator for
 * two products). The PR 3 status page (`getOnboardingView` →
 * `isAdminOrSupport`) only consults `by_userId`. To stay
 * consistent with that gate, this helper checks BOTH indexes and
 * returns whichever row exists.
 */
async function lookupStaffRole(
  ctx: QueryCtx,
  identitySubject: string
): Promise<"admin" | "support" | null> {
  const byClerk = await ctx.db
    .query("users")
    .withIndex("by_clerkId", (q) => q.eq("clerkId", identitySubject))
    .first();
  if (byClerk && (byClerk.role === "admin" || byClerk.role === "support")) {
    return byClerk.role;
  }
  const byUserId = await ctx.db
    .query("users")
    .withIndex("by_userId", (q) => q.eq("userId", identitySubject))
    .first();
  if (byUserId && (byUserId.role === "admin" || byUserId.role === "support")) {
    return byUserId.role;
  }
  return null;
}

/**
 * Shared viewer gate for every staff/student read on an onboarding.
 *
 * Mirrors `getOnboardingView` (PR 3): the assigned student, any of the
 * assigned instructors, or an admin/support user may read. Returns the
 * onboarding row when the caller is authorised, or `null` when the row
 * is missing or the caller has no access — callers translate `null`
 * into their surface's "not found / empty" response so existence is
 * never leaked.
 *
 * Extracted so `listWorkExamples`, `getWorkExampleByIdForViewer`,
 * `resolveDownloadAccess`, and the artwork-export module all share one
 * definition. The previous inline copies had to be kept in sync by
 * hand, which is exactly how an auth gate drifts.
 */
export async function getAuthorizedOnboardingRow(
  ctx: QueryCtx,
  onboardingId: Id<"adminOnboardings">,
  subject: string
): Promise<Doc<"adminOnboardings"> | null> {
  const row = await ctx.db.get(onboardingId);
  if (!row) return null;

  if (row.assignedStudentClerkId === subject) return row;

  for (const p of row.perInstructor) {
    const instructor = await ctx.db.get("instructors", p.instructorId);
    if (instructor?.userId === subject) return row;
  }

  if (await lookupStaffRole(ctx, subject)) return row;

  return null;
}

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
 * Greptile P1 follow-up: action-side auth gate for the record
 * flow. Mirrors `requireAssignedStudentForUpload` but as an
 * internal `query` so an action can call it via
 * `ctx.runQuery(internal.X)`. Returns the onboarding doc (or
 * `null` when unauthorized) so the caller can decide whether
 * to throw — the original `require*` helper throws because
 * mutations shouldn't leak existence, but actions can return
 * null and let the caller decide. Internal because it exposes
 * `assignedStudentClerkId` and the underlying onboarding
 * status — Greptile round-7 P1.
 */
export const requireAssignedStudentForUploadQuery = internalQuery({
  args: { onboardingId: v.id("adminOnboardings") },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("adminOnboardings"),
      email: v.string(),
      status: v.union(
        v.literal("queued"),
        v.literal("processing"),
        v.literal("completed"),
        v.literal("failed"),
        v.literal("cancelled")
      ),
      assignedStudentClerkId: v.union(v.string(), v.null()),
    })
  ),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const row = await ctx.db.get("adminOnboardings", args.onboardingId);
    if (!row) return null;
    if (row.assignedStudentClerkId !== identity.subject) return null;
    return {
      _id: row._id,
      email: row.email,
      status: row.status,
      assignedStudentClerkId: row.assignedStudentClerkId ?? null,
    };
  },
});

/**
 * Greptile P1 follow-up (round 7): make this an `internalQuery`
 * so it can't be called directly from a client. The previous
 * shape exposed `studentClerkId` + `b2Key` to anyone with a
 * work-example ID, bypassing the auth checks in
 * `listWorkExamples`.
 */
export const getWorkExampleByIdInternal = internalQuery({
  args: { workExampleId: v.id("onboardingWorkExamples") },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("onboardingWorkExamples"),
      onboardingId: v.id("adminOnboardings"),
      studentClerkId: v.string(),
      status: v.union(
        v.literal("pending"),
        v.literal("active"),
        v.literal("deleted")
      ),
      b2Key: v.string(),
    })
  ),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("onboardingWorkExamples", args.workExampleId);
    if (!row) return null;
    return {
      _id: row._id,
      onboardingId: row.onboardingId,
      studentClerkId: row.studentClerkId,
      status: row.status,
      b2Key: row.b2Key,
    };
  },
});

/**
 * Greptile P1 follow-up: internal mutation that flips a work
 * example row to `active`. Called from the action wrapper
 * after the B2 HEAD succeeds. Re-reads the row inside the
 * transaction so a student-initiated deletion that landed
 * between the action's HEAD check and this patch is not
 * silently undone — round-8 P1: a late PUT confirmation was
 * setting `status = "active"` on a row the student had
 * already deleted during the B2 wait, which brought the
 * orphan back into the active set.
 */
export const markWorkExampleActive = internalMutation({
  args: { workExampleId: v.id("onboardingWorkExamples") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("onboardingWorkExamples", args.workExampleId);
    if (!row) return null;
    // Already-active is idempotent; deleted stays deleted.
    if (row.status === "active" || row.status === "deleted") {
      return null;
    }
    await ctx.db.patch(args.workExampleId, { status: "active" });
    return null;
  },
});

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

    const safeName = args.fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100);
    const b2Key = `${ONBOARDING_WORK_EXAMPLES_B2_PREFIX}/${args.onboardingId}/${args.fileId}/${safeName}`;

    // Greptile round-13 P1 #4: collapse duplicates on b2Key for
    // the same onboarding. The action mints a PUT URL based on
    // (fileId, fileName); if the caller repeats the same values
    // they get the same b2Key, and without this check we'd
    // insert N rows that all reference one object — letting a
    // single uploaded image count as N required work examples.
    // Greptile round-27 P2 #3: run this lookup BEFORE the
    // capacity check. An idempotent retry (same b2Key as an
    // already-pending row) should not consume a capacity
    // slot a second time, and once 6 pending + active rows
    // accumulate the previous code returned a capacity error
    // even when the retry was just asking for the same row.
    // Greptile round-27 P1 #12: filter out deleted rows
    // BEFORE .first() — the by_onboardingId_b2Key index
    // doesn't include status, so the first match can be
    // a deleted row whose entry still occupies the slot.
    // Without this filter, deleting an image and re-uploading
    // with the same fileId+fileName would insert a new live
    // row while the deleted row stayed at the front of the
    // index, so subsequent retries would keep inserting
    // duplicates (one image counted several times toward
    // the required count).
    const candidates = await ctx.db
      .query("onboardingWorkExamples")
      .withIndex("by_onboardingId_b2Key", (q) =>
        q.eq("onboardingId", args.onboardingId).eq("b2Key", b2Key)
      )
      .collect();
    const existing = candidates.find(
      (row) => row.status !== "deleted"
    );
    if (existing) {
      return {
        ok: true as const,
        workExampleId: existing._id,
        b2Key,
      };
    }

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
/**
 * Greptile P1 follow-up (round 6): the B2 HEAD check that
 * prevents accepting an un-uploaded row is external IO and
 * doesn't belong in a mutation (mutations run on V8; actions
 * run on Node with `fetch` available). Convert this entry
 * point to an `action` so the IO is reliable. The auth gate
 * still runs server-side via `runQuery(requireAssignedStudent
 * ForUpload)` and the patch runs in an internal `runMutation`
 * so the row change stays transactional.
 *
 * The client-facing API shape is unchanged: callers invoke
 * `convex.action(api.onboardingWorkExamples.recordWorkExample
 * Upload, args)` (see
 * `apps/platform/app/api/onboarding/[id]/work-examples/route.ts`).
 */
export const recordWorkExampleUpload = action({
  args: {
    onboardingId: v.id("adminOnboardings"),
    workExampleId: v.id("onboardingWorkExamples"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Greptile round-11 P1 follow-up: reference the helpers via
    // `internal.X.Y` instead of the registered function values.
    // The `as any` cast on the reference (not the function
    // value) handles the local stale `_generated/api.d.ts`
    // before CI regenerates it.
    const row = await ctx.runQuery(
      (internal as any).onboardingWorkExamples.requireAssignedStudentForUploadQuery,
      {
        onboardingId: args.onboardingId,
      }
    );
    if (!row) {
      throw new Error("NOT_FOUND: not your onboarding");
    }
    const work = await ctx.runQuery(
      (internal as any).onboardingWorkExamples.getWorkExampleByIdInternal,
      {
        workExampleId: args.workExampleId,
      }
    );
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

    // Verify B2 has the object before flipping the row. The
    // helper catches NotFound AND any transient SDK errors so
    // a flaky HEAD never silently accepts an un-uploaded row.
    const check = await ctx.runAction(
      (internal as any).onboardingWorkExamplesActions.checkWorkExampleUploaded,
      {
        b2Key: work.b2Key,
      }
    );
    if (!check.exists) {
      throw new Error(
        "Upload not complete: the file is not yet in storage. Please retry the upload."
      );
    }

    await ctx.runMutation(
      (internal as any).onboardingWorkExamples.markWorkExampleActive,
      {
        workExampleId: args.workExampleId,
      }
    );
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

    // The row is hidden immediately; the B2 object is removed by the
    // 6-month retention sweep (`cleanup-expired-onboarding-artwork`),
    // which also covers soft-deleted rows. Deleting here would race a
    // download from a reviewer mid-request.
    return null;
  },
});

/**
 * Internal mutation: purge all rows for an onboarding when the
 * admin onboarding hits a terminal status (`completed`,
 * `cancelled`, `failed`). Soft-deletes the DB rows (they stop resolving
 * immediately); the B2 objects are removed by the 6-month retention
 * sweep, which includes `deleted` rows that have not been stamped with
 * `artifactDeletedAt` yet.
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
 * Retention sweep data: the oldest live work-example rows older than
 * the 6-month upload window.
 *
 * Internal and task-facing (`POST /onboarding/work-examples/expired`,
 * gated by `CONVEX_HTTP_KEY`). The Trigger job deletes each B2 object
 * (all versions) and then calls `markWorkExamplesExpired`.
 *
 * Uses `by_status_uploadedAt` so the sweep scans only live rows and
 * stops at the retention cutoff; rows already marked deleted never enter
 * the batch. Results are oldest-first so a backlog drains predictably.
 */
export const listExpiredWorkExamples = internalQuery({
  args: {
    // Evaluation time in epoch ms (injectable for tests).
    now: v.number(),
    limit: v.number(),
  },
  returns: v.array(
    v.object({
      _id: v.id("onboardingWorkExamples"),
      onboardingId: v.id("adminOnboardings"),
      b2Key: v.string(),
      uploadedAt: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    const cutoff = args.now - ONBOARDING_WORK_EXAMPLE_RETENTION_MS;
    const limit = Math.max(1, Math.min(args.limit, 200));
    const expired: Array<{
      _id: Id<"onboardingWorkExamples">;
      onboardingId: Id<"adminOnboardings">;
      b2Key: string;
      uploadedAt: number;
    }> = [];

    // Include `deleted` rows: cancellation only hides the row, so the
    // object can still be in B2. The `artifactDeletedAt` stamp removes
    // them once the bytes are gone.
    for (const status of ["active", "pending", "deleted"] as const) {
      const rows = await ctx.db
        .query("onboardingWorkExamples")
        .withIndex("by_status_uploadedAt", (q) =>
          q.eq("status", status).lt("uploadedAt", cutoff)
        )
        .filter((q) => q.eq(q.field("artifactDeletedAt"), undefined))
        .order("asc")
        .take(limit);
      for (const row of rows) {
        expired.push({
          _id: row._id,
          onboardingId: row.onboardingId,
          b2Key: row.b2Key,
          uploadedAt: row.uploadedAt,
        });
      }
    }

    return expired
      .sort((a, b) => a.uploadedAt - b.uploadedAt)
      .slice(0, limit);
  },
});

/**
 * Marks work examples deleted after their B2 objects were removed by the
 * retention sweep. Idempotent: already-deleted rows are skipped, so a
 * retried batch is safe.
 */
export const markWorkExamplesExpired = internalMutation({
  args: {
    workExampleIds: v.array(v.id("onboardingWorkExamples")),
    // Injectable for tests.
    now: v.optional(v.number()),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    const deletedAt = args.now ?? Date.now();
    let marked = 0;
    for (const id of args.workExampleIds) {
      const row = await ctx.db.get("onboardingWorkExamples", id);
      // Idempotent: a retried batch skips rows whose object was already
      // removed and stamped.
      if (!row || row.artifactDeletedAt !== undefined) continue;
      await ctx.db.patch(id, {
        // Cancellation / purge may already have hidden the row; keep
        // its original `deletedAt` in that case.
        ...(row.status === "deleted"
          ? {}
          : { status: "deleted" as const, deletedAt }),
        artifactDeletedAt: deletedAt,
      });
      marked++;
    }
    return marked;
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
      status: v.union(v.literal("pending"), v.literal("active"), v.literal("deleted")),
      fileName: v.string(),
      b2Key: v.string(),
      contentType: v.string(),
      size: v.number(),
      uploadedAt: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const row = await getAuthorizedOnboardingRow(ctx, args.onboardingId, identity.subject);
    if (!row) return [];

    // Greptile P1 #9: return every field the form needs (status +
    // fileName) so a saved-but-not-yet-active row survives a reload.
    // We still filter out terminal `deleted` rows here — the public
    // surface treats only `pending` and `active` as visible to the
    // student.
    const rows = await ctx.db
      .query("onboardingWorkExamples")
      .withIndex("by_onboardingId", (q) =>
        q.eq("onboardingId", args.onboardingId)
      )
      .collect();
    return rows
      .filter((r) => r.status !== "deleted")
      .map((r) => ({
        _id: r._id,
        status: r.status,
        fileName: r.fileName,
        b2Key: r.b2Key,
        contentType: r.contentType,
        size: r.size,
        uploadedAt: r.uploadedAt,
      }));
  },
});

/**
 * Greptile P1 #3 helper: resolve a single work example to its b2Key
 * after auth-checking the viewer. Used by the download-url API route
 * to call `getWorkExampleDownloadUrl({ b2Key })`. Returns `null` if
 * the row doesn't exist, doesn't belong to this onboarding, or the
 * viewer is unauthorized.
 */
export const getWorkExampleByIdForViewer = query({
  args: {
    onboardingId: v.id("adminOnboardings"),
    workExampleId: v.id("onboardingWorkExamples"),
  },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("onboardingWorkExamples"),
      b2Key: v.string(),
    })
  ),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const row = await getAuthorizedOnboardingRow(ctx, args.onboardingId, identity.subject);
    if (!row) return null;
    const work = await ctx.db.get("onboardingWorkExamples", args.workExampleId);
    if (!work || work.onboardingId !== args.onboardingId) return null;

    return { _id: work._id, b2Key: work.b2Key };
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
  returns: v.union(
    v.null(),
    v.object({ authorized: v.boolean(), fileName: v.optional(v.string()) })
  ),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const row = await getAuthorizedOnboardingRow(ctx, args.onboardingId, identity.subject);
    if (!row) return null;

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

    // Return the stored filename so the caller can bake a safe
    // Content-Disposition into the signed GET URL. Taking it from the
    // row (not the request) means a crafted filename can never reach
    // the header from the client.
    return { authorized: true, fileName: matching.fileName };
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
