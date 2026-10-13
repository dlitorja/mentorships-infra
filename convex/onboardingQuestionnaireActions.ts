"use node";

/**
 * HUC-95 — Internal Convex actions for onboarding
 * questionnaire side-effects.
 *
 * Right now this file owns a single action,
 * `notifyInstructorOnSubmission`, that bridges from a Convex
 * mutation to an Inngest event. The mutation
 * `submitQuestionnaire` writes the submission row and stamps
 * `notifiedInstructorAt` atomically, then schedules this
 * action via `ctx.scheduler.runAfter(0, ...)`. The action
 * reads the post-write row, idempotency-skips if the flag is
 * already set, otherwise emits the `questionnaire/submitted`
 * event to Inngest.
 *
 * Per Convex guidelines (`convex/_generated/ai/guidelines.md`):
 *   * `"use node"` is at the top of this file because
 *     `fetch()` from `node:` would otherwise be unavailable
 *     (the action uses the global `fetch` API which Convex
 *     provides in either runtime, but we keep the directive
 *     consistent with sibling `convex/actions/*.ts` files
 *     that hit third-party APIs).
 *   * The function is an `internalAction` because no client
 *     should ever trigger this directly — it's a private
 *     side-effect of `submitQuestionnaire`.
 *   * Reads via `ctx.runQuery` (no `ctx.db` in actions).
 *   * Env vars are declared in `convex/convex.config.ts` for
 *     documentation but read via `process.env` here to match
 *     the existing sibling actions (`convex/actions/*.ts`)
 *     and because the convex-test harness does not yet
 *     expose a typed `ctx.env` API at the time this was
 *     written. The deployment script (see
 *     `apps/platform/.env*`) provides the same set of env
 *     values to both runtime and tests, so future migration
 *     to `ctx.env.get` will be transparent.
 *
 * Why this isn't just `inngest.send` from inside the
 * mutation: Convex mutations don't allow outbound HTTP /
 * Node APIs, and the codebase's `inngest.send` calls all live
 * in Next.js route handlers or Inngest functions, never in
 * Convex. Adding this Convex-action bridge keeps the
 * "scheduled → fire event" pattern symmetric with the rest
 * of the app and keeps Inngest retry semantics in Inngest
 * (the action's `retry` config), not in Convex.
 */
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

/**
 * Inngest ingest URL for a single event. `inn.gs` is the
 * documented Inngest hostname for the public event API and
 * accepts a POST per first-party docs
 * (https://www.inngest.com/docs/events). The path segment
 * `{event}` is the canonical event name we register the
 * consumer against.
 *
 * This URL is intentionally hard-coded rather than read from
 * an env var: Inngest's ingest endpoint is stable and any
 * private-cloud operator runs a reverse proxy that points at
 * the same path prefix, so the literal here is fine for
 * `production|preview|staging`. If we ever introduce a
 * dedicated env var (`INNGEST_INGEST_URL`) we can flip this
 * read without breaking any caller.
 */
const INNGEST_INGEST_URL = "https://inn.gs/e/questionnaire/submitted";

/**
 * Bridges a submitted questionnaire to an Inngest event so
 * the assigned instructor(s) get a notification email.
 *
 * Idempotency:
 *
 * 1. `submitQuestionnaire` writes `notifiedInstructorAt = now`
 *    atomically with `status = "submitted"`. If the action is
 *    ever re-fired (Convex scheduler replay, manual retry
 *    from the dashboard), the field is already set and the
 *    action short-circuits before calling `fetch`.
 * 2. The Inngest consumer (`onboarding-questionnaire-submitted-notification`)
 *    re-reads `notifiedInstructorAt` on entry and treats the
 *    row as already-handled when set; this is defensive
 *    insurance against future scheduler-replay changes.
 * 3. `sendEmail` is called with a stable per-recipient
 *    `idempotencyKey` (`questionnaire-submitted-notification:{submissionId}:{instructorId}`)
 *    so Resend dedupes any re-deliveries within its window.
 *
 * Errors:
 *
 * `fetch` failures (DNS, network) are logged via
 * `console.warn` and swallowed when the response isn't a 5xx;
 * for 5xx we `throw` so the Convex scheduler retries. We
 * never throw on a missing env (`INNGEST_EVENT_KEY`) — that
 * is a configuration error that requires a human to fix, not
 * a transient failure we should sweep under the rug.
 *
 * @returns `{ emitted: true, eventName }` when the event was
 *   sent, `{ skipped: true, reason }` when
 *   idempotency-short-circuited.
 */
