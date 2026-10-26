# Security sweep — session scope of work

**Session date:** 2026-10-24 → 2026-10-25
**Base ref at start:** `main@9fbf1794`
**Arc merged at:** `main@9fb2c6b6` (three planned PRs); follow-up remediation
merged through `main@6cf769bd` + #959 + #962 (`5ab209e3`)
**Driver:** `opencode-agent`, at the request of `@dlitorja`
**Status:** **COMPLETE** — the three planned PRs plus the four follow-up
remediation PRs are merged. The close-out audit's material risk (§5) is
remediated; the Tier 1 baseline is triaged in
[`tier1-probe-triage-2026-10.md`](./tier1-probe-triage-2026-10.md).

---

## 0. Outcome

| # | PR | Merge commit | Scope | Review |
| --- | --- | --- | --- | --- |
| 1 | #954 `docs(security): rescue security-audit pilot artifacts into pilot-baseline` | `88720984` | 43 files, +9,513 | Greptile pass, 0 comments |
| 2 | #955 `fix(convex): audit-log the destructive payment-data wipe` | `2757c76f` | 2 files, +325 / −2 | Greptile pass after one P2 fix |
| 3 | #956 `chore(ci): add advisory Tier 1 convex authz probe` | `9fb2c6b6` | 9 files, +1,640 | Greptile pass after one P1 + one P2 fix |
| 4 | #957 `fix(convex): make legacy migration helpers internal-only` | `244b8b28` | 17 files, +246 / −23 | Greptile pass, 0 comments |
| 5 | #958 `fix(convex): make users.createUser internal-only` | `6cf769bd` | 11 files, +349 / −30 | Greptile pass, 0 comments |
| 6 | #959 `fix(convex): close remaining public queue/linking mutations` | `9ba524d2` | 10 files, +276 / −25 | Greptile pass, 0 comments |
| 7 | #960 `docs(security): commit sweep arc record and Tier 1 triage` | `827d023e` | 2 files | Greptile pass, 0 comments |
| 8 | #962 `fix(convex): close scan-b authz findings and gate instructor credentials` | `5ab209e3` | 24 files, +1,000 / −147 | Greptile 5/5 after 3 P1 + 1 P2 fixes |

Rows 4–8 are the follow-up remediation described in §5. CodeRabbit skipped
every PR with *"manual review required for this OSS repository"* (repo < 10
stars) — treated as unavailable, per AGENTS.md.

---

## 1. Objective

Convert the completed security-audit pilot into three durable, independently
reviewable changes:

1. Get the pilot artifacts out of `/tmp` (durability).
2. Ship the one confirmed finding the arc scoped for remediation (F5).
3. Wire the weekly first-party scan into CI, advisory-first, with a written
   protocol.

Tier 3 (the third-party `security-audit` skill as a recurring quarterly
cadence) remains **deferred** and unactivated.

---

## 2. Delivered

### PR 1 — pilot artifacts (#954, `88720984`)

| Item | Detail |
| --- | --- |
| Content | `docs/security/pilot-baseline/` — 43 files, 664K |
| Includes | `pilot-summary.md`, `final-report.md`, `judgments.md`, `findings-{reviewer,authz,firstparty}.json`, `findings-raw.{json,txt}`, `findings-noauth.txt`, historical `scan.ts` / `scan-noauth.ts`, `tsc-output.log` |
| Third-party set | `pilot-baseline/third-party/` — 7 files (`findings.json`, `REPORT.md`, `FINDINGS-DETAIL.md`, `coverage-ledger.json`, `architecture.md`, `run-metadata.json`, `NEEDS-VALIDATION.md`) |
| Provenance | `pilot-baseline/inspection/security-audit-skill/` — skill source as inspected, embedded `.git` stripped; `inspection/PROVENANCE.md` records upstream `cloudflare/security-audit-skill@c1c8a8c`, 2026-09-14, MIT |
| Diff shape | additions only; no tracked file modified |

### PR 2 — F5 audit trail (#955, `2757c76f`)

