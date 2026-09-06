# Plans

- [Mentorship Workspaces v1](./mentorship-workspaces-v1.md)
- [Video Calling (Daily.co + Backblaze B2)](./video-calling.md) — apps/platform video calling integration. Status (2026-07-09): PRs #1 → #4c-4 + hotfix PR #607 (identity.subject, shipped before PR #5) + PR #5 + PR #610 (R1 nits) + PR #7 WIDEN + PR #7 MIGRATE + PR #613 / GitHub #614 (drift cron monitor) + GitHub #615 / #616 (docs reconciliation) + GitHub #617 (chat-tab silent failure + Convex auth race) shipped; PR #7 NARROW deferred until Convex ships schema-time uniqueness for indexed optional strings.
- [Convex Data Egress Optimization](./convex-data-egress-optimization.md) — reduce Convex Data Egress in apps/platform by paginating workspace subscriptions and tuning React Query.
- [Cloudflare Integrations for Platform & Huckleberry Drive](./cloudflare-integrations-platform-huckleberry-drive.md) — candidate Cloudflare integrations (R2, Turnstile, Workers, KV, DNS/CDN) for apps/platform and apps/huckleberry-drive.
- [Email Deliverability — Resend Split-Domains → Suppressions → Metrics → Verify](./email-deliverability-resend.md) — sender-reputation isolation, Svix-verified suppression webhook, and Email Metrics API ingestion. Status (2026-09-06): Phase 0 shipped (PR #822 squash-merged as `238db198`); Phase 1 (Suppressions 2a/2b/2c), Phase 2 (Metrics 3a/3b/3c optional), Phase 3 (Verify 4a/4b) queued.
