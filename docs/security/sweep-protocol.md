# Security sweep protocol

> Owner: per-tier ownership defaults to the operator who most recently ran Tier 2 (during the pilot described below, this was `opencode-agent` at the request of `@dlitorja`). Reassignment is allowed and recorded by amending §11 with the new owner's handle and the date of transfer.
> Pilot ID this protocol was first drafted on: `sec-pilot-third-party-9fbf1794`.
> Source ref at draft time: `main@9fbf17948f8fe0498dbc9e0841118233511cebae`.
> Status (2026-10-24): Tier 1 ACTIVE in CI (Phase A — advisory), Tier 2 ACTIVE, **Tier 3 DEFERRED** pending re-pilot. Post-pilot arc shipped via three independent PRs gated on Greptile + CodeRabbit per AGENTS.md: PR 1 — `docs/rescue-security-audit-pilot-artifacts` (pilot artifacts rescued into `docs/security/pilot-baseline/`); PR 2 — `fix/convex-cleanup-wipePaymentData-audit-log` (F5 audit-log asymmetry); PR 3 — this file + `chore/ci-tier1-convex-probe` (workflow + `.scripts/convex-probe/`).

This protocol operationalises the security-audit pilot into a recurring cadence. It is **supplementary** to the per-PR review gates (Greptile + CodeRabbit) that AGENTS.md §"Pull Request Merge Policy" marks canonical. It does **not** replace those gates, the Linear post-merge verification convention, the Clerk Changes Policy, or the Secret Protection Policy.

## 1. Scope

In-scope:

- `convex/**/*.ts` (excluding `convex/_generated/**`, `*.test.ts`,
  `*.d.ts`)
- `convex/http.ts` explicitly
- documentation under `docs/security/`

Out-of-scope (the protocol does not re-audit):

- `apps/web/**`, `apps/platform/**`, `apps/edge-functions/**`,
  `apps/huckleberry-drive/**`, `apps/home/**`, `apps/marketing/**`
- `packages/db/**`, `packages/ui/**`, worker packages
- schema migrations (Supabase)
- Trigger.dev / Inngest / Supabase / Cloudflare config and infra
- generated code under `convex/_generated/**`

If a new app or package joins the surface, treat it as out-of-scope
until a separate pilot narrows the ledger; do not silently widen
this scope.

## 2. Conventions

### Naming

Per AGENTS.md §"Naming Conventions: NEVER use mentor/mentee", every
audit artifact (report prose, fingerprint names, JSON keys, code
snippets, regression-test names) uses `instructor`/`student`.
The words `mentor` and `mentee` are forbidden; the only exception is
the word `mentorships` in UI copy.

### Clerk

Per AGENTS.md §"Clerk Changes Policy (Do Not Touch)", this protocol
does not modify Clerk configuration, env vars, dashboard domains,
or `ClerkProvider` props anywhere. The audit surface is read-only
against Clerk. `verifyAuth` (CONVEX_HTTP_KEY bearer) on
`convex/http.ts:35-70` is treated as a control, not a target.

### Secrets

Per the secret-protection policy at the top of AGENTS.md, any
documentation referencing environment variables uses placeholders
(`<VALUE>`, `<COPY_FROM_APP_X>`). Never commit real secrets to
docs, PR bodies, audit-artifact metadata, or commit messages.

### Source visibility (third-party skills)

Every record in a findings file names the lower-trust principal,
the accepted input, the control, the crossed boundary, and the
observed result. "Missing best practice" or "guessed deployment
behavior" do not become findings per doctrine. Records that cannot
be confirmed from source carry `verdict: needs_validation` and
**zero severity** — `Set A` and `Set B` arithmetic counts only
`confirmed` records.

## 3. Tiers

### Tier 1 — weekly Convex probe (ACTIVE)

- **Skill:** `convex-authz` deterministic scan over `convex/**`.
- **Cadence:** weekly, in CI on `main` and on each PR touching
  `convex/`.
- **Output:** findings to `.scripts/convex-probe/artifacts/`
  (gitignored on the scripts dir); the `convex-probe` workflow
  uploads them as the `convex-probe-findings` GitHub Actions
  artifact and posts a shape-tally sticky PR comment.
