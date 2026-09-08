# Instructor Profiles Consolidation Plan

> Plan for eliminating the dual source of truth between `instructors` and `instructorProfiles` in Convex. Follows widen-migrate-narrow.

## Goal

Make the `instructors` table the single source of truth for all instructor profile data (name, slug, tagline, bio, specialties, background, socials, profile image, portfolio images, isActive, isNew). Drop the parallel `instructorProfiles` table once reconciled.

This fixes a real bug surfaced today: `/instructors/nino-vecia` shows only the portfolio images stored in `instructorProfiles`, while the admin edit form shows the union of `instructors.portfolioImages` and `instructorProfiles.portfolioImages`. The two tables diverge because their writers are not atomic.

## Background

`apps/platform/app/instructors/[slug]/page.tsx:393` calls `useInstructorBySlug` → `api.instructors.getInstructorBySlug`, which (`convex/instructors.ts:780`) returns only the `instructorProfiles` row's `portfolioImages` when one exists.

`apps/platform/app/api/admin/instructors/[id]/route.ts:152` does the opposite: it queries both tables and returns the union.

The two arrays diverge because every writer that touches both tables does so via two separate mutations (no transaction), and some writers touch only one table:

| Writer | `instructors` | `instructorProfiles` | Atomic? |
| --- | --- | --- | --- |
| `api.instructors.uploadInstructorPortfolioImage` (`convex/instructors.ts:1695`) | yes | no | n/a |
| `api.instructors.addInstructorPortfolioImage` (`convex/instructors.ts:1737`) | yes | no | n/a |
| `api.instructors.updateInstructor` (called from admin PUT, `convex/instructors.ts:1238`) | yes | no | n/a |
| `api.instructors.updateInstructorProfilePortfolioImages` (`convex/instructors.ts:2031`) | no | yes | n/a |
| `apps/platform/app/api/admin/instructors/[id]/route.ts:400` PUT (two separate mutations) | yes | yes | **no** |
| `apps/platform/app/api/admin/instructors/upload/route.ts:186` (two separate mutations) | yes | yes | **no** |
| `apps/web/app/api/admin/instructors/upload/route.ts` (two separate mutations) | yes | yes | **no** |
| `convex/seed.ts:445` (`seedInstructorProfiles`) | no | yes | n/a |
| `convex/seed.ts:1240` (`seedInstructorsAndProducts`) | yes | no | n/a |
| `convex/instructors.ts:1525` (`upsertInstructorProfile`) | no | yes | n/a |
| `backfillImages` / `backfillImagesForSlugs` (`convex/instructors.ts:135,412`) | yes | yes | **no** |

A single failed mutation between the two leaves the tables out of sync. There is no compensation step. This is exactly what produced the nino-vecia divergence.

## Field overlap

Both tables store the following public-profile fields. Picking `instructors` as canonical keeps the operational fields (calendar, inventory, working hours) where every foreign key already expects them.

| Field | `instructors` (`convex/schema.ts:29`) | `instructorProfiles` (`convex/schema.ts:332`) |
| --- | --- | --- |
| `userId` | optional | optional |
| `name` | optional | **required** |
| `slug` | optional | **required** |
| `email` | optional | optional |
| `tagline` | optional | optional |
| `bio` | optional | optional |
| `specialties` | optional | optional |
| `background` | optional | optional |
| `socials` | optional | optional |
| `isActive` | optional | **required** |
| `isNew` | optional | optional |
| `profileImageUrl` | optional | optional |
| `profileImageStorageId` | optional | optional |
| `profileImageUploadPath` | optional | optional |
| `portfolioImages` | optional | optional |
| `portfolioImageStorageIds` | optional | optional |
| `legacyInstructorRef` | optional | optional |

Fields unique to `instructors` (kept as-is): `googleCalendarId`, `googleRefreshToken`, `googleAvailabilityCalendarIds`, `discordVoiceChannelUrl`, `timeZone`, `workingHours`, `bufferMinutesBetweenSessions`, `minBookingLeadMinutes`, `maxBookingAdvanceDays`, `blockedDateRanges`, `maxActiveStudents`, `pricing`, `oneOnOneInventory`, `groupInventory`, `deletedAt`, `isListed`, `updatedAt`, `useKajabiCheckout`, `kajabiCheckoutUrlOneOnOne`, `kajabiCheckoutUrlGroup`.

No field is unique to `instructorProfiles`.

## Architecture decision

**Canonical table: `instructors`.** It is the table every foreign key references (`sessions.instructorId`, `products.instructorId`, `instructorTestimonials.instructorId`, `studentResults.instructorId`, etc.). Making `instructorProfiles` canonical would force a foreign-key migration in many tables.

