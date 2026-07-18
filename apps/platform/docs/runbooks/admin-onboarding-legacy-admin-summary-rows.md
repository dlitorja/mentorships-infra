# R8 — Legacy `adminSummary: true` rows after the PR 4 widening

**When to read this runbook**: before any deploy that ships changes to `apps/platform/inngest/functions/onboarding.ts` step 4 (the admin summary email send), and whenever BetterStack / Axiom / Sentry fires an alert on `admin-onboarding` Resend traffic.

## Background

PR 4 (`e0b2594c`) widened the `emailsSent` schema on `adminOnboardings`:

```ts
emailsSent: v.optional(v.object({
  student: v.optional(v.boolean()),
  instructors: v.optional(v.array(v.string())),
  adminSummary: v.optional(v.boolean()),
  adminSummaryByEmail: v.optional(v.record(v.string(), v.boolean())), // ← NEW in PR 4
  stub: v.optional(v.boolean()),
})),
```

The widening is **additive** — legacy rows already in the database with `emailsSent: { adminSummary: true }` (and no `adminSummaryByEmail` field) were **not** backfilled.

### Why this matters

Step 4a of `adminOnboardingFlow` (`apps/platform/inngest/functions/onboarding.ts:944`) initialises `alreadyDelivered` from `freshRow.emailsSent?.adminSummaryByEmail ?? {}`. On a legacy row, this is `{}`. The subsequent `toSend` filter:

```ts
const toSend = adminEmails.filter((e) => alreadyDelivered[e] !== true);
```

returns every admin address — because `undefined !== true` is `true`. The legacy `adminSummary: true` claim ("we sent the admin summary at some point") is **lost**: per-address tracking supersedes the whole-leg boolean.

The first admin-onboarding re-run after PR 4 deploys will therefore re-send to **every** admin address for every legacy row still in a non-terminal state.

## How big is the blast radius

For a single legacy row with N admin addresses:

- 1 admin-onboarding run (PR 9 cap: 5 concurrent).
- PR 12 throttle: 1 second between admin summary sends (`step.sleep("throttle-admin-${i}", "1s")`).
- Net: N sends over N seconds per row.
- Across 5 concurrent runs × N addresses: ~5N sends over ~N seconds.

Worst case in production today: `ADMIN_EMAILS=admin@huckleberry.art,ops@huckleberry.art` (2 addresses), so 10 sends over ~2 seconds across a 5-row burst — comfortably inside Resend's paid-tier rate limit. If `ADMIN_EMAILS` ever grows to 8+, this becomes 40 sends over ~8 seconds, still inside the limit but worth watching.

## Detection

### Pre-deploy (read this BEFORE merging a step-4-touching change)

Run from the Convex dashboard ("Functions" → `adminOnboardings:listAllLegacyAdminSummary` is not shipped; use the snippet below):

```ts
// paste into Convex dashboard "Run query" with admin auth
const rows = await ctx.db.query("adminOnboardings").collect();
const legacy = rows.filter((r) =>
  r.emailsSent?.adminSummary === true &&
  (r.emailsSent?.adminSummaryByEmail === undefined ||
    Object.keys(r.emailsSent.adminSummaryByEmail).length === 0) &&
  (r.status === "queued" || r.status === "processing")
);
return { count: legacy.length, sample: legacy.slice(0, 5).map((r) => r._id) };
```

If `count > 0`, decide:

- **Small (< 20)**: usually fine to let PR 12 throttle carry the burst.
- **Large (> 100)**: drain before deploy — see "Drain procedure" below.

### Post-deploy (read this during the first 30 minutes after a step-4 deploy)

Watch the Resend dashboard for `admin-onboarding-summary` traffic spike. Expected: one re-send per legacy row, throttled at 1/second. Alert if any of:

- More than `legacy_count × admin_emails_count` sends within the first 10 minutes.
- Resend 429 (rate limit) responses on `https://api.resend.com/emails`.
- BetterStack error count for `inngest:admin-onboarding-flow` source above baseline.

## Drain procedure (optional pre-deploy)

If `count > 100`, drain legacy rows before deploy to make the post-deploy window boring — but **only drain rows the operator is willing to lose as cancelled**. The state machine (`apps/platform/lib/admin-onboarding.ts:7-13`) is:

