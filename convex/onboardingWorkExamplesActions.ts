"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";

import {
  MAX_WORK_EXAMPLE_BYTES,
  MAX_WORK_EXAMPLES_PER_ONBOARDING,
  WORK_EXAMPLE_ALLOWED_MIME,
  ONBOARDING_WORK_EXAMPLES_B2_PREFIX,
} from "./workspaceConstants";
import {
  signedWorkspaceUploadUrl,
  signedWorkspaceDownloadUrl,
  workspaceObjectExists,
} from "./lib/b2WorkspaceUpload";

import {
  resolveUploadAccess,
  resolveDownloadAccess,
  reserveWorkExampleUpload,
} from "./onboardingWorkExamples";

/**
 * PR 12 PR 4 — actions for onboarding work-example image uploads.
 *
 * Lives in its own file because Convex's `"use node"` directive
 * only permits action exports — query / mutation / internal
 * mutation exports in a Node file would be rejected at deploy
 * time (the file lives on the Node runtime, but those function
 * kinds must run on V8). The non-action primitives stay in
 * `convex/onboardingWorkExamples.ts` and are imported here by
 * reference — the `as any` symbol-cast mirrors the
 * `convex/http.ts:61` pattern for cross-module references where
 * the committed `_generated/api.d.ts` doesn't yet know about
 * the new module (codegen runs on push to main only).
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
    // Greptile P1 #2 fix: `recordWorkExampleUpload` needs the
    // reserved row id to flip the row from `pending` → `active`
    // after the B2 PUT. Without this, the caller cannot finish
    // the upload and the row stays pending forever (the public
    // `listWorkExamples` query only returns `active` rows, so
    // the student cannot discover the orphan).
    workExampleId: v.id("onboardingWorkExamples"),
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
    const row = await ctx.runQuery(resolveUploadAccess as any, {
      onboardingId: args.onboardingId,
    });
    if (!row) {
      throw new Error("Not authorized to upload to this onboarding");
    }

    // Capacity check + reservation happen in the same internal
    // mutation so two concurrent mint actions cannot both pass
    // the check and then both insert. This mirrors the
    // `reserveB2FileUploadLedger` pattern from
    // `workspaceStorage.ts`.
    const reservation = await ctx.runMutation(reserveWorkExampleUpload as any, {
      onboardingId: args.onboardingId,
      fileId: args.fileId,
      fileName: args.fileName,
      contentType: args.contentType,
      size: args.size,
    });
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
      workExampleId: reservation.workExampleId,
    };
  },
});

/**
 * Action: mint a presigned GET URL for an active work example
 * image. Mirrors `getWorkspaceDownloadUrl` from
 * `workspaceStorage.ts` so the client can reuse the same
 * download pattern.
 *
 * Auth-gate is enforced by `resolveDownloadAccess`, which checks
 * the caller is the assigned student for that onboarding (or one
 * of the assigned instructors, or admin/support) AND that the
 * supplied `b2Key` matches an active row in that onboarding —
 * the latter check is what stops a student from supplying their
 * own onboarding ID and someone else's b2Key to download an
 * unrelated image from the shared bucket (Greptile P1 fix).
 */
export const getWorkExampleDownloadUrl = action({
  args: {
    onboardingId: v.id("adminOnboardings"),
    b2Key: v.string(),
  },
  returns: v.object({ url: v.string() }),
  handler: async (ctx, args) => {
    const access = await ctx.runQuery(resolveDownloadAccess as any, {
      onboardingId: args.onboardingId,
      b2Key: args.b2Key,
    });
    if (!access) {
      throw new Error("Not authorized to read this work example");
    }
    const url = await signedWorkspaceDownloadUrl(args.b2Key, 60 * 60);
    return { url };
  },
});

/**
 * Greptile P1 follow-up: move the B2 HEAD check out of the
 * mutation and into this action. The mutation
 * `recordWorkExampleUpload` calls this action via
 * `ctx.runAction`, then re-checks the row ownership + status
 * inside the transaction and patches to `active` on success.
 * Putting the HEAD in an action keeps external IO out of the
 * mutation path, which is more reliable for retries and avoids
 * the `fetch` failure mode that would silently mark uploads
 * as incomplete.
 */
export const checkWorkExampleUploaded = action({
  args: {
    b2Key: v.string(),
  },
  returns: v.object({ exists: v.boolean() }),
  handler: async (_ctx, args) => {
    const exists = await workspaceObjectExists(args.b2Key);
    return { exists };
  },
});