**Read model after consolidation:** `getInstructorBySlug` reads only from `instructors`. The `instructorProfiles` table is removed.

**Write model after consolidation:** every profile-field write goes through a single mutation (`upsertInstructorProfile` in `convex/instructors.ts`, but targeting `instructors` only) that patches the `instructors` row. There is no second table to keep in sync.

## Implementation: 3 PRs

Splitting into 3 PRs matches the repo's existing pattern (`backfillLegacyInstructorRef` in `convex/migrations.ts`, `backfillSessionWorkspaceLinks` in `convex/migrations.ts`).

### PR 1 — Widen: atomic dual-write

Goal: make divergence impossible going forward. Reads are unchanged, behavior is identical to today, but every profile-field write either succeeds on both tables or fails on both.

Changes:

1. **Add one atomic mutation** `updateInstructorProfileFieldsAtomic` in `convex/instructors.ts` that, in a single Convex transaction:
   - Patches the `instructors` row by `_id`.
   - Patches the matching `instructorProfiles` row by slug (or no-ops if none exists).
   - Returns the post-patch `instructors` document.
2. **Add `addInstructorPortfolioImageAtomic`** and **`updateInstructorProfileImageAtomic`** variants that append portfolio / set profile image across both tables in one transaction.
3. **Route every existing writer through these**:
   - `convex/instructors.ts`: replace `uploadInstructorPortfolioImage`, `addInstructorPortfolioImage`, `updateInstructorProfileStorageId`, `updateInstructorPortfolioStorageIds`, and the public-facing profile image/portfolio setters with calls to the atomic helpers.
   - `apps/platform/app/api/admin/instructors/[id]/route.ts:400-424`: drop the second `updateInstructorProfilePortfolioImages` call (the atomic helper does both).
   - `apps/platform/app/api/admin/instructors/upload/route.ts:166-206`: drop the second mutation calls.
   - `apps/web/app/api/admin/instructors/upload/route.ts`: drop the second mutation calls.
   - Keep `updateInstructorProfilePortfolioImages` for now (deprecated, but used by `backfillImages` and other paths). Mark it `@deprecated` in JSDoc.
4. **Add a convex-test unit test** in a new `convex/instructorProfileConsolidation.test.ts` that:
   - Seeds an `instructors` row + `instructorProfiles` row.
   - Calls the atomic helper to add a portfolio image.
   - Asserts both rows got the image, in one transaction.
   - Calls the atomic helper and triggers a forced failure (e.g., make one row non-existent), asserts the other was NOT patched (Convex transaction semantics).

Verification:
- `pnpm --filter apps/platform run typecheck`
- `pnpm --filter apps/platform run lint`
- `pnpm vitest run convex/instructorProfileConsolidation.test.ts`
- Manually: edit nino-vecia in admin → add a portfolio image → save → reload → re-add another image → confirm both tables still match (via `npx convex data instructorProfiles` and `npx convex data instructors`).

Risk: Low. Reads are unchanged. Behavior is identical. The atomic helper is a strict superset of the previous two-mutation sequence. If either table is missing, the helper no-ops the missing one and patches the present one — preserving today's lenient behavior.

Rollback: Revert the PR. No data is touched in production (this PR only changes the writers; data state is unchanged because both writes happened before, just non-atomically).

### PR 2 — Migrate: one-shot reconciliation

Goal: realign existing data so the two tables match. Uses the existing `@convex-dev/migrations` tooling (`convex/migrations.ts`, `convex.config.ts:14`) so it's resumable and runs in batches.

Changes:

1. **Add migration `reconcileInstructorProfilePortfolioImages`** in `convex/migrations.ts`:
   - `table: "instructorProfiles"`
   - For each profile row, read the matching `instructors` row by slug.
   - Compute the de-duplicated union of `profile.portfolioImages` and `instructor.portfolioImages` (preserving the profile order, then appending unique URLs from the instructor row).
   - Compute the same union for `portfolioImageStorageIds` (paired by index when possible; otherwise leave undefined for unmatched URLs).
   - Patch BOTH rows with the union so they match.
   - Return `undefined` if no change is needed.
2. **Add migration `reconcileInstructorProfileImage`** (similar shape, for `profileImageUrl` + `profileImageStorageId`) — preferring the storage-backed version when present, otherwise the URL.
3. **Add migration `reconcileInstructorProfileMetadata`** for the remaining overlapping fields: `tagline`, `bio`, `specialties`, `background`, `socials`, `isActive`, `isNew`, `name`, `email`. Prefer the value from `instructors` when both exist; fall back to `instructorProfiles` when only one has it.
4. **Add `convex/reconcileInstructorProfiles.test.ts`** using `convex-test` + `@convex-dev/migrations/test` (mirroring `convex/migrations.test.ts:58`):
   - Seed divergent rows (instructor has 3 portfolio URLs, profile has 2 different ones).
   - Run the migration.
   - Assert both rows now have the same union of 5 URLs, in profile-first order.
