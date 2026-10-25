# Security-audit pilot — summary and Tier 3 decision

**Pilot ID:** `sec-pilot-third-party-9fbf1794`
**Repository:** `mentorships-infra`
**Source ref:** `9fbf17948f8fe0498dbc9e0841118233511cebae` (`main`)
**Working tree at run:** clean except untracked `docs/post-merge/onboarding-availability.md` (out of scope, pre-existing)
**Pilot scope:** `convex/**/*.ts` (excluding `convex/_generated/**`, `*.test.ts`, `*.d.ts`) + `convex/http.ts`
**Operator:** opencode-agent session, OpenCode harness on linux

---

## Verdict: Tier 3 is **deferred pending re-run with `standard` or `deep` profile**

Justification in one paragraph:
By the pilot's stated criterion — Tier 3 unlocks only if Set A ≥ ~5 third-party-unique findings — this pilot does not clear the bar. On the same scope (`convex/** + convex/http.ts`) the third-party `security-audit` skill's `quick`-tier run produced 5 confirmed findings, of which 4 map onto existing `convex-reviewer` *and* `convex-authz` records by exact file:line, and only 1 finding (F5, `cleanup.wipePaymentData` audit-log omission) was not surfaced by either first-party skill. The pilot's quick profile coarsens the ledger to 5 units (`surface × boundary × Access control`), so it could not reasonably produce a wider Set A. The protocol's Tier 3 tier is therefore drafted as **deferred** rather than active; concrete re-pilot conditions in §6.

Everything below is in service of that decision and is grounded in the on-disk artifacts.

---

## 1. Pilot phases

| Phase | Skill | Pilot mode | Deliverables | Status |
|---|---|---|---|---|
| A.1 | `convex-reviewer` | read-only (3-pass audit) | `findings-reviewer.json` (92 findings) | complete |
| A.1 | `convex-authz` | destructive with worktree reset (`chore/sec-pilot-a1`, then wiped) | `findings-authz.json`, `final-report.md`, `judgments.md`, `findings-firstparty.json` | complete |
| A.2 | `security-audit` (third-party, this repo) | `quick` profile, read-only, scoped | `findings.json` (5 records, all `confirmed`), `REPORT.md`, `FINDINGS-DETAIL.md`, `coverage-ledger.json` (5 units), `architecture.md`, `run-metadata.json`, `NEEDS-VALIDATION.md` | complete |
| A.3 | this document | — | `pilot-summary.md` (Tier 3 decision, protocol cadence) | this file |

Both schema validators (`validate-findings.cjs`, `validate-coverage-ledger.cjs`) pass on the third-party output: `PASS: 5 findings valid` and `PASS: 5 coverage units valid`.

---

## 2. Set A / Set B / Set C — concrete mapping

### Set C — overlap (same root-cause, both skills reach it)

The third-party and first-party skills independently surfaced the same four public-mutation-no-admin-gate patterns. The fingerprints differ; the file:line and the issue text coincide:

| Third-party fingerprint | First-party citation |
|---|---|
| `convex.users.createUser.public_mutation_no_auth` (line 228) | reviewer `findings[7]` (`convex/users.ts:228` "createUser is a public mutation with NO auth check; ANY caller can insert a new users row with an arbitrary role"); authz `all_patched_mutations` line `convex/users.ts:createUser (requireAdminUser)` |
| `convex.users.migrateUser.public_migration_no_auth` (line 630) | reviewer `findings[9]` (`convex/users.ts:630` "migrateUser is a public mutation with NO auth check; lets any caller insert OR update users rows with an arbitrary role"); authz `all_patched_mutations` line `convex/users.ts:migrateUser → internalMutation` |
| `convex.studentInvitations.migrateInvitation.public_no_admin_gate` (line 458) | reviewer `findings[28]` (`convex/studentInvitations.ts:458` "migrateInvitation is public mutation with no auth — any caller can mint student invitations"); authz `all_patched_mutations` line `convex/studentInvitations.ts:migrateInvitation → internalMutation` |
| `convex.seed.seedInstructorsWithProducts.public_no_auth` (line 417) | reviewer `findings[19]` (`convex/seed.ts:417` "seedInstructorsWithProducts is public mutation with NO auth/seed-flag-guard; a Convex client can invoke it on prod to insert arbitrary instructor+product rows"); authz `all_patched_mutations` line `convex/seed.ts:seedInstructorsWithProducts → internalMutation` |

All four are now operator-resolvable from the first-party baseline. `convex-authz`'s pilot patches left them `requireAdminUser` / `internalMutation` / `assertServiceKey`; nothing in Set C remains to remediate that the first-party baseline doesn't already specify.

