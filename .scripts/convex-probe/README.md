# convex-probe

Tier 1 deterministic shape-scanner for the 4-shape taxonomy defined in
[`docs/security/sweep-protocol.md`](../../docs/security/sweep-protocol.md) §3 (Tier 1).

This directory is run weekly by the [`convex-probe` GitHub Actions workflow](../../.github/workflows/convex-probe.yml) and is also invokable locally.

## Scripts

| Script | Purpose | Output |
| --- | --- | --- |
| `scan-b.ts` | All 4 shapes: `a` (no-auth + identity-named `v.id` arg), `b` (load-then-write without identity comparison), `c` (PII-leaking public query), `d` (parent FK write without parent ownership verify) | `artifacts/findings-raw.json`, `artifacts/findings-raw.txt` |
| `scan-d.ts` | No-auth writable public mutations / actions only | `artifacts/findings-noauth.txt`, `artifacts/findings-noauth.json` |
| `diff.ts` | Week-over-week diff against the committed baseline | `artifacts/tier1.diff.json` |
| `lib.ts` | Shared detection heuristics + suppression/baseline helpers (unit-tested) | — |
| `detector.test.ts` | Unit tests for the §4 detector gaps, suppressions, and diff | — |

Both scanners also write `artifacts/findings-suppressed-scan-{b,d}.json` — the findings
hidden by `suppressions.json`, including the recorded reason and owner.

The detection logic was derived from the security-audit pilot at `commit 9fbf1794` (`docs/security/pilot-baseline/scan.ts` and `docs/security/pilot-baseline/scan-noauth.ts`). The heuristics now live in `lib.ts` so they can be tested directly; see `detector.test.ts` for the §4 gap coverage.

## Arguments

Both scanners take a single positional CLI argument: the convex source directory to scan.

```
tsx scan-b.ts <convex-dir>
tsx scan-d.ts <convex-dir>
```

The default is `./convex`. The CI workflow passes `../../convex` (relative to `.scripts/convex-probe/`).

`diff.ts` takes flags:

| Flag | Behaviour |
| --- | --- |
| *(none)* | Print + write the diff artifact. Advisory; always exits 0. |
| `--fail-on-new` | Exit 1 when `scan-d` has findings absent from the baseline. **This is the Phase B switch.** |
| `--update` | Rewrite `tier1.diff.json` from the current scans (run after each remediation wave). |

## Suppressions

`suppressions.json` records accepted public surfaces so they do not need a permanent
allowlist entry elsewhere. Each entry is scoped to one scanner and one function:

```json
{
  "file": "contacts.ts",
  "function": "addContact",
  "scanner": "scan-d",
  "reason": "Public marketing form by design; abuse handled by rate limiting.",
  "owner": "@dlitorja",
  "expires": "2027-04-30"
}
```

Rules:

- `reason` and `owner` are required; invalid entries are skipped with a warning.
- `expires` is optional. An **expired** entry stops suppressing automatically, so the
  finding resurfaces for re-review (the workflow logs it as
  `suppression expired, hit resurfaced`).
- `shape` is optional and only meaningful for `scan-b` (a/b/c/d).
- Suppressions are applied **before** the baseline diff, so `tier1.diff.json` records
  the same surface that a Phase B gate would block on.

## Baseline diff

`tier1.diff.json` is the committed Phase A exit artifact: the post-hardening,
post-suppression finding set, keyed by `(file, function, shape)`. `diff.ts` compares each
run against it and reports `new` / `fixed` per scanner.

After a remediation wave merges, regenerate the baseline in the same PR that removes the
findings:

```
cd .scripts/convex-probe
npm run scan
npm run baseline    # tsx diff.ts --update
```

Phase B (not enabled) is one workflow flag: pass `--fail-on-new` to the diff step. Until
the per-tier owner signs off, the job stays advisory.

## Local usage

From the repo root (the `.scripts/convex-probe/` directory must have its dependencies installed):

```
cd .scripts/convex-probe
npm ci
npm test          # detector + suppression + diff unit tests
npm run typecheck
npm run scan
npm run diff
```

Findings land in `.scripts/convex-probe/artifacts/`. The artifacts are intentionally NOT committed to git — CI captures them as GitHub Actions artifacts.

## CI behavior

`convex-probe.yml` runs on a weekly cadence (`cron: 0 12 * * 1` UTC = Mon morning US Central) and on every PR that touches `convex/**` or `.scripts/convex-probe/**`. It:

1. runs the probe self-tests and typecheck;
2. runs both scanners (suppressions applied);
3. diffs against `tier1.diff.json` (advisory);
4. uploads the findings as the `convex-probe-findings` GitHub Actions artifact;
5. posts a `convex-probe` header sticky PR comment with shape counts and the baseline diff.

The check is **advisory-only in Phase A** (weeks 1–4): it never blocks a merge. After Phase A, the per-tier owner reviews the FP rate and decides whether to flip `--fail-on-new` on.
