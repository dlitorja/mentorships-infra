# OpenCode Zen cost policy

How the coding-agent bill is kept down, what the switch to DeepSeek 4.1 Flash
actually saved, and where to look when the number moves. Companion to
[`greptile-cost-policy.md`](./greptile-cost-policy.md), which covers the review
bot — together they are most of the AI spend.

## Why this exists

Through October 2026 the agent ran on `minimax-m2.7`. On 2026-10-25 we moved to
`deepseek-v4.1-flash` (first on the free tier, fully paid from 2026-10-29;
`minimax-m2.7` was last used 2026-10-27). The reason was price, not capability:
the two models have **identical** input and output rates, and differ only in
what they charge to re-read cached context.

That difference matters because of the shape of an agentic session. Across the
90 days measured here, **97–98% of all tokens were cache reads** — the model
re-reading the same repository context on every turn. Cached input is therefore
the bill, and a 10× cut on that one line moves almost everything.

## Billed rates

Recovered by least-squares from 141 daily usage rows, fitting
`cost = in·a + out·b + cache_read·c + cache_write_5m·d + cache_write_1h·e`.
The fit is exact (max residual $0.000000), so these are the rates actually
charged, not list prices inferred from a blog post.

| Model | $/1M input | $/1M output | $/1M cache read | $/1M cache write (5m) |
|---|---|---|---|---|
| `minimax-m2.7` (until 2026-10-27) | 0.30 | 1.20 | **0.060** | 0.375 |
| `kimi-k2.7-code` (occasional) | 0.95 | 4.00 | 0.190 | — |
| **`deepseek-v4.1-flash`** (now) | 0.30 | 1.20 | **0.006** | — |

`gpt-5.6-sol` was used in two sessions (2026-08-31, 2026-09-02) for $83.86
across 437 requests — 15% of the 90-day bill for 0.3% of the requests. There
are not enough rows to fit its rates, and it is not part of the switch; treat
it as a one-off, not a baseline.

## Measured result

90-day totals (2026-08-14 → 2026-11-11), $545.43:

| Model | Requests | Spend | Cache reads |
|---|---|---|---|
| `minimax-m2.7` | 42,434 | $346.26 | 4,860M |
| `kimi-k2.7-code` | 3,450 | $93.14 | 402M |
| `gpt-5.6-sol` | 437 | $83.86 | 70M |
| `deepseek-v4.1-flash` | 5,868 | **$22.15** | 1,771M |
| `deepseek-v4.1-flash-free` | 569 | $0.00 | 64M |

**Same-workload counterfactual** for the paid DeepSeek window (2026-10-29 →
2026-11-11, 13 active days, 5,536 requests, 1.72B cache-read tokens):

- actual: **$21.26**
- those identical tokens at minimax's cache-read rate: **$114.17**
- saving: **$92.91 over 13 days — 81% cheaper, ≈ $214 per 30 days**

Run-rate cross-check, which is weaker because the workload grew:

| Window | Spend/day | Requests/day | $/request |
|---|---|---|---|
| 2026-10-01 → 10-24 (minimax) | $5.00 | 604 | $0.0083 |
| 2026-11-01 → 11-11 (deepseek) | $1.99 | 504 | $0.0040 |

Monthly totals, for context: Aug $120.17, Sep $277.12, Oct $128.26,
Nov 1–11 $19.88. September is inflated by the $79.31 `gpt-5.6-sol` day.

## What this does and does not prove

- The counterfactual re-prices **the same tokens** on the old model. It does not
  claim the same work would have produced the same tokens. Cache reads per
  request rose from ~115k to ~311k, so the DeepSeek era is doing *more* context
  per turn than the minimax era did. The $92.91 figure deliberately excludes
  that, and the run-rate table is the honest per-day comparison.
- Model verbosity differs; a different model would have produced somewhat
  different output lengths. The input and output rates being identical limits
  how much that can matter.
- The free tier (569 requests, 2026-10-25) is promotional and excluded from the
  saving. It is not a durable cost assumption.

## How to reproduce

The source is the OpenCode Zen usage export (per day, per model, per user),
with columns `day, provider, model, requests, input_tokens, output_tokens,
cache_read_tokens, cache_write_5m_tokens, cache_write_1h_tokens, cost_usd`.
The export contains account identifiers and email addresses, so it is **not
committed** — pull a fresh one from the Zen dashboard when re-checking.

1. Fit the five rates per model with the rows for that model (normal equations
   are enough; the system is small and exact).
2. Counterfactual cost = actual cost + `cache_read_tokens × (old_rate −
   new_rate)`.
3. Sanity check: the fitted rates should reproduce every row to the cent.

## Operating notes

- **Stay on a model with cheap cache reads.** Input/output rate parity between
  vendors is common; the cache-read rate is where agentic bills diverge by an
  order of magnitude. Check that line before comparing headline prices.
- **Watch for one-off expensive-model days.** The $79.31 `gpt-5.6-sol` day
  tripled a month's bill on its own. Expensive models are fine for a specific
  hard problem; they should not become the default by accident.
- **Per-request cost is the metric to track**, not monthly total — total moves
  with how much work you do, and the volume here grew while spend fell.

## Relation to other policies

- [`greptile-cost-policy.md`](./greptile-cost-policy.md) — review-bot volume:
  $654 → ~$236/month measured, ~$415/month saved.
- Combined, AI spend went from roughly **$900–930/month to ~$300/month**
  (Zen ~$60 + Greptile ~$236), about $7.5k/year at list price. Greptile's
  Startup 50% discount expires after year one, which makes the review-volume
  work worth more next year than this year.
- Review policy itself is enforced by `Review Gate`
  (`.github/workflows/review-gate.yml`); see `AGENTS.md` "Pull Request Merge
  Policy".