- **Gate (Phase B, week 5+ only — see §9):** zero new shape-(b)
  (public mutation no admin gate) or shape-(d) (`args.userId` not
  compared to `identity.subject`) hits before merge. Precedent:
  P1 #2 of round 27 / PR #904 was caught by this exact scan
  shape.
- **Cost:** sub-cent per run; <2 minutes wall clock; no third-party
  spend.
- **Scope adjustment policy:** the scan is grep-deterministic, so
  its output is reproducible. False positives from existing
  helpers (`requireDeleteAccess`, `requireAdminOrSelfVideoEditor`,
  `requireAssignedStudentForUpload`, `isAdminUser`,
  `assertServiceKey`) are catalogued in `judgments.md` (see
  `docs/security/pilot-baseline/judgments.md` for the current
  catalog) and excluded from the gate.

### Tier 2 — monthly cross-app sweep (ACTIVE)

- **Skill:** `convex-reviewer` (3-pass audit: Security /
  Performance / Code Quality) **plus** `convex-authz` LLM-judged
  pass for non-shape-(b)/(d) findings.
- **Cadence:** monthly, off the critical path. Output to
  `/tmp/opencode/audit/tier2/<yyyymm>/`. Pre-existing pilot output
  lives at `docs/security/pilot-baseline/` and serves as the
  baseline.
- **Output:** scan + LLM judgement diff vs the previous month's
  Tier 2 run.
- **Gate:** every Critical (P1) or Important (P2) finding becomes
  either a same-week fix PR with Greptile + CodeRabbit approval
  per AGENTS.md §"Pull Request Merge Policy", **or** a documented
  triage decision in the body of a Linear issue. Tier 2 findings
  do not write fixes directly; they raise issues that the existing
  PR pipeline resolves.
- **Cost:** bounded; compare against the most recent Greptile
  monthly invoice before scaling. If a Tier 2 run exceeds the
  Greptile-monthly cost on a single month, throttle the cadence
  first (skip the LLM-judged pass entirely for one cycle), then
  re-evaluate.

### Tier 3 — quarterly deep audit (DEFERRED)

- **Skill:** `security-audit` (third-party; install at
  `~/.config/opencode/skills/security-audit/`; sourced from
  `github.com/cloudflare/security-audit-skill`).
- **Cadence:** quarterly, **conditional on unlock** (see §5).
- **Cost envelope (when active):** 50-60 agent invocations per run,
  plus 1-2 verifier invocations per surviving candidate (~25
  candidate-bearing ledger units in the `standard` profile).
- **Output (when active):** `/tmp/opencode/audit/tier3/<yyyymm>/`
  containing `findings.json`, `REPORT.md`, `FINDINGS-DETAIL.md`,
  `NEEDS-VALIDATION.md`, `coverage-ledger.json`, `architecture.md`,
  `run-metadata.json`.
- **Validators:** `validate-findings.cjs` **and**
  `validate-coverage-ledger.cjs` (siblings to `SKILL.md` in the
  skill install dir) **both** must pass before declaring complete.
  Failed validation ⇒ `run_status: "incomplete"` with explicit
  `incomplete_reason` per the skill's discipline.
- **Independent-agent-layer caveat:** confirm the harness exposes
  a `Task` / subagent mechanism before scheduling
  Section "Harness disclosure" below.

## 4. Re-pilot parameters for Tier 3 unlock

A re-pilot unlocks Tier 3 **if and only if** all four conditions
hold:

1. **Set A ≥ ~5 unique-to-third-party confirmed** findings (the
   pilot's quick baseline at `docs/security/pilot-baseline/third-party/`
   had Set A = 1).
2. The harness exposes an independent-agent layer (subagent / Task
   tool) so the skill's Phase 2 hunting and Phase 3+5 verification
   are fresh-agent rather than parent-direct. The pilot's harness
   did not have this; the resulting Set C and Set A records carry
   `needs_validation`-equivalent uncertainty until re-validated.
3. Both `validate-findings.cjs` and `validate-coverage-ledger.cjs`
   pass on the re-run output.