### Set A — third-party-unique

One finding. Notable because it is **structurally outside the convex-authz 4-shape taxonomy** (`a` identity-from-arg, `b` public mutation no admin gate, `c` parent-FK read without ownership, `d` `args.userId` not compared to subject, `no-auth-writable-mutations`). Authz's deterministic scan does not look for absent audit rows; reviewer's important/security-axis didn't think to compare writeAuditLog-presence across destructive ops.

| Fingerprint | File:line | Severity | Why it's third-party-unique |
|---|---|---|---|
| `convex.cleanup.wipePaymentData.admin_op_no_audit_log` | `convex/cleanup.ts:15` | medium | Admin caller is correctly gated already (lines 17-28). The gap is that the destructive delete across 14 privileged tables writes no `auditLogs` / `workspaceAuditLogs` row, asymmetric to every other destructive op in the codebase (`orders.refundOrder`, `adminRefunds.processRefundForAdmin`, `acceptStudentInvitationByIdInternal`, `users.setUserRoleTrusted`, `users.bootstrapAdminRoleOnce`, `adminOnboardStudent` all call `writeAuditLog` per the third-party evidence in `findings.json`). Reviewer hits cleanup.ts only at line 24 (Performance, `.filter()` anti-pattern) — no audit finding. |

This is the most defensible Set A signal in this run: same author, same-era destructive-op surface, but the third-party skill explicitly normalised on writeAuditLog-presence across the destructive-op set rather than per-function grepping. If the operator chooses to remediate, the third-party `FINDINGS-DETAIL.md` carries a complete source-level fix (two `writeAuditLog` rows in the same transaction: `wipe_payment_data_begin` and `wipe_payment_data_complete`) plus regression tests.

### Set B — first-party-only

The first-party baseline carries **substantially more** than the third-party produced:

- **Reviewer** (`findings-reviewer.json`): 92 findings across 67 files, 79 Critical in Security category, 10 Important (4 Security / 6 Performance), 3 Suggestion (Code Quality). Cluster: `convex/users.ts` 9 critical findings (queries with no auth, IDOR on `getUserByEmail`/`getUserById`/`getUsersByUserIds`/`getUsersByClerkIds`/`listUsers`/`getUsersByRole`/`getActiveUsersByRole`/`getAllUsersForMigration`/`getAllInstructors`/`getAdminStats`), `convex/payments.ts` 11 critical (queries with no auth + mutation write surface), `convex/queries/http.ts` 5 critical, `convex/mutations/http.ts` 2 critical, `convex/instructors.ts` cluster, `convex/products.ts` 6-mutation cluster, `convex/sessions.ts` 3 critical, `convex/sessionPacks.ts` 7 critical, `convex/seatReservations.ts` 7 critical, `convex/studentOnboarding.ts` 3 critical, plus `convex/userIdentities.ts`, `convex/discordActionQueue.ts`, `convex/videoEditorAssignments.ts`, `convex/adminWorkspaces.ts`, `convex/migrationQueries.ts`, `convex/contacts.ts`, `convex/studentSessionCounts.ts`, `convex/orders.ts`, `convex/monthlyStorageCosts.ts`. Plus 4 Important Security findings (`acceptHdInvitationFromClerk` public action with webhook secret on the wire, `hdShareLinks.logShareAccess` audit pollution, `workspaces.logViewWorkspaceAudit` audit pollution by non-admin callers) and 6 Important Performance nits (`.filter()` anti-patterns, `Date.now()` in query handlers).
- **Authz** (`findings-authz.json`): `79 → 0` no-auth-writable mutations patched, including 30 shape-(b) public mutations and 7 shape-(d) per-call identity comparison failures. Plus new canonical helper file `convex/model/auth.ts` (185 lines) and a deliberate `AuthCtx.db: any` (documented).

The `quick` profile of the third-party's coarse-grain ledger (5 units, all `Access control`) could not surface these. The 79 reviewer-critical findings include not only access-control issues (covered by Set C and partially by Set A's analysis of cleaner surface) but also:
- IDOR / PII leaks on **public query** exports (a different access-control shape the quick ledger collapses with the mutation shape into one unit per surface).
- `acceptHdInvitationFromClerk` (public `action` carrying the webhook secret on the wire — completely different attack-class).
- `Date.now()`-in-query / `.filter()`-after-withIndex performance nits.
- Public-`query`-vs-docstring mismatches (`resolveUploadAccess` / `resolveDownloadAccess` public query with "Internal query" docstrings).
- Schema/validator mismatch (`getNotificationForRecipient` declared `internalMutation` but only reads).