| Item | Detail |
| --- | --- |
| Change | `convex/cleanup.ts` +77 / −2 — `writeAuditLog` import; `auditTargets` list; `wipe_payment_data_begin` + `wipe_payment_data_complete` rows bracketing the existing deletion loop |
| Tests | `convex/cleanup.test.ts` — 248 lines, 4 tests |
| Invariant | Both audit rows commit iff the wipe commits. A mid-loop throw rolls back partial deletes **and** both rows — no orphan "begin" row. |
| Privacy | `metadata` carries per-table **counts only**; no payment data, emails, or provider IDs |
| Target table | `auditLogs` (singular), via `convex/auditLog.ts` — **not** `workspaceAuditLogs`, which is itself on the wipe list |
| Test evidence | seeds `orders`, `payments`, `workspaces`, `workspaceAuditLogs`, `marketingWaitlist`; asserts counts of `1` (not `0`), every table emptied, `users` preserved, `metadata.results === result.deleted`, and that the seeded email / `pi_live_…` / customer id never reach the audit record |
| Also fixed | stale duplicated docstring line still listing the retired `mentors` table (AGENTS.md naming rule) |

The first revision seeded only a user, so every count assertion passed on zeros.
Greptile's P2 caught it; the fixtures are now non-empty by design.

### PR 3 — Tier 1 probe (#956, `9fb2c6b6`)

| Item | Detail |
| --- | --- |
| Content | `.github/workflows/convex-probe.yml`, `.scripts/convex-probe/` (7 files incl. `package-lock.json`), `docs/security/sweep-protocol.md` (426 lines) |
| Schedule | cron `0 12 * * 1` UTC = Mon 06:00–07:00 US Central (DST-dependent) |
| Also runs on | PRs touching `convex/**`, `.scripts/convex-probe/**`, or the workflow file itself (self-validating); manual dispatch |
| Output | `convex-probe-findings` artifact + sticky `convex-probe` PR comment with shape counts |
| Gating | **Phase A (weeks 1–4) advisory-only — never blocks.** Phase B (week 5+) may block on new shape-(b)/(d) hits after the FP rate is measured |
| Portability | Scripts take `CONVEX_DIR` as `argv[2]`, default `./convex`; detection logic unchanged from the pilot |
| Determinism | committed `package-lock.json` + `npm ci` (directory is outside the pnpm workspace; `packages/storage/package-lock.json` is the precedent) |
| Validated on its own PR | `probe` job ran and passed in 16s: `total 37` (b=30, d=7), scan-d 79, artifact uploaded |
| Docs | Protocol §9 rewritten (real paths, Phase A/B, cron, `npm ci`), §11 expanded, §12 repointed at `docs/security/pilot-baseline/` |

---

## 3. Defects found during the arc

Five defects were found and fixed before merge. Two would have broken the
workflow's first run.

| # | Defect | Found by | Fix |
| --- | --- | --- | --- |
| 1 | `scan-b.ts` had `/\/\*[\s\S]*?\*/\g/` — `\g` where the flag should be `g`, a syntax error. `tsx` could not parse the file, so the scan step would have failed | local validation | corrected flag |
| 2 | README linked `../security/sweep-protocol.md`, which resolves to `.scripts/security/…` and does not exist | local validation | `../../docs/security/sweep-protocol.md` |
| 3 | `npm install` with no lockfile resolved the latest `tsx` every run | engineering review | `package-lock.json` + `npm ci` |
| 4 | Empty scans wrote one newline, so `wc -l` reported **1 finding when there were 0** | Greptile P2 | scanners write an empty file when `out.length === 0` |
| 5 | Fork PRs get a read-only `GITHUB_TOKEN`, so the sticky-comment POST would 403 and fail the job even when both scans succeeded | Greptile P1 | comment step requires `head.repo.full_name == github.repository`; not `pull_request_target` |

Also normalized `scan-b.ts` / `scan-d.ts` to mode 644 (one was 755).

---

## 4. Post-merge state

- **Local baseline** (used as the drift reference): scan-b `37` hits —
  `a=0 b=30 c=0 d=7`; scan-d `79` no-auth writable mutations at #956.
- **Baseline after the follow-up remediation:** scan-b `37` (unchanged — none
  of the converted functions were shape-b/d candidates); scan-d `62` at #959
  (`64` at `main@6cf769bd`). The F-series removed 17 public writers from
  scan-d.
- **Tier 1 triage:** all 99 hits reviewed — see
  [`tier1-probe-triage-2026-10.md`](./tier1-probe-triage-2026-10.md). Verdict:
  scan-b is 91.9% false positive (admin-by-design), scan-d is 19.4% false
  positive (five unrecognised guard idioms). Neither detector is ready for
  Phase B blocking as-is.
