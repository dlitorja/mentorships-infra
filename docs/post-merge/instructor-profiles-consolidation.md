# Post-Merge Verification Tasks — `instructorProfiles` Drop (PR #834)

Structured task list for tracking the remaining post-merge operational work on prod, generated from the post-merge plan in `INSTRUCTOR_PROFILES_CONSOLIDATION_PLAN.md` and the smoke-test rollout in the prior planning summary.

**Context:** PR #834 (squash-merge commit `f5a5d3ac`, 2026-09-09 13:59 UTC) deleted the `instructorProfiles` table from the Convex schema. The CI workflow `Deploy Convex` completed successfully on `main` at 14:04 UTC. The 4-PR widen-migrate-narrow arc is code-complete; the items below are observability + housekeeping.

**Suggested Linear mapping:**

- **Project**: "Post-Merge Verification"
- **Label**: `post-merge-2026-09-09`, `verification`, `prod`, `monitoring`, `housekeeping`
- **Cycle**: current week (2026-09-08 → 2026-09-14)

## Tasks

### Phase 1 — Prod smoke tests (target: same day as merge)

Each task below is a single operator action. Estimated 15–25 minutes total.

#### T1. `npx convex data instructorProfiles --prod` returns "Table not found"

- **Type**: Verification
- **Priority**: Urgent
- **Estimated time**: < 30s
- **Command**: `npx convex data instructorProfiles --prod`
- **Pass criterion**: Command exits non-zero with a "Table not found" error (Convex rejects unknown table names).
- **Why it matters**: Confirms the schema deletion has actually deployed to prod. If this fails, the deploy workflow may not have run correctly.

#### T2. `/instructors/nino-vecia` renders all 6 portfolio images

- **Type**: Verification
- **Priority**: High
- **Estimated time**: 2 min
- **Pass criterion**: Public page loads, portfolio gallery shows 6 thumbnails with no broken-image placeholders.
- **Why it matters**: This is the PR #833 regression case. The storage IDs in `instructors.portfolioImageStorageIds` must render correctly now that the dual-source fallback is gone.

#### T3. Admin edit form — add/remove/reorder portfolio image

- **Type**: Verification
- **Priority**: High
- **Estimated time**: 5 min
- **Steps**:
  1. Open admin form for any instructor on prod.
  2. Add a portfolio image, remove another, reorder the rest.
  3. Save the form.
  4. Reload the public `/instructors/<slug>` page.
- **Pass criterion**: Public page reflects the edit within 1 second of save.
- **Why it matters**: Confirms the single-table write path (`internalAtomicAddPortfolioImage`, `internalAtomicSetPortfolioImages`) works end-to-end through the admin form.

#### T4. Image upload via `apps/platform` admin

- **Type**: Verification
- **Priority**: High
- **Estimated time**: 5 min
- **Steps**:
  1. Open admin image upload route on prod (`apps/platform/app/api/admin/instructors/upload/route.ts`).
  2. Upload a small test image.
- **Pass criterion**: Success response; new image visible in admin grid + public gallery.
- **Why it matters**: Confirms the legacy dual-write path now writes only to `instructors` without throwing on the dropped `instructorProfiles` table.

#### T5. Image upload via `apps/web` admin

- **Type**: Verification
- **Priority**: High
- **Estimated time**: 5 min
- **Steps**: Same as T4 but for the legacy `apps/web` upload route.
- **Pass criterion**: Same.
- **Why it matters**: Confirms the second app's write path is also clean.

### Phase 2 — Prod monitoring window

#### T6. 24h post-merge check-in

- **Type**: Monitoring
- **Priority**: Medium
- **Target date**: 2026-09-10 (24h after merge)
- **Estimated time**: 5 min
- **Checklist**:
  - [ ] Convex runtime logs (`npx convex logs --prod --since 24h` or dashboard → Logs → last 24h): no `TypeError` mentioning `instructorProfiles` or `_id` undefined
  - [ ] Convex dashboard → Functions view: error rate on `instructors:*` mutations not above the 7-day pre-merge baseline
  - [ ] Public `/instructors/<slug>` p95 load time not worse than 7-day pre-merge baseline
  - [ ] Sentry / error tracker: no new error patterns mentioning `instructorProfiles`

> Note: `convex/auditLog` is not a suitable source here — it only records completed admin/support/instructor/student/system audit actions and exposes a paginated `listAuditLogs` query; it has no failed-mutation metric. Use the Convex runtime logs / Functions error-rate view instead.

#### T7. 48h post-merge check-in

- **Type**: Monitoring
- **Priority**: Medium
- **Target date**: 2026-09-11 (48h after merge)
- **Estimated time**: 5 min
- **Checklist**: Same as T6.

### Phase 3 — Documentation close-out

#### T8. Update `INSTRUCTOR_PROFILES_CONSOLIDATION_PLAN.md` line 225

- **Type**: Housekeeping
- **Priority**: Low
- **Estimated time**: 5 min
- **Steps**:
  1. Open `INSTRUCTOR_PROFILES_CONSOLIDATION_PLAN.md`.
  2. Replace line 225: `Status: 🚧 PR opened (this PR). Pending squash-merge + Convex deploy.` with `Status: ✅ Merged as PR #834 (squash-merge commit f5a5d3ac, 2026-09-09 13:59 UTC). Schema deletion deployed to prod via CI at 14:04 UTC.`
  3. Open a small housekeeping PR or amend if the file is otherwise unchanged from `main`.
- **Why it matters**: Future maintainers reading the plan should see accurate state.

### Phase 4 — Optional housekeeping

#### T9. Decide on `scripts/reconciliation-acceptance.json` archival

- **Type**: Housekeeping
- **Priority**: Low
- **Estimated time**: 10 min
- **Options**:
  - (A) Leave in place as audit trail of the 8 reviewed divergences for PR 4 prod.
  - (B) Move to `docs/archive/instructor-profiles-acceptance-2026-09-09.json` (out of `scripts/`, since the gate is a no-op post-merge).
- **Recommendation**: (A) — minimal churn, the file is small (66 lines), and the `reason` fields document the audit decision. Worth revisiting only if the `scripts/` directory becomes cluttered.

---

## Total operator time

~45 minutes spread across 3 days. No engineering time required unless Phase 1 or Phase 2 surfaces an issue.

## Rollback (if needed)

If any Phase 1 check fails irrecoverably, follow this **strict order** — restoring a snapshot against a schema that doesn't yet have the `instructorProfiles` table will fail schema validation:

1. **`git revert f5a5d3ac`** on a recovery branch off `main`.
2. **Deploy the reverted schema to prod first**: `pnpm convex deploy --yes` (or merge the revert PR and wait for the `Deploy Convex` workflow to complete). Verify with `npx convex data instructorProfiles --prod` — the table should now exist (empty).
3. **Restore the Convex snapshot** taken before 14:04 UTC on 2026-09-09 (Convex backup component runs daily; pick the most recent snapshot from before the deploy). Now that the schema matches, the rows will be re-inserted without validation errors.
4. **Verify on prod**: `npx convex data instructorProfiles --prod` returns the original ~15 rows; `npx convex data instructors --prod` still has the 17 rows it had pre-merge (the snapshot predates the dual-write narrows).
5. Open a follow-up PR with a post-mortem explaining what the gate didn't catch.

Time to rollback: ~10 minutes of operator time + the CI deploy window (~3 min) + snapshot restore duration (5–15 min).