4. Run is `run_status: "complete"` per the skill's contract.

Re-pilot parameters when conditions permit:

- **Scope:** `convex/**/*.ts` (excluding `convex/_generated/**`,
  `*.test.ts`, `*.d.ts`) + `convex/http.ts`.
- **Profile:** `standard`.
- **Budget:** 50-60 agent invocations; reserve 1 post-wave critic
  plus 1 final-clean critic plus 1 verifier per surviving
  candidate.
- **Output:** `/tmp/opencode/audit/tier3/re-pilot-<yyyymm>/` so
  the diff against the quick baseline in
  `docs/security/pilot-baseline/third-party/` is direct.
- **Selected companion playbooks:** `WEB-PROTOCOL-AND-AUTH.md`,
  `DATA-ISOLATION-AND-LIFECYCLE.md`, `CLOUD-AND-DEPLOYMENT.md`,
  `SUPPLY-CHAIN-AND-RELEASE.md`. Excluded (with reasons recorded
  in `run-metadata.json.excluded_companions`):
  `RESOURCE-EXHAUSTION-AND-AVAILABILITY.md` (no async / WebSocket
  DoS in this Convex Func-as-a-Service), `CLIENT-SIDE.md`,
  `MEMORY-SAFETY-AND-BINARY.md` (TypeScript / Convex runtime,
  no native parsing), `AI-AND-LLM.md`, `DESKTOP-MOBILE-AND-LOCAL-IPC.md`,
  `PROTOCOLS-RPC-AND-MESSAGING.md` (no custom protocol; Convex
  HTTP only).
- **Decision rule for unlock rejection:** if any re-pilot run fails
  the unlock conditions twice consecutively, drop Tier 3 entirely
  (fold the third-party skill into an ad-hoc supplementary tool
  used on a per-need basis, not a recurring cadence). The
  recurring cadence is the per-quarter cost commitment; conditional
  unlock on evidence is what keeps that cost bounded.

## 5. Harness disclosure (any third-party / multi-agent tier)

The pilot on `9fbf1794` ran with the available OpenCode harness,
which did not expose a `Task` / subagent mechanism. As a result,
Phase 2 hunting and Phase 3+5 verification ran parent-direct, and
the skill's "fresh independent reviewer" guarantee was not honoured
at the strict level `standard` / `deep` profiles require. Per the
skill's own `NEEDS-VALIDATION.md` discipline:

> any operator-side weak signal in the source should be confirmed
> end-to-end before remediation lands.

Operationally this means: any record carrying a `confirmed` verdict
in a run that did **not** have a fresh-agent reviewer is treated as
carrying `needs_validation`-equivalent uncertainty. Tier 3 in this
protocol is the gate that converts that uncertainty: re-run with
the independent-agent layer unblocked, then re-prove each candidate
in a fresh context.

If the OpenCode harness in the operator's environment cannot spawn
subagents at the moment of a re-pilot, **defer the re-pilot** rather
than burning budget on a result that will fail the unlock
conditions on evidentiary grounds. Per AGENTS.md §"Fly Sprites",
the documented alternative is to drive the multi-agent run from a
sandboxed sprite, but that incurs real spend and **must surface a
cost-disclosure line** before triggering (see §8 below).

## 6. Validator requirement

Each tier's structured output runs validators before being declared
complete:

- **Tier 1:** the workflow's per-step run is deterministic; the
  shape-count diff vs the prior week's baseline is recorded in the
  PR comment (`tier1.diff.json` is implicit in the comment summary
  until operator formalises it). No external schema validator
  required.
- **Tier 2:** two paths. The `convex-reviewer` output is checked
  against the reviewer's own JSON shape; the LLM-judged pass's
  output is checked against `tier2-llm-schema.json`.
- **Tier 3:** `validate-findings.cjs` (the third-party skill's
  validator) against `report-schema.json`, and
  `validate-coverage-ledger.cjs` against the unit schema. Run is
  incomplete if either fails; the `incomplete_reason` field names
  the failing validator.

Failed validation produces a **red surface** for the cadence: the
agent stops, the operator is notified, no findings propagate to
Linear or anywhere downstream.

## 7. Output locations and retention

