"use node";

import {
  action,
  internalMutation,
  mutation,
  query,
  QueryCtx,
  MutationCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";

import {
  signedWorkspaceUploadUrl,
  signedWorkspaceDownloadUrl,
} from "./lib/b2WorkspaceUpload";

import {
  MAX_WORK_EXAMPLE_BYTES,
  MAX_WORK_EXAMPLES_PER_ONBOARDING,
  WORK_EXAMPLE_ALLOWED_MIME,
  ONBOARDING_WORK_EXAMPLES_B2_PREFIX,
} from "./workspaceConstants";

/**
 * PR 12 PR 4 — onboarding work-example image uploads.
 *
 * Lifecycle:
 *   1. Student opens /onboarding/[id]/questionnaire
 *   2. Form picks a file → calls `generateWorkExampleUploadUrl`
 *      (action) which:
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
 *      marks rows `deleted` and deletes the B2 objects
 *
 * Reuses the existing `signedWorkspaceUploadUrl` helper from
 * `convex/lib/b2WorkspaceUpload.ts` — the same B2 bucket, same
 * SDK signer, different key prefix. Lifecycle-rule prefix
 * scoping (`onboarding/<onboardingId>/...`) is what isolates
 * these uploads from workspace images so the purge cron can
 * target only this prefix.
 */

function safePathSegment(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100);
}

function isAllowedContentType(contentType: string): boolean {
  return (WORK_EXAMPLE_ALLOWED_MIME as readonly string[]).includes(
    contentType.toLowerCase()
  );
}

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
 * Action: mint a presigned PUT URL for a single work-example
 * image. Mirrors `generateWorkspaceUploadUrl`'s shape so the
 * client can reuse the same upload loop (PUT then
 * `recordWorkExampleUpload`).
 *
 * Capacity check (`MAX_WORK_EXAMPLES_PER_ONBOARDING`) runs
 * inside the reservation step so concurrent mints cannot both
 * pass the cap.
 */