- **Linear HUC-114** — *"Verify Tier 1 convex probe's first scheduled run
  (Mon 2026-10-26 12:00 UTC)"*, state `In Progress`, labels
  `workflow-change` / `verification` / `prod`. Contains T1–T7 (first cron,
  artifact, tally drift, per-PR comment, advisory-not-required) and the
  Phase A exit criteria.
- **Linear HUC-115** — *"Verify the Convex public-mutation authz fixes on
  prod"*, state `In Progress`, labels `auth-change` / `security-change` /
  `verification` / `prod`, T1–T8 covering F1–F4 plus the two #959 paths.
- **First scheduled run:** Mon 2026-10-26 12:00 UTC (07:00 US Central).
- `main` working tree carries no changes from this arc.

---

## 5. Pilot findings F1–F4 — remediated after the arc

The three-PR arc remediated **only F5 (medium)**. A close-out audit then found
the pilot's four higher-severity findings still present in `main@9fb2c6b6`, so
two follow-up PRs closed them.

| PR | Merge commit | Scope |
| --- | --- | --- |
| #957 `fix(convex): make legacy migration helpers internal-only` | `244b8b28` | F2, F3, F4 + eleven more public migration helpers |
| #958 `fix(convex): make users.createUser internal-only` | `6cf769bd` | F1 |
| #959 `fix(convex): close remaining public queue/linking mutations` | `9ba524d2` | F6, F7 |

| ID | Function | Severity | Was | Status |
| --- | --- | --- | --- | --- |
| F1 | `convex.users.createUser` | **critical** | public `mutation`; accepted client `role` (incl. `"admin"`) and `clerkId` | **FIXED #958** |
| F2 | `convex.users.migrateUser` | **critical** | public `mutation`; patched `role` | **FIXED #957** |
| F3 | `convex.studentInvitations.migrateInvitation` | high | public `mutation` | **FIXED #957** |
| F4 | `convex.seed.seedInstructorsWithProducts` | high | public `mutation`; no-arg catalogue overwrite | **FIXED #957** |
| F5 | `convex.cleanup.wipePaymentData` | medium | admin-gated (unchanged) | **FIXED #955** |
| F6 | `convex.discordActionQueue.migrateDiscordAction` | high | public `mutation`; attacker-chosen `payload` that the Discord bot later executes | **FIXED #959** |
| F7 | `convex.instructors.backfillInstructorUserId` | high | public `mutation`; overwrote any instructor's `userId`, enabling profile takeover | **FIXED #959** |

Why it mattered: Convex gates only `internalMutation` behind the deploy key, so
a public `mutation` is callable by anyone holding the deployment URL — which is
`NEXT_PUBLIC_CONVEX_URL`, public by design. `createUser` accepted an
attacker-chosen `role: "admin"` and `clerkId`, and `convex/admin.ts:isAdminUser`
trusts the stored role on the next request. The pilot's containment note said
"any authenticated ConvexClient"; the handlers had no
`ctx.auth.getUserIdentity()` check at all, so unauthenticated calls reached
them too.

### What was done

- **#957** converted fourteen legacy helpers to `internalMutation`. All had
  zero callers or script-only callers via `npx convex run`, which authenticates
  with the deploy key and can invoke internal functions. Beyond the three pilot
  findings it swept eleven more public `migrate*` helpers of the same shape
  that the pilot never enumerated: `userIdentities`, `monthlyStorageCosts`,
  `products`, `sessionPacks`, `videoEditorAssignments`, `instructors`,
  `payments`, `instructorUploads`, `contacts`, `studentSessionCounts`, and
  `seatReservations`. A new `convex/migrationSurface.test.ts` pins the
  invariant via Convex's registration metadata.
- **#958** converted `users.createUser` to `internalMutation`. The bearer-gated
  `POST /users/create` httpAction already existed and was already used by
  `apps/platform`; the two `apps/web` Inngest call sites now use it through
  `convexServerCall`. Tests cover 401 without a bearer and with a wrong bearer,
  plus the 200 path (one student placeholder row, idempotent by email).