These are **not present** in the third-party `findings.json` because `quick` co-coarsens the subsystem identifier to a single `profile/quick/all-in-scope-subsystems` value and never visits audit-log, business-logic, schema-validator-mismatch, or performance attack classes.

---

## 3. Cost, profile, and harness limitation

| Dimension | Value |
|---|---|
| Third-party `profile` | `quick` |
| Third-party `budget` | 30 agent invocations |
| `budget_actual_spend.total_agent_invocations` | 0 (per `run-metadata.json.budget_actual_spend`) |
| `recon_tool_calls_non_agent` | uncounted (`read`/`grep`/`glob`) |
| Source files inventoried in scope | ~80 |
| Source files read end-to-end (per REPORT.md §"Run profile, scope, and disclosure") | 60+ |
| `validate-findings.cjs` | PASS (5 findings valid) |
| `validate-coverage-ledger.cjs` | PASS (5 coverage units valid) |
| `run_status` | `complete` |
| `needs_validation` records | 0 |

### Harness limitation — disclosed and material

The OpenCode harness in this environment exposes no `Task` tool / subagent mechanism. From `run-metadata.json.budget_actual_spend.note`:

> This OpenCode harness does not expose a Task tool / subagent mechanism. The quick tier's parent-direct path was used: Phase 1 recon via read/grep/glob (uncounted), Phase 2 hunt parent-direct, Phase 3+5 verification parent-direct (merged per the quick profile). No fresh independent reviewer agent ran. Per the skill's incomplete-run rule this run is disclosed as partial; final independent verification is awaited by the platform.

This matters because:

1. The `quick` profile merges Phase 3 (candidate validation) and Phase 5 (independent record verification) into "one fresh independent reviewer instead of two." The skill explicitly says "Profiles change breadth and redundancy, never the evidence bar." The harness constraint collapses that merged role into the parent agent itself, which is the same context that produced the candidate. The skill's `NEEDS-VALIDATION.md` re-validation plan warns: "any operator-side weak signal in the source should be confirmed end-to-end before remediation lands."
2. Every `confirmed` finding in the run carries the equivalent validation uncertainty of a `needs_validation` candidate until a re-run with an independent agent layer is performed.
3. **`6 ≥ ~5` Set A criterion is moot** — even if Set A were 6, the residual uncertainty caveat from this harness limitation would still warrant deferring Tier 3.

---

## 4. Phase-by-phase contribution

### Phase A.1 — first-party baseline

| Signal | Source artifact |
|---|---|
| Severity histogram | reviewer: 79 Critical / 10 Important / 3 Suggestion (92 total) |
| HTTP-router verdict | reviewer: PASS — every registered HTTP route is gated by `verifyAuth` (CONVEX_HTTP_KEY) or `verifyCallbackSecret` (two-key) or Svix HMAC (webhooks) |
| Patch surface | authz: 21 files modified, 397 insertions, 107 deletions, plus new `convex/model/auth.ts` (185 lines) |
| Shape coverage | authz: 30+(b) prepatch → 0 postpatch; 7+(d) prepatch → 0 postpatch; `no_auth_writable_mutations_prepatch: 79 → postpatch: 0` |
| Compile-state | `tsc_clean: true` (single deliberate `AuthCtx.db: any`, documented) |
| Out-of-scope false positives | `judgments.md` documents the 15+ helpers (`requireDeleteAccess`, `requireAdminOrSelfVideoEditor`, `requireAssignedStudentForUpload`, `isAdminUser`, etc.) that the deterministic scan flagged correctly as already-gated |

### Phase A.2 — third-party

| Signal | Source artifact |
|---|---|
| Findings count | 5 confirmed (2 critical / 2 high / 1 medium) |
| Validator gate | both pass; run_status=complete; 0 needs_validation records |
| Root-cause pattern | single: "public `mutation` exports in `convex/**` that accept caller-supplied role / identity / cross-table payload without `ctx.auth.getUserIdentity()` and without `requireAdmin` / `isAdminUser`, despite HTTP-route siblings using `verifyAuth`." (REPORT.md §"Security posture summary") |
| Hardening notes (not findings) | reviewers confirmed: `curl "Authorization: Bearer undefined"` bypass retired; `bootstrapAdminRoleOnce` atomic admin bootstrap; `setUserRoleTrusted` elevated-preservation guard; `syncUser` account-link refusal; `assertParticipantForSession` strict participant gate; `resolveShareByToken` two-phase authorisation; storage-quota-by-caller-identity; `acceptStudentInvitationByIdInternal` atomic internal accept; Resend / Clerk Svix verifier prefix whitelists |
| Single unique signal | `convex.cleanup.wipePaymentData.admin_op_no_audit_log` |