```
ALLOWED_TRANSITIONS = {
  queued: ["processing", "cancelled"],
  processing: ["completed", "failed", "cancelled"],
  failed: ["processing", "cancelled"],
  cancelled: [],   // ← terminal, no transitions out
  completed: [],   // ← terminal, no transitions out
}
```

`cancelled` and `completed` are terminal. `retryAdminOnboarding` (`convex/adminOnboarding.ts:595-629`) only transitions `failed` or `queued` back to `processing`. There is no path from `cancelled` back to a retryable state — once cancelled, the row stays cancelled.

Procedure (only for rows the operator is OK losing as cancelled):

1. From the Convex dashboard, run an internal mutation that patches `status: "cancelled"` and appends a `{ event: "cancelled", actorUserId: "<drain-script>" }` timeline entry on each legacy row you want to drain.
2. The re-send no longer happens for those rows (step 4a bails on `non_processing` early-return after PR 12).
3. Re-deploy.
4. **Do not** try to recover drained rows via the per-row Retry button — it will throw `Cannot retry from status 'cancelled'`. If you discover after deploy that you actually wanted a drained row to complete, you have to manually walk it through: re-create the session pack, seat, and workspace from the existing artifacts (the row preserves them — `cancelAdminOnboarding` does not delete artifacts), then submit a NEW admin-onboarding form entry. This is a manual recovery, not an automated one.

For rows that must succeed, do NOT drain them. Let them re-send naturally on the first run after deploy — PR 9 + PR 12 throttle the burst to inside the Resend paid-tier rate limit.

## Long-term mitigation (future PR, not this runbook)

Add a one-shot backfill internal mutation:

```ts
// convex/adminOnboarding.ts (future, NOT this PR)
export const backfillAdminSummaryByEmail = internalMutation({
  args: { dryRun: v.boolean() },
  handler: async (ctx, { dryRun }) => {
    const rows = await ctx.db.query("adminOnboardings").collect();
    const legacy = rows.filter(
      (r) =>
        r.emailsSent?.adminSummary === true &&
        (r.emailsSent?.adminSummaryByEmail === undefined ||
          Object.keys(r.emailsSent.adminSummaryByEmail).length === 0),
    );
    if (dryRun) return { wouldPatch: legacy.length };
    for (const r of legacy) {
      await ctx.db.patch(r._id, {
        emailsSent: {
          ...r.emailsSent,
          adminSummaryByEmail: {}, // explicit empty — same observable behavior
        },
      });
    }
    return { patched: legacy.length };
  },
});
```

Run with `dryRun: true` first; if the count looks reasonable, run again with `dryRun: false` during a low-traffic window. This converts the implicit re-send behavior into an explicit per-row choice, which is what PR 4's per-address tracking was always meant to enable.

## Rollback

If post-deploy Resend traffic exceeds your comfort threshold and the row count is small enough to fix by hand:

1. From the Convex dashboard, manually patch the worst-affected rows: `emailsSent.adminSummaryByEmail = {}` (explicit empty) or set individual `email: true` entries for addresses already re-sent this run.
2. Re-emit `admin/onboarding.completed` for any row you want to actually retry — that goes through step 4a which now sees the populated map and skips.

If the row count is too large for manual intervention, pause the Inngest account, patch the rows in bulk via `npx convex run adminOnboarding:backfillAdminSummaryByEmail '{"dryRun": false}'` (after the future backfill migration lands), then resume Inngest.

## Related code references

- `convex/schema.ts:740-753` — `emailsSent` schema with the PR 4 widening.
- `apps/platform/inngest/functions/onboarding.ts:944` — `alreadyDelivered` initialisation (the seam that loses the legacy `adminSummary: true` claim).
- `apps/platform/inngest/functions/onboarding.ts:955` — `toSend` filter that triggers the re-send on legacy rows.
- `apps/platform/inngest/functions/onboarding.ts:1044` — `SendEmailResult` typing on the `res` binding (PR 12 fixup).
- `apps/platform/inngest/functions/onboarding.ts:1145` — true-only `emailsSentPatch.adminSummaryByEmail` filter that prevents `false` overwrites (PR 12 fixup).