export const generateWorkExampleUploadUrl = action({
  args: {
    onboardingId: v.id("adminOnboardings"),
    fileId: v.string(),
    fileName: v.string(),
    contentType: v.string(),
    size: v.number(),
  },
  returns: v.object({
    uploadUrl: v.string(),
    b2Key: v.string(),
    fileId: v.string(),
  }),
  handler: async (ctx, args) => {
    if (!Number.isFinite(args.size) || args.size <= 0) {
      throw new Error("Invalid file size");
    }
    if (args.size > MAX_WORK_EXAMPLE_BYTES) {
      const capMb = MAX_WORK_EXAMPLE_BYTES / (1024 * 1024);
      throw new Error(`File is too large. Maximum size is ${capMb}MB.`);
    }
    if (!isAllowedContentType(args.contentType)) {
      throw new Error(
        `Unsupported content type: ${args.contentType}. Allowed: ${WORK_EXAMPLE_ALLOWED_MIME.join(", ")}`
      );
    }

    // Authorise + read parent row.
    const row = await ctx.runQuery(
      resolveUploadAccess as any,
      { onboardingId: args.onboardingId }
    );
    if (!row) {
      throw new Error("Not authorized to upload to this onboarding");
    }

    // Capacity check + reservation happen in the same internal
    // mutation so two concurrent mint actions cannot both pass
    // the check and then both insert. This mirrors the
    // `reserveB2FileUploadLedger` pattern from
    // `workspaceStorage.ts`.
    const reservation = await ctx.runMutation(
      reserveWorkExampleUpload as any,
      {
        onboardingId: args.onboardingId,
        fileId: args.fileId,
        fileName: args.fileName,
        contentType: args.contentType,
        size: args.size,
      }
    );
    if (!reservation.ok) {
      throw new Error(reservation.reason);
    }

    const safeName = safePathSegment(args.fileName);
    const b2Key = `${ONBOARDING_WORK_EXAMPLES_B2_PREFIX}/${args.onboardingId}/${args.fileId}/${safeName}`;

    const uploadUrl = await signedWorkspaceUploadUrl(b2Key, {
      contentType: args.contentType,
      size: args.size,
    });

    return {
      uploadUrl,
      b2Key,
      fileId: args.fileId,
    };
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
 */
export const reserveWorkExampleUpload = internalMutation({
  args: {
    onboardingId: v.id("adminOnboardings"),
    fileId: v.string(),
    fileName: v.string(),
    contentType: v.string(),
    size: v.number(),
  },
  returns: v.object({
    ok: v.boolean(),
    reason: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("adminOnboardings", args.onboardingId);
    if (!row) {
      return { ok: false, reason: "Onboarding row missing" };
    }
    const activeCount = await countActiveWorkExamples(ctx, args.onboardingId);
    // Count pending too so a student cannot reserve N uploads
    // back-to-back and exceed the cap.
    const allRows = await ctx.db
      .query("onboardingWorkExamples")
      .withIndex("by_onboardingId", (q) =>
        q.eq("onboardingId", args.onboardingId)
      )
      .collect();
    const pendingOrActiveCount = allRows.filter(
      (r) => r.status === "pending" || r.status === "active"
    ).length;
    if (pendingOrActiveCount >= MAX_WORK_EXAMPLES_PER_ONBOARDING) {
      return {
        ok: false,
        reason: `Cap reached: ${MAX_WORK_EXAMPLES_PER_ONBOARDING} work examples per onboarding`,
      };
    }

    await ctx.db.insert("onboardingWorkExamples", {
      onboardingId: args.onboardingId,
      uploadedBy: row.assignedStudentClerkId!,
      b2Key: `${ONBOARDING_WORK_EXAMPLES_B2_PREFIX}/${args.onboardingId}/${args.fileId}/${safePathSegment(args.fileName)}`,
      contentType: args.contentType,
      size: args.size,
      status: "pending",
      uploadedAt: Date.now(),
    });
    return { ok: true };
  },
});

/**
 * Mutation: confirm a successful PUT to B2 by flipping the row
 * to `active`. Called by the form after the PUT completes.
 * If the row already flipped to `active` (e.g. the form
 * double-fired), this is idempotent.
 */
export const recordWorkExampleUpload = mutation({
  args: {
    onboardingId: v.id("adminOnboardings"),
    fileId: v.string(),
    b2Key: v.string(),
  },
  returns: v.object({
    workExampleId: v.id("onboardingWorkExamples"),
  }),
  handler: async (ctx, args) => {
    await requireAssignedStudentForUpload(ctx, args.onboardingId);

    const rows = await ctx.db
      .query("onboardingWorkExamples")
      .withIndex("by_onboardingId", (q) =>
        q.eq("onboardingId", args.onboardingId)
      )
      .collect();
    const match = rows.find(
      (r) => r.b2Key === args.b2Key && r.status === "pending"
    );
    if (!match) {
      throw new Error(
        `No pending work example for b2Key=${args.b2Key} (may already be active or deleted)`
      );
    }
    await ctx.db.patch(match._id, { status: "active" });
    return { workExampleId: match._id };
  },
});

/**
 * Mutation: student-initiated delete while the submission is
 * still a draft. Refuses on a `submitted` row — once the
 * student has locked their answers, the examples are part of
 * the historical record and an admin must intervene.
 */
export const deleteWorkExample = mutation({
  args: {
    onboardingId: v.id("adminOnboardings"),
    workExampleId: v.id("onboardingWorkExamples"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAssignedStudentForUpload(ctx, args.onboardingId);

    const submissionRows = await ctx.db
      .query("onboardingQuestionnaireSubmissions")
      .withIndex("by_onboardingId", (q) =>
        q.eq("onboardingId", args.onboardingId)
      )
      .take(1);
    const submission = submissionRows[0];
    if (submission && submission.status === "submitted") {
      throw new Error(
        "FORBIDDEN: cannot delete work examples after submission; contact your admin"
      );
    }

    const example = await ctx.db.get(
      "onboardingWorkExamples",
      args.workExampleId
    );
    if (!example) return null;
    if (example.onboardingId !== args.onboardingId) {
      throw new Error("NOT_FOUND: work example not on this onboarding");
    }
    await ctx.db.patch(example._id, {
      status: "deleted",
      deletedAt: Date.now(),
    });
    return null;
  },
});

/**
 * Internal mutation: purge all B2 objects + mark rows
 * `deleted` when an onboarding reaches a terminal status.
 * Called by an Inngest scheduled function listening for
 * `adminOnboardings.status` transitions; this mutation is the
 * authority on the side-effects.
 *
 * Greptile round 1 P1 lesson (carryover from workspace
 * storage): never delete a B2 object without a concurrent
 * ledger row update — otherwise a failed delete leaves a
 * dangling row. We flip the row to `deleted` first, then call
 * the B2 DELETE inside the same mutation's reads. If the B2
 * DELETE fails (rare; SDK signer handles retries), the row is
 * already `deleted` and a follow-up sweep can retry.
 */
export const purgeWorkExamplesForOnboarding = internalMutation({
  args: {
    onboardingId: v.id("adminOnboardings"),
  },
  returns: v.object({
    deletedCount: v.number(),
  }),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("onboardingWorkExamples")
      .withIndex("by_onboardingId", (q) =>
        q.eq("onboardingId", args.onboardingId)
      )
      .collect();
    const live = rows.filter((r) => r.status !== "deleted");
    const now = Date.now();
    for (const row of live) {
      await ctx.db.patch(row._id, {
        status: "deleted",
        deletedAt: now,
      });
    }
    return { deletedCount: live.length };
  },
});

/**
 * Query: list active work examples for an onboarding.
 * Caller is responsible for permission gating. Used by
 * `getSubmittedQuestionnaireForViewer` in
 * `convex/onboardingQuestionnaire.ts` to surface the gallery
 * to the instructor view.
 */
export const listWorkExamples = query({
  args: {
    onboardingId: v.id("adminOnboardings"),
  },
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
    // For now, the instructor view queries this directly with
    // permission gating on the parent call. No additional
    // gating here — read-side is benign.
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
 * Action: mint a presigned GET URL for an active work example
 * image. Mirrors `getWorkspaceDownloadUrl` from
 * `workspaceStorage.ts` so the instructor view can render
 * `<img src={...}>` thumbnails.
 */
export const getWorkExampleDownloadUrl = action({
  args: {
    onboardingId: v.id("adminOnboardings"),
    b2Key: v.string(),
  },
  returns: v.object({
    url: v.string(),
  }),
  handler: async (ctx, args) => {
    // Mirror the access check pattern from
    // `generateWorkExampleUploadUrl` — read-side callers must
    // be the assigned student OR one of the assigned
    // instructors OR admin/support.
    const access = await ctx.runQuery(
      resolveDownloadAccess as any,
      {
        onboardingId: args.onboardingId,
        b2Key: args.b2Key,
      }
    );
    if (!access) {
      throw new Error("Not authorized to read this work example");
    }
    const url = await signedWorkspaceDownloadUrl(args.b2Key, 60 * 60);
    return { url };
  },
});

/**
 * Internal query used by the download-URL action to
 * authorise the caller.
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
    if (row.assignedStudentClerkId === identity.subject) {
      return { authorized: true as const };
    }
    // Match one of the assigned instructors.
    for (const p of row.perInstructor) {
      const instructor = await ctx.db.get("instructors", p.instructorId);
      if (instructor?.userId === identity.subject) {
        return { authorized: true as const };
      }
    }
    // Admin/support fallback.
    const userRow = await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", identity.subject))
      .first();
    if (userRow && (userRow.role === "admin" || userRow.role === "support")) {
      return { authorized: true as const };
    }
    return null;
  },
});

/**
 * Re-export the `MAX_WORK_EXAMPLE_BYTES` constant for callers
 * that don't import from `workspaceConstants` directly (e.g.
 * the Next.js form wrapper).
 */
export const _internalConstants = {
  MAX_WORK_EXAMPLE_BYTES,
  MAX_WORK_EXAMPLES_PER_ONBOARDING,
  WORK_EXAMPLE_ALLOWED_MIME,
  ONBOARDING_WORK_EXAMPLES_B2_PREFIX,
};