| Tier | Default path | Retention |
|---|---|---|
| Tier 1 | `artifacts/findings-raw.{json,txt}` and `artifacts/findings-noauth.txt` under `.scripts/convex-probe/` (uploaded to `convex-probe-findings` workflow artifact, ephemeral) | weekly rotation in the artifact bucket (GitHub-controlled) |
| Tier 2 | `/tmp/opencode/audit/tier2/<yyyymm>/` (operator-local) | keep last 6 |
| Tier 3 | `/tmp/opencode/audit/tier3/<yyyymm>/` (when active; operator-local) | keep all |
| Pilot baseline | `docs/security/pilot-baseline/` | perpetual; the rescue arc on 2026-10-24 committed a snapshot from `/tmp/opencode/sec-pilot/` |

`/tmp/opencode/` is the harness-approved external area. Outputs are
**never** written under the target repo's tracked paths as part of
the ongoing cadence — the pilot baseline at
`docs/security/pilot-baseline/` is the **one-time** exception
authorised by Muse's post-pilot critique that pilot artifacts must
end up durable, not floating in `/tmp/`.

The relevant AGENTS.md sections (`Workspace Safety Policy` and the
pilot summary §"What I did not do") are honoured by construction:

- the working tree is read-only target — only new files may be
  added, and only outside `apps/`, `packages/`, `convex/`,
  `trigger/`, `inngest/`, `supabase/`, and the Trigger.dev-config
  areas;
- ongoing audit artifacts are never committed;
- the pilot's per-PIN invariants — Clerk never touched, no secrets
  committed, lint/typecheck/build determinism preserved, Greptile
  + CodeRabbit remain canonical per-PR gates — are inherited.

## 8. Cost discipline

Per AGENTS.md §"Fly Sprites", all third-party-tool usage incurs
real spend. The same posture generalises: any invocation that
crosses a skill boundary (third-party, multi-agent, fictionally
replayed) costs tokens and incurs the harness-disclosed residual
uncertainty.

Per-tier budget caps:

- **Tier 1:** no agent invocation; sub-cent per run (CI-compute
  for `tsx`).
- **Tier 2:** compare against the most recent Greptile monthly
  invoice; if a single Tier 2 run would exceed that monthly
  figure, throttle (skip the LLM-judged pass for one cycle) and
  re-evaluate.
