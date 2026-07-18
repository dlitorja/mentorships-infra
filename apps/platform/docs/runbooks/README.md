# Platform Runbooks

Operational runbooks for the `apps/platform` admin onboarding automation. Each entry is a self-contained procedure for on-call responders and SRE-style incident response. Not a tutorial — assume the reader is already comfortable with Convex dashboards, the Inngest dashboard, the Resend dashboard, and the Clerk dashboard.

Source-of-truth plan: [`ADMIN_ONBOARDING_AUTOMATION_PLAN.md`](../../../ADMIN_ONBOARDING_AUTOMATION_PLAN.md) at the repo root.

## Index

- [`admin-onboarding-legacy-admin-summary-rows.md`](./admin-onboarding-legacy-admin-summary-rows.md) — **R8**: behaviour of legacy `adminOnboardings` rows that pre-date the PR 4 `emailsSent.adminSummaryByEmail` widening. Read before any deploy that ships admin-onboarding changes.
- [`admin-onboarding-staging-manual-test.md`](./admin-onboarding-staging-manual-test.md) — **R9**: end-to-end manual verification of the Kajabi admin-onboarding flow in staging. Use before a release that touches the form, the Inngest handler, or the per-recipient idempotency tracking.

## How to use

1. Open the runbook from the alert / change ticket.
2. Skip sections that do not apply to the active incident.
3. The "Verification queries" blocks are Convex dashboard snippets — paste into the Convex dashboard's "Run query" with `admin` auth.
4. File a follow-up if any step fails or produces an unexpected result.