5. **Document the run command** in the PR description:
   ```
   npx convex run migrations:run '{"fn":"migrations:reconcileInstructorProfilePortfolioImages"}'
   npx convex run migrations:run '{"fn":"migrations:reconcileInstructorProfileImage"}'
   npx convex run migrations:run '{"fn":"migrations:reconcileInstructorProfileMetadata"}'
   ```
   Each is idempotent (no-op if already reconciled). Run them in order on staging first, then prod.

Verification:
- `pnpm vitest run convex/reconcileInstructorProfiles.test.ts`
- On staging: run all three migrations. Diff the two tables with:
  ```
  npx convex data instructors --json | jq '.[] | {slug, portfolioImages}'
  npx convex data instructorProfiles --json | jq '.[] | {slug, portfolioImages}'
  ```
  Confirm equality per slug.
- Visually load `/instructors/nino-vecia` on staging. Confirm the portfolio gallery shows the same count as the admin edit form.
- On prod: same checks, plus a 30-minute soak watching `convex/auditLog` (or any error log) for unexpected failures.

Risk: Medium. A real data migration. Mitigations:
- Idempotent migrations (re-running is safe).
- Resumable via `@convex-dev/migrations` (network blip doesn't lose progress).
- Staging first, with a manual visual diff before prod.
- Snapshot Convex backup before prod run.

Rollback: Convex has daily backups. If the migration corrupts data, restore the snapshot. The migration only patches `instructors.portfolioImages`, `instructors.portfolioImageStorageIds`, `instructors.profileImageUrl`, `instructors.profileImageStorageId`, `instructorProfiles.portfolioImages`, `instructorProfiles.portfolioImageStorageIds`, `instructorProfiles.profileImageUrl`, `instructorProfiles.profileImageStorageId`, and a handful of metadata fields. Snapshot is sufficient.

### PR 3 — Narrow: collapse to one table

Goal: stop reading from and writing to `instructorProfiles`. The two tables match exactly after PR 2 runs, so we can safely drop the read-side merge and the second write.

Changes:

1. **`convex/instructors.ts:780` (`getInstructorBySlug`)**: remove the `instructorProfiles` lookup entirely. Read only from `instructors`. Return the existing fields (`instructorId`, `oneOnOneInventory`, `groupInventory`, `useKajabiCheckout`, etc.) by joining on slug. **Security update after Greptile P1:** the public allowlist must be explicit — the query is unauthenticated, so spreading the full `instructors` document leaks `googleCalendarId`, `timeZone`, `workingHours`, scheduling metadata, and `discordVoiceChannelUrl`. The shipped implementation constructs an explicit public shape mirroring the historical `instructorProfiles` row plus a few `instructors`-only fields (`instructorId`, inventory, kajabi).
2. **`apps/platform/app/api/admin/instructors/[id]/route.ts:152-166`**: remove the `instructorProfiles` merge block. The merged `portfolioImages` is now identical to `instructor.portfolioImages`.
3. **`apps/platform/app/api/admin/instructors/[id]/route.ts:400-424`**: remove the second `updateInstructorProfilePortfolioImages` call entirely (the atomic helper from PR 1 still does it for safety during the transition window; this PR removes the manual call).
4. **`convex/instructors.ts:2031` (`updateInstructorProfilePortfolioImages`)**: delete the export. No callers remain.
5. **`convex/instructors.ts:319-373` (`listInstructorProfilesAll`, `internalPatchInstructorProfileImageBySlug`, `internalPatchInstructorPortfolioBySlug`)**: delete. No callers remain.
6. **`convex/instructors.ts:1970-2028` (`updateInstructorProfileStorageIdForProfile`, `updateInstructorPortfolioStorageIdsForProfile`)**: delete. No callers remain after PR 1.
7. **`convex/seed.ts:417` (`seedInstructorProfiles`)**: delete. `seedInstructorsAndProducts` is the only writer and writes to `instructors`.
8. **`convex/seed.ts:634` (`backfillInstructorProfileMentorIds`)**: delete. No-op after `instructors` is canonical.
9. **`convex/seed.ts:566` (`clearInstructorData`) + `convex/seed.ts:529` (`clearInstructorsAndProducts`)**: PR 1's atomic helpers still dual-write to `instructorProfiles` until PR 4, so the dev resets must keep deleting those rows to avoid leaving stale data behind. The original plan said to drop the deletion; the shipped implementation retains it and surfaces `profilesDeleted` in the return value.
10. **`convex/instructors.ts:1525` (`upsertInstructorProfile`)**: delete. The admin form's PUT (`apps/platform/app/api/admin/instructors/[id]/route.ts`) goes through `updateInstructor` directly, which writes to `instructors`.
11. **`apps/platform/app/api/admin/instructors/backfill-images/route.ts` + `apps/web/app/api/admin/instructors/backfill-images/route.ts`**: iterate `instructors` only (no `listInstructorProfilesInternal`). Drop the always-zero `processedProfiles` summary field (the dual-write atomic helper from PR 1 covers the legacy table during the soak window).
12. **Add `convex/getInstructorBySlug.test.ts`** (convex-test) that:
    - Inserts an instructor row with 5 portfolio URLs and a profile image.
    - Calls `getInstructorBySlug`.
    - Asserts the response has the 5 URLs in the same order.
    - Asserts the response does NOT depend on any `instructorProfiles` row (test passes with the profile table empty, then again with the profile table deleted entirely).
    - Pins the public allowlist (regression test that confirms `googleRefreshToken`, `googleCalendarId`, `timeZone`, `workingHours`, scheduling metadata, and `discordVoiceChannelUrl` stay private).
13. **`scripts/migrate-instructors-to-convex.ts`**: stop calling the deleted `instructors:upsertInstructorProfile` mutation. Resolve the instructor id by slug (`instructors:getInstructorBySlugForAdmin`) and call `updateInstructor`. Rename `instructors:upsertMenteeResult` → `instructors:upsertStudentResult`.
14. **`scripts/migrate-instructor-images.mjs`**: drop the entire `migrateInstructorProfiles` phase (the profile table is no longer a migration source). Rename `migrateMenteeResults` → `migrateStudentResults`, `listMenteeResultsInternal` → `listStudentResultsInternal`, `updateMenteeResultStorageId` → `updateStudentResultStorageId`. Update the summary printout to match the new `getMigrationStatus` return shape.

Verification:
- `pnpm --filter apps/platform run typecheck`
- `pnpm --filter apps/platform run lint`
- `pnpm --filter apps/web run typecheck`
- `pnpm vitest run convex/getInstructorBySlug.test.ts`
- `pnpm vitest run` (full suite)
- Manually: `/instructors/nino-vecia` shows all portfolio images.
- Manually: edit nino-vecia in admin (add, remove, reorder) → reload → confirm public page reflects.
- Search the entire repo for remaining `instructorProfiles` references with `grep -rn instructorProfiles apps packages convex` — should return zero hits except in the schema definition itself (next PR).

Status: ✅ Shipped as PR #832, squash-merged. Branch `feat/instructor-profile-narrow`, commits `e7ca79b7` → `3c94656c` (Greptile round 1 fixes: P1 security allowlist + script fixes) → `c880b5a7` (Greptile round 2 fixes: scripts + reset behavior).

Risk: Medium-low. After PR 2, the two tables are identical, so reads from either source produce the same answer. Switching the reader is a refactor with no behavioral change. Mitigations:
- Deploy PR 3 with feature flag / staged rollout if possible (Convex doesn't have feature flags; rely on staging soak + prod smoke test).
- Keep PR 1's atomic helper in place until PR 4 — it's a no-op safety net for any code path that still touches the profile table.

Rollback: Revert PR 3. PR 2's data state remains. Behavior reverts to the pre-PR-3 reader with PR 2's reconciled data, which is correct.

### PR 4 (future, after 1+ week soak) — Drop the table

Goal: remove the `instructorProfiles` table from the schema entirely.

Changes:

1. **`convex/schema.ts:332-354`**: delete the `instructorProfiles` definition.
2. **`convex/_generated/api.d.ts`, `dataModel.d.ts`, `server.d.ts`**: regenerated by `npx convex codegen`.
3. **`convex/migrations.ts`**: drop any code paths that scan `instructorProfiles`.
4. **`convex/instructors.ts`**: drop `listInstructorProfilesAll` (if still present), `listInstructorProfilesInternal` (`convex/instructors.ts:652`), and any other lingering references.
5. **`convex/seed.ts:721`** (the `clearInstructorsAndProducts`-style cleanup): drop the profile scan.

Verification:
- `pnpm vitest run` (full suite, especially `convex/instructorProfileConsolidation.test.ts`).
- `npx convex data instructorProfiles` returns "Table not found" (expected).
- Manual smoke test on staging.

Risk: Low. Schema deletion in Convex is reversible by re-adding the definition + restoring the snapshot. Mitigations: snapshot before schema deploy.

## Testing strategy

Three new test files, plus targeted updates to existing ones:

- `convex/instructorProfileConsolidation.test.ts` (PR 1) — atomic helper unit tests, transaction atomicity, no-op on missing rows.
- `convex/reconcileInstructorProfiles.test.ts` (PR 2) — migration unit tests using `convex-test` + `@convex-dev/migrations/test`. Seeds divergent rows and asserts the union.
- `convex/getInstructorBySlug.test.ts` (PR 3) — pure reads from `instructors`, no dependence on `instructorProfiles`.

Update existing tests:

- `convex/instructorUploads.test.ts` — confirm uploads still record on `instructors` only.
- `convex/migrations.test.ts` — already exercises a migration; add a sub-test for the new reconcile migrations.

Manual test script (run on staging after each PR):

1. Edit nino-vecia in admin (add a portfolio image, remove another, reorder).
2. Reload `/instructors/nino-vecia`.
3. Confirm the public gallery matches the admin form exactly.
4. Confirm `npx convex data instructorProfiles` and `npx convex data instructors` show the same `portfolioImages` for nino-vecia (post-PR-2).

## Cross-app impact

The Convex backend (`convex/instructors.ts`, `convex/migrations.ts`, `convex/seed.ts`, `convex/schema.ts`) lives at the workspace root and is shared by `apps/platform` and `apps/web`. Changes affect both apps automatically.

The two app-local routes that dual-write (`apps/platform/app/api/admin/instructors/[id]/route.ts`, `apps/platform/app/api/admin/instructors/upload/route.ts`, `apps/web/app/api/admin/instructors/upload/route.ts`) are updated in PR 1 (atomic helper) and PR 3 (drop the second mutation).

There are no consumers of `instructorProfiles` in `apps/huckleberry-drive`, `apps/marketing`, or `apps/home` (`grep` returns nothing).

## Rollback summary

| PR | Rollback method |
| --- | --- |
| PR 1 (Widen) | `git revert` — readers unchanged, behavior identical |
| PR 2 (Migrate) | Restore Convex snapshot taken before the run |
| PR 3 (Narrow) | `git revert` — readers revert, behavior reverts to pre-PR-3 (still correct because PR 2 reconciled data) |
| PR 4 (Drop) | Re-add `instructorProfiles` to `convex/schema.ts` + restore snapshot |

## Open questions

1. **Order semantics during reconciliation.** The plan prefers `instructorProfiles.portfolioImages` order when forming the union (matching what the public page reads today), then appends unique URLs from `instructors`. If admins ever used different orderings between the two tables, this is a one-way decision. Confirm with product before running PR 2 on prod.
2. **`isListed` vs `isActive`.** `instructors.isListed` is the gating field for public visibility today (`getInstructorBySlug` checks `instructor?.isListed === false`). `instructorProfiles.isActive` is a separate boolean. After consolidation, `isActive` lives on `instructors`. Should we keep both fields, or make `isListed` the public-visibility gate and `isActive` the admin-editability gate? Worth a quick product sync.
3. **Should `seedInstructorProfiles` become `seedInstructorProfileFields` (writing to `instructors`)?** Today it exists for demo data. Plan assumes deletion (PR 3). If a future demo needs a separate write, re-introduce it then. YAGNI.
4. **`apps/web` is legacy and on Inngest v3.** Per AGENTS.md, function IDs in `apps/platform` and `apps/web` share a default Inngest app ID. None of the changes touch Inngest function IDs, so this is unaffected. Worth confirming in PR review.

## PR description template

Each PR description should include:

- "Widen-migrate-narrow" header line.
- Link to this plan (`INSTRUCTOR_PROFILES_CONSOLIDATION_PLAN.md`).
- The exact list of files changed and why.
- The verification commands (typecheck, lint, vitest) and their results.
- Manual verification steps (admin edit + public page, nino-vecia).
- For PR 2: the staging diff output (`npx convex data`) before/after.
- Confirmation that Greptile + CodeRabbit passed (per AGENTS.md merge policy).

## AGENTS.md compliance checklist

- [ ] No `mentor/mentee` in code (n/a, no code touches naming).
- [ ] No Clerk changes (n/a, no auth changes).
- [ ] No secrets in PR body, commit messages, or comments.
- [ ] Greptile + CodeRabbit must be green before merge.
- [ ] Sound, durable fix — not a band-aid.
- [ ] Widen-migrate-narrow sequencing.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm vitest` all green.