- **Tier 3 (DEFERRED):** 50-60 agent invocations per quarter.
  Pre-trigger disclosure: any re-pilot run invocation, instructed
  by an agent, surfaces the cost estimate ("quick / standard /
  deep tier approximate compute time and per-run token estimate")
  in the chat or PR description before any work begins.

A re-pilot at `standard` profile is the only event where the
third-party skill's spend is justified by evidence, and only if the
quick baseline at `docs/security/pilot-baseline/third-party/` was
below the unlock threshold.

## 9. CI integration (Tier 1)

Tier 1's weekly + per-PR run lives in CI. Workflow at
`.github/workflows/convex-probe.yml` calls the deterministic
scanners under `.scripts/convex-probe/` (TypeScript, run via
`tsx`):

1. Check out the ref under test (`actions/checkout@v4`: the PR
   merge commit on `pull_request`, the default branch on
   `schedule`).
2. Run `npx tsx .scripts/convex-probe/scan-b.ts ../../convex`
   (the 4-shape taxonomy: `a` no-auth + `v.id` arg, `b`
   load-then-write without identity comparison, `c` public
   query with PII field, `d` parent FK write without parent
   ownership verify).
3. Run `npx tsx .scripts/convex-probe/scan-d.ts ../../convex`
   (no-auth writable public mutations / actions).
4. Findings land in `.scripts/convex-probe/artifacts/` (gitignored
   on the scripts dir); the workflow uploads them as the
   `convex-probe-findings` GitHub Actions artifact.
5. On PR events: a sticky `convex-probe` comment summarises the
   shape-by-shape counts.

Schedule: cron `0 12 * * 1` (Mon 12:00 UTC = Mon 06:00–07:00 US
Central depending on DST). The intent is a stable
Monday-morning-usable read in Central time year-round; the
DST-shift is small enough that the cron never lands on Sunday or
Tuesday.

**Phase A (weeks 1–4) is advisory-only.** The run uploads
findings and posts the PR comment, but never blocks a merge.
This is a deliberate calibration window: add-only findings
inflate the false-positive rate, and we cannot tune the gate
until the FP rate is measured against the same surface the
gate will eventually block on. Treating the gate as advisory
during calibration costs nothing and prevents a noisy blocker
from burning reviewer attention.

**Phase B (week 5+) may flip to blocking per the per-tier
owner's measured-FP-rate decision.** The default Phase B gate
is zero new shape-(b) (public mutation no admin gate) or
shape-(d) (`args.userId` not compared to `identity.subject`)
hits before merge, matching the precedent of P1 #2 of round 27
/ PR #904.

On-PR triggers fire on every push that touches `convex/**`,
`.scripts/convex-probe/**`, or the workflow file itself
(self-validating); manually triggerable via `workflow_dispatch`.
Scanner dependencies are installed with `npm ci` against the
committed `.scripts/convex-probe/package-lock.json`, so a given
workflow revision always runs the same `tsx`/`esbuild` versions.
There is no per-week diff against a stored
baseline yet — Phase A produces findings and a tally; the diff
landscape is the per-tier owner's call to introduce when
establishing the Phase B gate.

This is the only tier whose output feeds into a PR-merge gate;
the PR-merge itself remains Greptile + CodeRabbit as canonical
per AGENTS.md.

## 10. What this protocol does NOT do

- It is **not** a substitute for Greptile + CodeRabbit per-PR
  review (AGENTS.md §"Pull Request Merge Policy").
- It is **not** a substitute for the Linear post-merge verification
  convention (AGENTS.md §"Post-merge verification convention").
  Each Tier 3 unlock creates a Linear verification issue with the
  `schema-change` / category-specific label.
- It does **not** modify Clerk configuration or code (AGENTS.md
  §"Clerk Changes Policy (Do Not Touch)").
- It does **not** modify Trigger.dev / Inngest / Supabase /
  Cloudflare infrastructure.
- It does **not** execute target code against any deployed
  environment — source-only.
- It does **not** commit ongoing tier outputs to the repo tracked
  paths and does **not** open automated PRs against
  `mentorships-infra`. The pilot-baseline at
  `docs/security/pilot-baseline/` is the **one-time** exception
  authorised on 2026-10-24: the rescue arc committed the pilot's
  snapshot so the artifacts are durable; subsequent tier outputs
  continue to follow §7's running convention.

## 11. Decision log

| Date (UTC) | Decision | Trigger |
|---|---|---|
| 2026-10-24 | Pilot at `quick` profile: Set A = 1 (`convex.cleanup.wipePaymentData.admin_op_no_audit_log`), Set C = 4 (first-party overlap on `createUser:228`, `migrateUser:630`, `migrateInvitation:458`, `seedInstructorsWithProducts:417`), Set B ≈ 75 (reviewer-only). | Phase A.2 third-party run completion, run-metadata.json `run_status: complete`, both validators pass. |
| 2026-10-24 | Tier 3 DEFERRED pending re-pilot at `standard` profile and unblocked independent-agent-layer harness. | `Set A ≥ ~5` criterion unmet; harness constraint per §5. |
| 2026-10-24 | Tiers 1 and 2 stand on first-party baseline (`convex-authz` shape scan + `convex-reviewer` 3-pass). | Pilot evidence shows first-party coverage is already strong on `convex/`; cost-discipline principle. |
| 2026-10-24 | F5 (`cleanup.wipePaymentData` audit-log asymmetry) is decoupled from Tier 3 — operator may remediate via a standalone PR with Greptile + CodeRabbit approval; not blocked by Tier 3 deferral. | Third-party `FINDINGS-DETAIL.md` fix snippet is complete; admin-only gate, so on-compromise risk is moderate, not critical. |
| 2026-10-24 | Tier 1 cron: `0 12 * * 1` UTC = Mon morning US Central (06:00–07:00 by DST) — chosen for stable Monday-morning Central readability year-round. | Operator preference ("Mon morning Central is good"); see §9. |
| 2026-10-24 | Tier 1 Phase A (weeks 1–4) is advisory-only; Phase B (week 5+) is conditional-blocking per measured FP rate. | Calibration: add-only findings inflate FPs before they can be measured; gate only after the rate is known. |
| 2026-10-24 | Per-tier ownership default: the operator who most recently ran Tier 2 owns all tiers; reassignment is recorded by amending this row with the new owner's handle and the date of transfer (see doc-header line for current holder). | Cost and accountability are colocated when one operator is most recently trained on the surface area. |
| 2026-10-24 | Pilot artifacts (43 files, 664K) rescued out of `/tmp/opencode/sec-pilot/` into `docs/security/pilot-baseline/` via PR 1 of the post-pilot arc (#954). F5 (`convex/cleanup.ts` all-or-nothing transactional audit using `writeAuditLog` → `auditLogs`) lands via PR 2. Tier 1 wiring (`convex-probe.yml` + `.scripts/convex-probe/{scan-b,scan-d}.ts` plus `package.json`, `tsconfig.json`, `README.md` + this protocol doc) lands via PR 3. All three PRs gated on Greptile + CodeRabbit per AGENTS.md. | Muse's post-pilot critique: pilot artifacts must end up durable, not float in `/tmp/`. |

Future amendments append to this table. Each amendment is a
follow-up docs edit under `docs/security/` followed by a focused
PR gated on Greptile + CodeRabbit per AGENTS.md.

## 12. Cross-references

- Pilot summary: `docs/security/pilot-baseline/pilot-summary.md`.
- Pilot third-party artifacts: `docs/security/pilot-baseline/third-party/`
  (7 files: `findings.json`, `REPORT.md`, `FINDINGS-DETAIL.md`,
  `coverage-ledger.json`, `architecture.md`, `run-metadata.json`,
  `NEEDS-VALIDATION.md`).
- Pilot first-party artifacts: `docs/security/pilot-baseline/`
  (`findings-reviewer.json`, `findings-authz.json`,
  `findings-firstparty.json`, `final-report.md`, `judgments.md`,
  historical scan scripts `scan.ts` and `scan-noauth.ts`).
- Canonical CI scanners (re-uses detection logic from the
  pilot-baseline scripts, with portable CLI argument for
  `CONVEX_DIR` so they're usable from CI and other checkouts):
  `.scripts/convex-probe/scan-b.ts`,
  `.scripts/convex-probe/scan-d.ts`.
- Tier 1 workflow: `.github/workflows/convex-probe.yml`.
- Prior-tier-output convention (still applies to ongoing runs):
  `/tmp/opencode/audit/tier1/weekly-<isoweek>/` (Tier 1's actual
  workflow-artifact output is now `/tmp/opencode/audit/tier1`-shaped
  via the workflow's GitHub Actions artifact bucket rather than a
  filesystem path; the local-machine invocation still uses
  `./artifacts/` in `.scripts/convex-probe/`),
  `/tmp/opencode/audit/tier2/<yyyymm>/`,
  `/tmp/opencode/audit/tier3/<yyyymm>/` (when active).
- `convex-authz` skill: `~/.config/opencode/skills/convex-authz/`
  (installed user-level, per the pilot install convention).
- `convex-reviewer` skill: ships with opencode.
- `security-audit` skill (third-party, DEFERRED-tier reference):
  `~/.config/opencode/skills/security-audit/`. Source repo:
  `github.com/cloudflare/security-audit-skill`. Skill flow is
  documented inline in `SKILL.md` and its companion files
  (`RECONNAISSANCE.md`, `HUNTING.md`, `VALIDATION-AND-REPORTING.md`,
  `ATTACK-CLASSES.md`, the four selected companion playbooks).
- Mother policy: `<repo>/AGENTS.md`. Sections referenced above:
  "Pull Request Merge Policy", "Naming Conventions: NEVER use
  mentor/mentee", "Clerk Changes Policy (Do Not Touch)", "Secret
  Protection Policy", "Workspace Safety Policy", "Linear (Project
  Management)" and the post-merge verification convention, "Fly
  Sprites" (cost-discipline reference).