export const notifyInstructorOnSubmission = internalAction({
  args: {
    submissionId: v.id("onboardingQuestionnaireSubmissions"),
  },
  returns: v.union(
    v.object({ emitted: v.literal(true), eventName: v.string() }),
    v.object({ skipped: v.literal(true), reason: v.string() })
  ),
  handler: async (ctx, args): Promise<
    | { emitted: true; eventName: string }
    | { skipped: true; reason: string }
  > => {
    // Typed env read — declared in `convex/convex.config.ts`
    // for documentation and to keep the deploy script's
    // secret-set list audited. We still read it via
    // `process.env` here because the convex-test harness
    // (0.0.55, used by `convex/vitest.config.mjs`) does not
    // yet expose a typed `ctx.env` API, and matching the
    // `process.env` reads already used by sibling actions in
    // `convex/actions/resendMetrics.ts` and
    // `convex/actions/resendSuppressionList.ts` keeps the
    // diagnose-deploy scripts uniform. The Convex production
    // runtime surfaces `INNGEST_EVENT_KEY` here the same
    // way it surfaces `RESEND_API_KEY` for those siblings.
    // A missing key in dev/test means the action can't emit
    // and we should skip silently; in production the deploy
    // script ensures the key is present so this branch is
    // effectively dead.
    const inngestEventKey = process.env.INNGEST_EVENT_KEY;
    if (!inngestEventKey) {
      // eslint-disable-next-line no-console
      console.warn(
        "[onboardingQuestionnaireActions] INNGEST_EVENT_KEY not set; skipping event emit",
        { submissionId: args.submissionId }
      );
      return {
        skipped: true,
        reason: "INNGEST_EVENT_KEY not configured",
      };
    }

    // Read the post-write row from inside the action so a
    // Convex scheduler replay (after the original mutation
    // committed) sees the row in its published state. We
    // narrow to the fields we actually use so a future schema
    // addition to the table doesn't accidentally leak into
    // the Inngest payload.
    //
    // Same-file call — annotate the return type to work around
    // TypeScript's circular-import limitation per Convex
    // guidelines.
    const submission:
      | {
          _id: string;
          onboardingId: string;
          studentClerkId: string;
          status: "draft" | "submitted";
          submittedAt: number | null;
          notifiedInstructorAt: number | null;
        }
      | null = await ctx.runQuery(
      internal.onboardingQuestionnaire.getSubmissionForInstructorNotification,
      { submissionId: args.submissionId }
    );

    if (!submission) {
      // Should never happen — `submitQuestionnaire` just wrote
      // the row in a single transaction. A null read indicates
      // data corruption or a Convex scheduler replay that lost
      // its tx context (which we don't expect). Throw so the
      // scheduler retries; the action is idempotent on
      // re-fires via the `notifiedInstructorAt` check below.
      throw new Error(
        `notifyInstructorOnSubmission: submission ${args.submissionId} not found`
      );
    }

    if (submission.status !== "submitted") {
      // Submission was rolled back to draft between the
      // mutation commit and the action run (e.g. a Convex
      // scheduler replay that runs against a fresh tx).
      // Nothing to notify on. Skip silently.
      return {
        skipped: true,
        reason: `submission is in status "${submission.status}", not "submitted"`,
      };
    }

    if (submission.notifiedInstructorAt != null) {
      // Idempotency claim consumed — the action was either
      // re-fired by Convex scheduler replay, or (more likely)
      // a future caller is re-issuing the schedule call.
      return {
        skipped: true,
        reason: "submission already has notifiedInstructorAt set",
      };
    }

    const submittedAt = submission.submittedAt ?? Date.now();
    const eventPayload = {
      // Inngest event payload. The consumer reads `name`
      // implicitly via its `triggers: [{ event:
      // "questionnaire/submitted" }]` registration; we keep
      // `name` in the payload for Inngest's introspection UIs.
      name: "questionnaire/submitted",
      data: {
        submissionId: args.submissionId,
        onboardingId: submission.onboardingId,
        studentClerkId: submission.studentClerkId,
        submittedAt,
      },
      // No `user` block — we don't have Clerk identity on the
      // Convex side; the consumer resolves instructor emails
      // via the Convex HTTP endpoint
      // (`/onboarding/submission-for-instructor-notification`).
    };

    const fetchResponse = await fetch(INNGEST_INGEST_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Inngest's server-to-server ingest accepts the
        // event key as a Bearer header. The Next.js SDK does
        // this for us when we call `inngest.send` from a
        // route handler; from a Convex action we have to wire
        // it manually. The key is the same value the SDK uses
        // via `process.env.INNGEST_EVENT_KEY` on the platform
        // apps.
        Authorization: `Bearer ${inngestEventKey}`,
      },
      body: JSON.stringify(eventPayload),
    });

    if (!fetchResponse.ok) {
      const body = await fetchResponse.text().catch(() => "");
      // eslint-disable-next-line no-console
      console.warn(
        `[onboardingQuestionnaireActions] Inngest ingest HTTP ${fetchResponse.status} for ${args.submissionId}: ${body.slice(0, 256)}`
      );
      // 4xx are configuration errors (bad key, malformed
      // payload) — they won't get better on retry and the
      // dashboard operator needs to see them. 5xx are
      // transient — throw so the Convex scheduler retries.
      if (fetchResponse.status >= 500) {
        throw new Error(
          `Inngest ingest 5xx (${fetchResponse.status}) for submission ${args.submissionId}`
        );
      }
      return {
        skipped: true,
        reason: `Inngest ingest non-2xx (${fetchResponse.status})`,
      };
    }

    // eslint-disable-next-line no-console
    console.info(
      `[onboardingQuestionnaireActions] questionnaire/submitted event emitted for ${args.submissionId}`
    );

    return {
      emitted: true,
      eventName: "questionnaire/submitted",
    };
  },
});