- **#959** closed the two caller-coupled cases that a visibility flip alone
  could not fix:
  - `discordActionQueue.migrateDiscordAction` → `internalMutation`, plus a new
    bearer-gated `POST /discord-action-queue/migrate` endpoint. The three
    Inngest call sites (one in `apps/web`, two in `apps/platform`) now use
    `convexServerCall`. The legacy migration script keeps working through
    `npx convex run`.
  - `instructors.backfillInstructorUserId` → `internalMutation` for the
    invitation/webhook linking path, plus a new identity-scoped public
    `linkMyInstructorProfile` for the Google Calendar OAuth callback. The new
    mutation derives `userId` from `ctx.auth` and requires the instructor row's
    email to match the caller's identity email, so a signed-in instructor can
    only link their own placeholder row. The callback's `!instructor.userId`
    check became `instructor.userId !== user.id`, which also heals
    `admin-<slug>` / `seed-<slug>` placeholder rows.

### Deliberately still public

One instance of the same shape is intentionally left as-is:

| Function | Callers | Why it stays public |
| --- | --- | --- |
| `convex.orders.migrateOrder` | `scripts/migrate-to-convex/04-migrate-orders.ts` | Already gated by the `serviceKey` argument (`assertServiceKey`) |

The Tier 1 probe still flags a large class of no-auth writable mutations
(`scan-d` = 62 at #959). Those are **out of scope for this arc** and are
triaged, grouped into remediation waves, in
[`tier1-probe-triage-2026-10.md`](./tier1-probe-triage-2026-10.md).

---

## 6. Out of scope

- Tier 3 activation (any third-party quarterly run) — deferred; unlock
  conditions in protocol §4.
- Any Clerk configuration, env var, dashboard-domain, or `ClerkProvider` change
  (AGENTS.md "Do Not Touch").
- Any migration, schema change, or Supabase/Trigger.dev/Inngest/Cloudflare infra
  change.
- Production calls, deploys, or data mutations.
- Refactoring the 15 inline delete blocks in `cleanup.ts` into a loop (would
  require an unsafe `as any` table-name cast; deliberately left alone).
- Remediating F1–F4 (§5) — this arc was scoped to F5 only. They were closed in
  follow-up PRs #957–#959 after the close-out audit.
- Branch-protection changes: the `probe` job stays non-required until Phase B.

---

## 7. Verification checklist

- [x] Each worktree diff reviewed and scoped to its own PR (no cross-contamination).
- [x] `git status --short` in the main working tree shows no changes introduced by this session.
- [x] Secret scan clean across all additions (real-credential patterns; narrative prefix mentions are not secrets).
- [x] Naming: no `mentor`/`mentee` in code or artifacts (`mentorships` in UI copy is the only exception); the stale `mentors` docstring line in `cleanup.ts` was removed.
- [x] F5: non-admin still throws `Forbidden`; admin call produces exactly two `auditLogs` rows; counts are non-zero with seeded fixtures; rows survive the `workspaceAuditLogs` wipe — all automated in `convex/cleanup.test.ts` and run in CI (`Convex Tests`, 55s).
- [x] Tier 1: workflow YAML parses; scripts run locally (`npx tsx scan-b.ts ./convex` → 37; `scan-d.ts` → 79); artifact upload path resolves; empty-input run writes 0 bytes.
- [x] Tier 1 workflow exercised on its own PR (probe job passed, 16s).
- [x] Greptile visible and passing on all three PRs; CodeRabbit OSS-skipped per policy; `mergeStateStatus: CLEAN` at each merge.
- [x] F1–F7 follow-ups: full convex suite 765 passed; root/`apps/web`/`apps/platform` typecheck clean; `eslint --max-warnings=0` clean on every changed file.
- [x] Every converted helper is pinned as internal by `convex/migrationSurface.test.ts`; bearer endpoints cover 401-without/wrong-bearer and 200; the identity-scoped linking mutation covers unauth, email mismatch, cross-user takeover and idempotent re-link.
- [x] Tier 1 triage covers all 99 hits with a per-hit verdict (no sampling).

---

## 8. Risks and mitigations (as executed)

| Risk | Mitigation | Outcome |
| --- | --- | --- |
| Audit rows land in `workspaceAuditLogs` and are deleted by the wipe itself | Verified `writeAuditLog` writes to `auditLogs`; documented in the F5 docstring | Held |
| Wipe failure leaves a misleading "complete" row | No try/catch; all-or-nothing transaction; rollback removes both rows | Held |
| Scan produces noisy hits and becomes a blocker before calibration | Phase A advisory-only for four weeks; Phase B requires a measured FP rate | Held |
| Script path drift after moving out of `/tmp` | `CONVEX_DIR` CLI argument, default `./convex` | Held (plus defect #1 fixed) |
| Parallel agent sessions clobbering worktrees | Work confined to three named worktrees; no `git checkout` in main; no touches to sibling worktrees | Held |
| Committing pilot output that contains secrets | Scanned; only prefix-pattern narration flagged, no real values | Held |

---

## 9. Rollback

Each PR is independently revertible:

- **PR 1** — delete `docs/security/pilot-baseline/`; no runtime impact.
- **PR 2** — revert `convex/cleanup.ts` and `convex/cleanup.test.ts`; wipe
  behavior returns to pre-fix (unaudited) with no data impact.
- **PR 3** — delete the workflow and `.scripts/convex-probe/`, revert the
  protocol doc; CI returns to no probe.

None of the three touches data, schema, or auth gates, so no data rollback is
required.

---

## 10. Follow-ups

Done during this arc:

- [x] Add the F5 validation tests (4 tests in `convex/cleanup.test.ts`).
- [x] Fix the stale `mentors` reference in the `cleanup.ts` docstring.
- [x] Remediate F1–F4 (§5): #957 (`244b8b28`) and #958.
- [x] Sweep the wider public-migration surface (eleven extra helpers) and pin
  it with `convex/migrationSurface.test.ts`.
- [x] Remediate the caller-coupled public mutations (§5 F6/F7): #959 —
  `discordActionQueue.migrateDiscordAction` via a bearer endpoint,
  `instructors.backfillInstructorUserId` via `linkMyInstructorProfile`.
  `orders.migrateOrder` is already service-key gated.
- [x] Triage all 99 Tier 1 hits (37 scan-b + 62 scan-d) and record the Phase A
  false-positive rate: `docs/security/tier1-probe-triage-2026-10.md`.
- [x] Remediate the three scan-b true positives (#962, `5ab209e3`):
  - `payments.adminProcessRefund` now enforces the admin role and shares one
    refund body with `adminProcessRefundInternal`, which adds the missing
    over-refund cap and rejects non-positive / non-numeric amounts.
  - `products.getProductForAdmin` now enforces the admin role.
  - Every public instructor query (`getInstructorById`, `getInstructorByUserId`,
    `getInstructorByUserIdExternal`, `getInstructorByEmail`,
    `getCurrentInstructor`, `getInstructorBySlugForAdmin`) strips
    `googleRefreshToken`. Server routes that need the credential read it from
    the new `internal.instructors.getInstructorGoogleCredentialsInternal`
    through the `CONVEX_HTTP_KEY`-gated `POST /instructors/google-credentials`
    endpoint, so no browser can obtain it.
  - Note for Phase B: `scan-b` still flags `getInstructorById` and
    `getProductForAdmin` because `hasIdentityComparison` does not follow
    helper gates (`isAdminUser`, `requireAdminActor`). Both are covered by
    tests; this is another entry for the detector-hardening backlog.

Open:

1. **Detector hardening** before Phase B: teach `scan-d` the five guard idioms
   it misses and dedupe per function (expected 62 → 50 hits, 0% FP). Keep
   `scan-b` advisory — it is 91.9% FP because it flags admin-by-design
   mutations. Details in the triage doc §4. Tracked as **HUC-121**.
2. **Remediate the 50 real no-auth writable mutations** in five domain waves
   (money, instructor-profile integrity, entitlements, catalogue/identity,
   housekeeping). Until they land, Phase B must use an allowlist and block only
   on *new* scan-d hits. Details in the triage doc §5. Tracked as **HUC-116 –
   HUC-120** in the *Convex authz remediation* project.
3. Formalise `tier1.diff.json` (week-over-week shape-count baseline) before
   Phase B gating. The design existed in an earlier draft of the protocol; the
   merged §9 deliberately defers it to the per-tier owner. That draft is backed
   up at `/tmp/opencode/sweep-protocol-main-draft-2026-10-25.md`.
4. Decide the fate of `cleanup.wipePaymentData` itself: it has **zero callers**
   and is a destructive admin mutation. Delete it, or gate it to non-production
   deployments.
5. Revisit Tier 3 when an independent-agent harness is available and Set A ≥ 5.
6. Assign a named per-tier owner (default currently the most recent Tier 2
   operator) and record the transfer in protocol §11.
7. Close HUC-114 after the first scheduled run is verified; close HUC-115 after
   the T1–T11 smoke tests pass on prod.
