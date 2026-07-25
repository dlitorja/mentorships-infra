# Secret Removal — Complete

**Status**: Sequence finished 2026-07-24. PRs #669 → #676 all merged to main.

## What was removed

`CONVEX_SERVER_SHARED_SECRET` — a shared-secret env var used by 8 public Convex `action()` wrappers that authenticated server-to-server calls by checking `args.secret === process.env.CONVEX_SERVER_SHARED_SECRET`. The pattern was bypassable from the browser (Greptile P1 flagged it on the admin-onboarding flow), and HMAC variants on `convex/users_actions.ts` (using the same env var) were equally vulnerable to leaked signing secrets.

## Final shape

**All 8 callers now use bearer-auth HTTP endpoints** authenticated against `CONVEX_HTTP_KEY` via `verifyAuth` in `convex/http.ts:30`. Each endpoint routes to an `internalMutation` / `internalAction` / `internalQuery` that the HTTP layer protects. There is no shared secret; the bearer token is a long-lived per-deployment key that rotates via Convex's own key-management surface.

41 `httpAction` endpoints registered in `convex/http.ts`. Audit rows written atomically from internal mutations in the same transaction as the data write.

## The 8 PRs

| # | SHA | Phase | Subject | Files |
|---|-----|-------|---------|-------|
| #669 | `85540cf4` | widen | low-risk callers off `CONVEX_SERVER_SHARED_SECRET` | `apps/platform/inngest/**`, `apps/platform/app/api/**`, `convex/http.ts` (new endpoints) |
| #670 | `93593e1a` | widen | admin-onboarding off `CONVEX_SERVER_SHARED_SECRET` | `convex/http.ts` (8 new admin-onboarding endpoints), all admin-onboarding call sites |
| #671 | `90c716db` | narrow | remove legacy shared-secret admin-onboarding actions | `convex/adminOnboarding.ts` (-274 lines), `ADMIN_ONBOARDING_AUTOMATION_PLAN.md` (14+ lines swept) |
| #672 | `09bdd4ba` | narrow | remove legacy shared-secret instructor actions | `convex/instructors.ts` (-49 lines) |
| #673 | `baca9ae7` | narrow | remove legacy shared-secret seatReservations action | `convex/seatReservations.ts` (-28 lines) |
| #674 | `093c40c3` | narrow | remove legacy shared-secret sessionPacks action | `convex/sessionPacks.ts` (-36 lines; also deleted dead `verifyServerAuth` helper) |
| #675 | `f5721ea5` | narrow | delete legacy HMAC `users_actions` file | `convex/users_actions.ts` (entire 90-line file), `convex/users.ts` (stale JSDoc cleaned), `convex/_generated/api.d.ts` (codegen refresh) |
| #676 | `edb59996` | hygiene | drop literal env-var name from code comments | `convex/http.ts`, `apps/platform/inngest/functions/clerk-user-linking.ts`, `apps/platform/lib/convex-server-call.ts`, `SECRET_REMOVAL_REMAINING_PRS.md` (status update) |

## Net effect

- **-511 lines** of legacy shared-secret auth code, wrappers, helpers, and one full file deleted.
- **+41** bearer-auth HTTP endpoints added in `convex/http.ts`.
- Zero `CONVEX_SERVER_SHARED_SECRET` or `SERVER_SHARED_SECRET` references remain in code (`apps/`, `packages/`, `convex/`).
- Two intentional historical-context docs retain the env-var name as a label: `ADMIN_ONBOARDING_AUTOMATION_PLAN.md:675` (explains why the migration happened) and `SECRET_REMOVAL_REMAINING_PRS.md` (work-log). Both are commit messages / documentation; neither contains real values.

## Verification evidence (final state of main)

```
code grep:        grep -rn 'CONVEX_SERVER_SHARED_SECRET\|SERVER_SHARED_SECRET' apps/ packages/ convex/ --include='*.ts' --include='*.tsx'
                  → 0 hits
convex tests:     pnpm exec vitest --config convex/vitest.config.mjs run
                  → 3 test files, 35/35 tests pass (adminOnboarding, auditLog, http; http.test.ts exercises every bearer-auth endpoint)
unit tests:       pnpm exec vitest --config vitest.config.mjs run
                  → 30 test files, 239/239 tests pass, 3 skipped (pre-existing)
typecheck:        pnpm typecheck  → 0 errors
lint:             pnpm lint  → 0 errors, 135 warnings (unchanged baseline)
build:            NEXT_PUBLIC_APP_URL=https://example.com pnpm build  → clean
ci (PR #676):     14/14 GitHub Actions checks + Greptile cloud auto-review + 4 Vercel preview deploys all pass
convex env:       npx convex env list --prod --names-only
                  → CLERK_JWT_ISSUER_DOMAIN, CLERK_JWT_ISSUER_DOMAINS
                  (CONVEX_SERVER_SHARED_SECRET was never set in the Convex dashboard, dev or prod)
```

## Operational template (for reference)

Each PR followed the same shape — branch off main, run the verification gates above locally, push, `gh pr create`, wait for CI, address any Greptile findings, `gh pr merge --squash --delete-branch`. Local Greptile CLI review was skipped (relying on GitHub App auto-review); the cloud review caught one non-blocking doc bug in PR #671 (fixed in follow-up commit `c4dc2dbc`) which is a useful precedent.

## Repo policies respected throughout

From repo-root `AGENTS.md` and `apps/platform/AGENTS.md`:

- **Naming**: code uses `instructor` / `student`; no `mentor` / `mentee` appears in the diffs. (The plan doc and handoff doc contain the word "mentorships" in UI/copy context, which is allowed.)
- **Secret Protection**: no actual `CONVEX_SERVER_SHARED_SECRET` values were ever pasted into PR bodies, commit messages, or doc comments. The env-var name is referenced as a label only.
- **Clerk do-not-touch**: no Clerk config, `ClerkProvider` props, or `CLERK_*` / `NEXT_PUBLIC_CLERK_*` env vars were modified. The new HTTP endpoints accept `CONVEX_HTTP_KEY` bearer auth only — Clerk session is irrelevant for server-to-server callers.

## Related follow-up (not part of this sequence)

- `SECRET_REMOVAL_REMAINING_PRS.md` is the original work-log for this sequence; retained for historical context.
- No open PRs, no open issues tied to `CONVEX_SERVER_SHARED_SECRET`.
- The `npx convex env list` audit confirms no stale env-var entries in the Convex dashboard; no Vercel env cleanup needed (CLI not installed locally, but `CONVEX_SERVER_SHARED_SECRET` was never set in Convex, and no code reads it).

## For a new contributor picking up this work area

If you need to add a new server-to-server Convex call path:

1. **Don't** create a public `action()` with a `secret` arg. Use the bearer-auth HTTP transport.
2. Add an `httpAction` in `convex/http.ts` that calls `verifyAuth` from `convex/http.ts:30` first, then `runMutation` / `runAction` / `runQuery` against an internal export.
3. If the write needs an audit row, write it atomically from the internal mutation in the same transaction (see `convex/adminOnboarding.ts` for the pattern).
4. From the caller side, use `apps/platform/lib/convex-server-call.ts` (already set up for bearer auth; reads `CONVEX_URL` or `NEXT_PUBLIC_CONVEX_URL` and rewrites `.convex.cloud` → `.convex.site`).

The shared-secret auth pattern is gone; the bearer-auth HTTP transport is the only supported path.
