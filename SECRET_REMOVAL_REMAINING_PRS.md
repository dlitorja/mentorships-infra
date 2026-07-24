# Secret Removal — Remaining PRs (D → H)

**Status**: ALL PRs (#669 → #676) merged. Secret removal complete as of 2026-07-24.

## Completed (in main as of 2026-07-24)

| PR | SHA | Phase | Subject |
|----|-----|-------|---------|
| #669 | `85540cf4` | widen | low-risk callers off `CONVEX_SERVER_SHARED_SECRET` |
| #670 | `93593e1a` | widen | admin-onboarding off `CONVEX_SERVER_SHARED_SECRET` |
| #671 | `90c716db` | narrow | remove legacy shared-secret admin-onboarding actions |
| #672 | `09bdd4ba` | narrow | remove legacy shared-secret instructor actions |
| #673 | `baca9ae7` | narrow | remove legacy shared-secret seatReservations action |
| #674 | `093c40c3` | narrow | remove legacy shared-secret sessionPacks action |
| #675 | `f5721ea5` | narrow | delete legacy HMAC `users_actions` file |
| #676 | (see PR) | hygiene | drop `CONVEX_SERVER_SHARED_SECRET` env-var name from code comments |

PR #669 (the "low-risk" migration) **already added the bearer-auth HTTP endpoints** for instructors / seatReservations / sessionPacks / users_actions AND kept the old `*Action` wrappers as `@deprecated` back-compat shells. It also **already migrated all callers** (Inngest workers + admin routes) to the HTTP transport.

That means PRs **E, F, G were pure NARROW deletions** — no caller migration needed. Every deprecated wrapper had zero remaining callers (verified by grep on 2026-07-24). PR H rephrased 4 historical-context code comments that still mentioned the env-var name (no functional change).

## Naming + secret + Clerk policies (do not violate)

From repo-root `AGENTS.md`:

- **Code uses `instructor` / `student`**, never `mentor` / `mentee`. The word `mentorships` is allowed only in UI copy.
- **Never expose secrets in PR bodies, commit messages, comments, or docs.** Use placeholders like `<COPY_FROM_APPS_PLATFORM>`. Never copy real `CONVEX_SERVER_SHARED_SECRET` / `CONVEX_HTTP_KEY` / `CLERK_*` / Vercel tokens into text output.
- **Do NOT touch Clerk code or `ClerkProvider` props / `NEXT_PUBLIC_CLERK_*` env vars without explicit user approval** (per apps/platform/AGENTS.md).
- Convex is the source of truth for instructor data; apps/platform must not duplicate it in Supabase.
- Migrations: use `supabase db query --linked -f <sql>` with committed SQL files under `packages/db/drizzle/`.
- Long-running ops: prefer Trigger.dev v4 SDK tasks (see AGENTS.md Trigger sections).

## Operational pattern (template for D–G)

Each remaining PR is a NARROW-phase deletion modeled on PR #671 (`90c716db`). The same 9 gates apply, plus Greptile cloud auto-review.

### Per-PR shape

1. Read the file(s) listed below + the corresponding `convex/http.ts` HTTP-endpoint block to confirm the new transport.
2. Delete the `@deprecated` `*Action` wrapper(s) + the file-level `const SERVER_SHARED_SECRET = ...` if present.
3. Drop any unused imports (`action` from `./_generated/server` etc.).
4. Update JSDoc above the surviving internal mutation/query to point at the HTTP endpoint instead of the deleted wrapper.
5. Sweep any doc references in `ADMIN_ONBOARDING_AUTOMATION_PLAN.md` (or other doc files) — replace `*Action` mentions with the HTTP endpoint path + add "superseded in PR #xxx" historical note.
6. Branch off `main` as `chore/secret-removal-<feature>-narrow`.
7. Run the 9 verification gates (see below).
8. Push + open PR via `gh pr create`. Monitor CI; respond to Greptile / CodeRabbit inline comments before merge.
9. After merge, confirm branch deletion.

### Verification gates (all 9 must pass before push)

```bash
# Gate 1: zero remaining references in the PR's scope
grep -rn 'CONVEX_SERVER_SHARED_SECRET' apps/platform convex/ docs/ --include='*.ts' --include='*.tsx' --include='*.md' \
  | grep -v '<out-of-scope-feature-paths>'

# Gate 2: zero remaining callers
grep -rn 'api\.<feature>\..*Action\b' apps/platform convex/ --include='*.ts' --include='*.tsx'

# Gate 3: zero remaining SERVER_SHARED_SECRET in the file
grep -n 'SERVER_SHARED_SECRET' convex/<feature>.ts

# Gate 4: zero remaining *Action exports in the file
grep -nE '^export const.*Action\b' convex/<feature>.ts

# Gate 5: convex tests
pnpm test:convex --run   # expect 35/35 (unchanged baseline)

# Gate 6: unit tests
pnpm test:unit --run     # expect 239 pass + 3 skipped

# Gate 7: typecheck
NODE_OPTIONS='--max-old-space-size=8192' pnpm typecheck

# Gate 8: lint
pnpm lint   # expect 0 errors (135 pre-existing warnings)

# Gate 9: build (apps/web + apps/platform both compile)
cd apps/platform && NEXT_PUBLIC_APP_URL=https://example.com pnpm build
cd apps/web && NEXT_PUBLIC_APP_URL=https://example.com pnpm build
```

`NEXT_PUBLIC_APP_URL` is required for production builds; CI provides it via `vars.NEXT_PUBLIC_APP_URL`. For local sanity builds, set it explicitly.

Then push and wait for Greptile cloud review (~3 min after push). If Greptile flags an issue, fix and re-trigger.

## PR D — `convex/instructors.ts` (Stripe payout / instructor lifecycle)

**Wrap up**: delete the `@deprecated` `*Action` wrappers introduced by PR #669. Internal-action backing logic stays.

| Symbol | File:line | What to do |
|--------|-----------|------------|
| `createInstructorForClerkUser` | `convex/instructors.ts:2693` | Delete (deprecated back-compat shell) |
| `deactivateInstructorByUserId` | `convex/instructors.ts:2767` | Delete (deprecated back-compat shell) |
| `createInstructorForClerkUserInternal` | `convex/instructors.ts:2622` | Keep — called via HTTP `/instructors/create-for-clerk-user` |
| `deactivateInstructorByUserIdInternal` | `convex/instructors.ts:2727` | Keep — called via HTTP `/instructors/deactivate-by-user-id` |
| JSDoc above `createInstructorForClerkUserInternal` (~line 2614–2620) | — | Rewrite to point at `/instructors/create-for-clerk-user` HTTP endpoint |
| JSDoc above `deactivateInstructorByUserIdInternal` (~line 2720–2725) | — | Rewrite to point at `/instructors/deactivate-by-user-id` HTTP endpoint |
| `import { ... action ... }` from `./_generated/server` (line 1) | — | **Keep `action`** — `convex/instructors.ts:135 backfillImages` still uses it. Only the deprecated wrappers' bodies use `action`; they get deleted. `internalAction` stays for `createInstructorForClerkUserInternal` / `deactivateInstructorByUserIdInternal`. |
| Comments mentioning `secret` | — | Update to reflect HTTP transport (parallel to PR #671's audit-comment fix in `convex/adminOnboarding.ts:1082-1087`) |

**Callers** (already migrated by PR #669):
- `apps/platform/inngest/functions/clerk-user-instructor-lifecycle.ts:88, 198, 249` — calls HTTP endpoints, not the `*Action` wrappers. Comment messages reference the function name (`createInstructorForClerkUser`) but that's the old name; harmless — leave them alone unless they cause lint errors.

**HTTP endpoints (replacement)**:
- `POST /instructors/create-for-clerk-user` — `convex/http.ts:httpCreateInstructorForClerkUser` (~line 870).
- `POST /instructors/deactivate-by-user-id` — `convex/http.ts:httpDeactivateInstructorByUserId` (~line 920).

**Doc sweep**: search for `createInstructorForClerkUser\b` and `deactivateInstructorByUserId\b` in `ADMIN_ONBOARDING_AUTOMATION_PLAN.md` and any other plans/docs; replace with the HTTP-endpoint path.

## PR E — `convex/seatReservations.ts` (link seat reservations by email)

| Symbol | File:line | What to do |
|--------|-----------|------------|
| `linkSeatReservationsByEmailAction` | `convex/seatReservations.ts:691` | Delete |
| `const SERVER_SHARED_SECRET = process.env.CONVEX_SERVER_SHARED_SECRET` | `convex/seatReservations.ts:7` | Delete (file-level const) |
| `import { ... action ... }` from `./_generated/server` (line 1) | — | Drop `action` (no other usage) |
| `linkSeatReservationsByEmail` (internalMutation) | `convex/seatReservations.ts:669` | Keep — called via HTTP `/internal/link-seat-reservations` |
| JSDoc above the internal mutation | — | Rewrite to point at HTTP endpoint |

**Callers**: zero in apps/platform. The only `ctx.runMutation(internal.seatReservations.linkSeatReservationsByEmail, ...)` calls are inside the wrapper itself (`seatReservations.ts:709`) and inside the HTTP endpoint (`convex/http.ts:834`).

**HTTP endpoint (replacement)**: `POST /internal/link-seat-reservations` (`convex/http.ts:httpLinkSeatReservationsByEmail` at line 806).

## PR F — `convex/sessionPacks.ts` (link session packs by email)

| Symbol | File:line | What to do |
|--------|-----------|------------|
| `linkSessionPacksByEmailAction` | `convex/sessionPacks.ts:707` | Delete |
| `const SERVER_SHARED_SECRET = process.env.CONVEX_SERVER_SHARED_SECRET` | `convex/sessionPacks.ts:698` | Delete (file-level const) |
| `import { ... action ... }` from `./_generated/server` (line 1) | — | Drop `action` (no other usage) |
| `linkSessionPacksByEmail` (internalMutation) | `convex/sessionPacks.ts:676` | Keep — called via HTTP `/internal/link-session-packs` |
| JSDoc above the internal mutation | — | Rewrite to point at HTTP endpoint |

**Callers**: zero in apps/platform. Same pattern as PR E.

**HTTP endpoint (replacement)**: `POST /internal/link-session-packs` (`convex/http.ts:httpLinkSessionPacksByEmail` at line 763).

**Note**: `apps/platform/inngest/functions/clerk-user-linking.ts` JSDoc (line 12–13) already states "The legacy `CONVEX_SERVER_SHARED_SECRET` auth path has been removed in favour of the shared HTTP bearer (R14 secret-removal)" — that's premature; it'll become accurate after PR F lands. No edit needed.

## PR G — `convex/users_actions.ts` (HMAC role elevation)

**This file is completely dead code.** Both `*Action` wrappers have **zero callers anywhere** in the codebase (verified by grep on 2026-07-24):

- `serverVerifiedSetUserRole` — no callers (only mentioned in `convex/users.ts:288` comment).
- `serverVerifiedSetUserClerkId` — no callers.

The HTTP transport already replaces them:

- `POST /users/role` — `convex/http.ts:httpServerVerifiedSetUserRole` (line 952) — delegates directly to `internal.users.setUserRoleTrusted`. **Does NOT route through `users_actions.ts`.**
- `POST /users/clerk-id` — `convex/http.ts:httpServerVerifiedSetUserClerkId` (line 1002) — delegates directly to `internal.users.setUserClerkId`.

| Symbol | File:line | What to do |
|--------|-----------|------------|
| Entire `convex/users_actions.ts` (90 lines) | — | **Delete the file** |

The file's `'use node'` directive is only needed because the actions use `node:crypto` for HMAC. The HTTP endpoints don't need it — the HMAC verification is delegated to whatever signs the request (the caller is responsible).

**Verify nothing imports from `users_actions.ts`** before deleting:

```bash
grep -rn 'users_actions' apps/platform convex/ --include='*.ts' --include='*.tsx'
```

Should return only the comment in `convex/users.ts:288` (which can stay as historical context, or be updated to say "removed in PR G").

## PR H — final `CONVEX_SERVER_SHARED_SECRET` env-var drop

Only after D, E, F, G have merged. This is the cleanup:

1. `grep -rn 'CONVEX_SERVER_SHARED_SECRET' .` — should return zero hits (or only intentional historical-context comments).
2. `grep -rn 'SERVER_SHARED_SECRET' .` — should return zero hits.
3. Remove the env var from `apps/platform/.env.local`, Vercel project settings, and any deployment manifests.
4. Audit all four files for the file-level `const SERVER_SHARED_SECRET = process.env.CONVEX_SERVER_SHARED_SECRET` lines (already deleted by D/E/F but verify).
5. Update any `apps/platform/docs/runbooks/*.md` that mention the env var.

This PR has no code changes — it's env-var hygiene + doc cleanup. Should be small (~10–20 line doc diff).

## Key file references

- Bearer-auth HTTP transport shared helper: `apps/platform/lib/convex-server-call.ts` — `convexServerCall(path, body)` does `fetch` with `Authorization: Bearer ${CONVEX_HTTP_KEY}`.
- HTTP auth primitive: `convex/http.ts:verifyAuth(request)` (~line 30) — single source of truth for the bearer check.
- Audit log helper: `convex/auditLog.ts:writeAuditLog(ctx, {...})` — already used by admin-onboarding mutations; consider whether each deletion in D–G needs an audit row added to the surviving internal mutation (PR #670's pattern was: audit fires atomically from the internal mutation so both old + new transports were covered during WIDEN; now that the old transport is gone, audit rows still fire from the HTTP endpoint → internal mutation path, so no new audit wiring needed).
- Greptile config: `.greptile/config.yaml` at repo root. Cloud Greptile GitHub App auto-reviews every PR.
- CodeRabbit config: `.coderabbit.yaml` at repo root.
- CI workflows: `.github/workflows/ci.yml` (codegen, typecheck, build) + `.github/workflows/test.yml` (detect-changes, unit, e2e). Both fire on `pull_request` against `main` or `develop`.

## Risks for the next session

- **The apps/platform AGENTS.md Clerk policy applies.** Don't touch any Clerk config, env var, or `ClerkProvider` prop unless explicitly asked.
- **Secret Protection Policy** from the root AGENTS.md applies. Never paste real env-var values into PR bodies, commit messages, comments, or this doc.
- **Naming**: never write `mentor` or `mentee` in code. Use `instructor` / `student`. The word `mentorships` is allowed in user-facing copy.
- **Widen-migrate-narrow sequencing**: even though D/E/F/G are pure deletions, follow the pattern (branch off main → verify zero callers → delete → all 9 gates → PR → squash merge → branch auto-deleted by `gh pr merge --squash --delete-branch`). Don't skip gates.
- **Greptile cloud review may flag doc-method mismatches** (saw this on PR #671 — I wrote `GET /admin-onboarding/get` instead of `POST`). The HTTP endpoints all use `POST` per `convex/http.ts`; double-check the doc strings before pushing.
- **PR #669 commit history** (if you need to look it up): `git log --oneline 85540cf4 -1` shows the original low-risk migration that introduced these deprecated wrappers.

## Quick-start commands for the next session

```bash
# Verify current state (should show zero remaining callers for each)
grep -rn 'api\.instructors\.createInstructorForClerkUser\b\|api\.instructors\.deactivateInstructorByUserId\b' apps/platform convex/ --include='*.ts'
grep -rn 'api\.seatReservations\.linkSeatReservationsByEmailAction\b' apps/platform convex/ --include='*.ts'
grep -rn 'api\.sessionPacks\.linkSessionPacksByEmailAction\b' apps/platform convex/ --include='*.ts'
grep -rn 'users_actions' apps/platform convex/ --include='*.ts'

# Start PR D
git checkout main && git pull
git checkout -b chore/secret-removal-instructors-narrow
# (edit convex/instructors.ts per table above)
# (run 9 gates)
git add convex/instructors.ts && git commit -m 'chore(secret-removal-instructors): remove deprecated shared-secret actions'
git push -u origin chore/secret-removal-instructors-narrow
gh pr create --base main --title 'chore(secret-removal-instructors): remove deprecated shared-secret actions' --body '...'
```
