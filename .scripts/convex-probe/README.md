# convex-probe

Tier 1 deterministic shape-scanner for the 4-shape taxonomy defined in
[`docs/security/sweep-protocol.md`](../../docs/security/sweep-protocol.md) §3 (Tier 1).

This directory is run weekly by the [`convex-probe` GitHub Actions workflow](../../.github/workflows/convex-probe.yml) and is also invokable locally.

## Scripts

| Script | Shape coverage | Output |
| --- | --- | --- |
| `scan-b.ts` | All 4 shapes: `a` (no-auth + identity-named `v.id` arg), `b` (load-then-write without identity comparison), `c` (PII-leaking public query), `d` (parent FK write without parent ownership verify) | `artifacts/findings-raw.json`, `artifacts/findings-raw.txt` |
| `scan-d.ts` | No-auth writable public mutations / actions only | `artifacts/findings-noauth.txt` |

The detection logic was derived from the security-audit pilot at `commit 9fbf1794` (`docs/security/pilot-baseline/scan.ts` and `docs/security/pilot-baseline/scan-noauth.ts`); they are unchanged apart from removing the hard-coded pilot `ROOT` and `/tmp/opencode/sec-pilot/` output paths.

## Arguments

Both scripts take a single positional CLI argument: the convex source directory to scan.

```
tsx scan-b.ts <convex-dir>
tsx scan-d.ts <convex-dir>
```

The default is `./convex`. The CI workflow passes `../../convex` (relative to `.scripts/convex-probe/`).

## Local usage

From the repo root (the `.scripts/convex-probe/` directory must have its dependencies installed):

```
cd .scripts/convex-probe
npm install
npm run scan
```

Findings land in `.scripts/convex-probe/artifacts/`. The artifacts are intentionally NOT committed to git — CI captures them as GitHub Actions artifacts.

## CI behavior

`convex-probe.yml` runs both scripts in Phase A on a weekly cadence (`cron: 0 12 * * 1` UTC = Mon morning US Central) and on every PR that touches `convex/**`. Findings are:

1. uploaded as the `convex-probe-findings` GitHub Actions artifact;
2. posted as a `convex-probe` header sticky PR comment summarising total hits and a shape-by-shape breakdown.

The check is **advisory-only in Phase A** (weeks 1–4): it never blocks a merge. After Phase A, the per-tier owner reviews the FP rate and decides whether to flip to blocking.