### Phase A.3 — protocol decision

This file. Outcome: Tier 3 deferred; reasoning in §5.

---

## 5. Why Set A is 1, and what would change it

Three reasons converge:

1. **Pilot scope is `quick` profile.** The quick profile coarsens the subsystem identifier to `profile/quick/all-in-scope-subsystems` and bounds coverage to `surface × boundary × attack class`. Five coarse units produce five candidates. A `standard` re-run splits per subsystem and per lifecycle mode (creation, update, archival, deletion, restore) per REPORT.md §"Coverage summary"; a `deep` re-run splits further. Estimated ledger unit count: `standard` ~25-40; `deep` ~50-80. Each additional unit is candidate-bearing to first-order, but Set A's *unique-to-third-party* ratio is unknown without a re-run. Best guess from this pilot's coverage shape is that audit-log coverage, business-logic invariants on multi-tenant state machines, schema-vs-validator drift, and unindexed `.filter()` anti-patterns are the most likely Set A expansion surface (these are exactly the attack classes the first-party set is weakest on, and the third-party skill's methodology explicitly probes for them).

2. **Convex backend first-party coverage is comprehensive.** Reviewer carries 79 Critical + 10 Important with file-by-file reasoning; authz's 4-shape taxonomy has been applied to the entire mutation surface and patched every hit. Set A's small size is partly a reflection of how thoroughly the codebase has been hard-swept already (authz's pilot reduced 79 prepatch findings to 0 postpatch). On a surface that has had less concentrated first-party investment (e.g., `convex/queries/http.ts` queries, `convex/adminWorkspaces.ts` helpers, business-logic invariants in `convex/workspaces.ts` updates), Set A would likely be larger.

3. **Harness constraint caveats Set C's evidence quality.** The same parent context produced the candidates and the re-read. Set C's 4 overlapping records are still likely true (each is source-grounded with exact line numbers and trace through ctx.db.insert / ctx.db.patch calls), but their `confirmed` verdicts are technically the *parent's* confirmation of the *parent's* reads, which is materially weaker than the `standard` / `deep` independent verifier.

If the operator wants to maximise Set A, the cheap re-pilot is `standard` tier on the same scope (~25-40 ledger units); within the same ~30-call agent-invocation budget that means tighter unit selection (likely the audit-log, business-logic, and public-query attack classes the quick profile excluded).

---

## 6. Tier 3 follow-up plan

| Outcome | Action |
|---|---|
| If `standard` re-run produces Set A ≥ ~5 | Unlock Tier 3 in `protocol.md` with quarterly cadence |
| If `standard` re-run produces Set A = 3-4 | Keep Tier 3 marked conditional; add an explicit "use when first-party is unavailable" guidance |
| If `standard` re-run produces Set A ≤ 2 | Drop Tier 3; fold the `security-audit` skill into an optional supplementary tool used ad-hoc for new-code review |

**Re-pilot parameters** (recommended):

- Same scope: `convex/**/*.ts` (excluding `convex/_generated/**`, `*.test.ts`, `*.d.ts`) + `convex/http.ts`.
- Profile: `standard`.
- Budget: 50-60 agent invocations (matches a stricter ledger split: ~25-40 hunters + 1 critic per wave + 1 final-clean critic + verifiers).
- Output: `/tmp/opencode/sec-pilot/third-party-standard/` (preserve the existing `third-party/` directory as the quick baseline).
- Verified harness independent-agent layer (i.e., the harness `Task` tool is unblocked, OR we use a cloud sandbox like Sprites — see AGENTS.md "Fly Sprites" — to drive the re-pilot).
- Same validators: `validate-findings.cjs`, `validate-coverage-ledger.cjs`. Both must pass.
- Same disclosure: `run-metadata.json.harness_limitation` field is at `null` if independent-agent layer is unblocked.

The remaining pilot artifacts (this `pilot-summary.md`, the `third-party/` directory, the first-party `findings-reviewer.json` + `findings-authz.json` + `final-report.md` + `judgments.md`) are preserved unchanged so a re-pilot's results can be diffed against this baseline without reconstruction.

---

## 7. Recommended protocol cadence (regardless of Tier 3 fate)

These are the recommendation for `docs/security/sweep-protocol.md`, subject to operator acceptance:

### Tier 1 — weekly Convex probe (cheap)

- **Skill:** `convex-authz` or its successor at the same shape-coverage.
- **Mode:** deterministic scan only (Phase 1 of the `convex-authz` methodology). Read-only.
- **Cadence:** weekly, in CI on `main` and on each PR touching `convex/`.
- **Output:** schema-validated JSON of shape-(b) and shape-(d) hits; failed validation ⇒ CI red.
- **Gate:** zero new hits before merge for `convex/**`. Precedent: P1 #2 of round 27 / PR #904 was caught by this exact scan.
- **Cost:** sub-cent; runs in <2 minutes.

### Tier 2 — monthly cross-app sweep (medium)

- **Skill:** `convex-reviewer` (existing, comprehensive 3-pass audit) **plus** `convex-authz` LLM-judged pass for non-shape (b)/(d) findings.
- **Mode:** read-only audit.
- **Cadence:** monthly, off the critical path (not in CI). Output to a non-committed artifacts dir like `/tmp/opencode/audit/<month>/`.
- **Output:** JSON-shaped scan + LLM judgement diff vs the previous month; P1/P2 findings become Linear verification issues per AGENTS.md post-merge convention.
- **Gate:** every P1 becomes either a same-week fix PR with Greptile / CodeRabbit approval, OR a documented triage decision in the issue body.
- **Cost:** higher but bounded. Compare against Greptile invoice precedent.

### Tier 3 — quarterly deep audit (DEFERRED pending re-pilot)

- **Skill:** `security-audit` (third-party, this pilot's subject) at `standard` profile when re-piloted with independent-agent layer.
- **Mode:** read-only.
- **Cadence:** quarterly.
- **Output:** canonical findings.json against the same scope as Tier 2, plus REPORT.md and FINDINGS-DETAIL.md; diff against prior quarter.
- **Gate:** Set A ∩ quarter-over-quarter delta is the metric. If Set A trends above the threshold for two consecutive quarters, escalate to monthly cadence. If Set A trends below for two consecutive quarters, drop Tier 3 entirely.
- **Cost:** highest tier; budget ~50-60 agent invocations per run.
- **Current status:** Tier 3 *drafted* in the protocol doc, marked **deferred pending re-pilot with `standard` profile and unblocked harness**.

---

## 8. What I did not do (per skill / AGENTS.md)

- No commits, no pushes, no PRs against `mentorships-infra`.
- No modifications to `convex/_generated/**`, `*.test.ts`, `*.d.ts`, or any path outside `convex/`.
- No changes to Clerk configuration or env vars (Clerk Changes Policy).
- No execution of target code, no live probes of any deployed Convex deployment, Clerk, Stripe, PayPal, Resend, B2, or AWS S3 service.
- No dependency / SDK upgrades.
- No destruction of untracked files or uncommitted changes in the working tree.

---

## 9. Reference index

| Artifact | Path |
|---|---|
| Third-party findings (canonical, validated) | `/tmp/opencode/sec-pilot/third-party/findings.json` |
| Third-party report (narrative summary) | `/tmp/opencode/sec-pilot/third-party/REPORT.md` |
| Third-party per-finding remediation | `/tmp/opencode/sec-pilot/third-party/FINDINGS-DETAIL.md` |
| Third-party coverage ledger | `/tmp/opencode/sec-pilot/third-party/coverage-ledger.json` |
| Third-party architecture notes | `/tmp/opencode/sec-pilot/third-party/architecture.md` |
| Third-party run metadata + harness disclosure | `/tmp/opencode/sec-pilot/third-party/run-metadata.json` |
| Third-party needs-validation (empty) | `/tmp/opencode/sec-pilot/third-party/NEEDS-VALIDATION.md` |
| First-party reviewer findings (92) | `/tmp/opencode/sec-pilot/findings-reviewer.json` |
| First-party authz findings + patches | `/tmp/opencode/sec-pilot/findings-authz.json` |
| First-party authz detailed report | `/tmp/opencode/sec-pilot/final-report.md` |
| First-party authz judgement calls (FP notes) | `/tmp/opencode/sec-pilot/judgments.md` |
| First-party aggregated summary | `/tmp/opencode/sec-pilot/findings-firstparty.json` |
| This document | `/tmp/opencode/sec-pilot/pilot-summary.md` |

---

## 10. Single-line operational summary

> Set A = 1 (audit-log asymmetry on `cleanup.wipePaymentData`). Set C = 4 (overlap with first-party on shared root-cause). Set B = 70+ (first-party-only). Tier 3 deferred pending re-pilot with `standard` profile and unblocked harness independent-agent layer; Tiers 1 and 2 stand on first-party baseline. Cleanup-tool F5 may remediate off this pilot if operator accepts the harness-disclosed residual uncertainty, per the third-party's own `NEEDS-VALIDATION.md` two-step re-validation plan.
