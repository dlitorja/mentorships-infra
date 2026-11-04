# Vercel Security Review — team policy (source of truth)

Paste the section below into **Settings → Agent → Security Reviews → Policy** (team policy), and
the narrower block into a project's **Settings → Security → Security Review Policy** where the
project has extra context. Plain language, 32,000-character limit, treated as context rather than
commands. Edit here first, then re-paste, so this file and the dashboard do not drift.

Runbook: [`vercel-security-review.md`](./vercel-security-review.md).

---

## Team policy (paste verbatim)

```
This is a multi-app monorepo for a mentorships product (instructors and students). Live
projects and their code roots:

- mentorships-infra-platform      -> apps/platform            (Next.js app, production)
- mentorships-infra-marketing     -> apps/marketing           (Next.js app, production)
- mentorships-infra-huckleberry-drive -> apps/huckleberry-drive (Next.js app, production)

Shared code lives in packages/* (db, ui) and the backend is Convex under convex/*. The
Supabase/Postgres schema is under packages/db/drizzle. Background jobs are Trigger.dev
(trigger/) and Inngest (apps/*/inngest). File storage is Backblaze B2; calls are Daily.co.

apps/web and apps/home are legacy. Report real vulnerabilities you see there, but note in
the finding that the app is not deployed.

Prioritise, in this order:

1. Convex authorization. A public mutation or query that reads or writes on behalf of a
   caller must compare the caller's identity (ctx.auth / identity.subject) against the
   resource it touches. Flag: public mutations that write without an admin/role gate;
   arguments accepting a userId or another user's document id that are not compared to the
   authenticated subject; writes to a child row without verifying ownership of the parent;
   public queries that return personal data (email, phone, address, payment data) without an
   ownership gate. Recordings, workspaces, orders, bookings, and messages are the
   highest-value targets.

2. Service-credential paths. convex/http.ts authenticates with a CONVEX_HTTP_KEY bearer
   token; apps/platform/lib/supabase-admin.ts holds a Supabase service-role client. Any route
   that reaches those must authenticate the caller first. Flag unconditional use, use before
   an auth check, or a new export that hands the client to request-handling code.

3. Webhooks under apps/*/app/api/webhooks/**. Signature verification must happen before any
   database write, and must use the raw request body. Missing rate limiting on a
   signature-verified webhook is expected here; do not report it unless signature
   verification is absent or bypassable.

4. Credential exposure. Hardcoded keys or tokens; secrets in NEXT_PUBLIC_* variables or
   otherwise inlined into a client bundle; secrets written to logs or to a response body.
   These are Critical.

5. Files and media. Upload/download paths (B2 workspace storage, Daily recordings,
   onboarding documents) must not allow path traversal, an over-broad signed URL, or access
   to another user's object by guessing or enumerating its key.

6. Injection and unsafe rendering. Raw SQL concatenation in packages/db, shell execution,
   server-side fetches of user-supplied URLs, and unsanitised dangerouslySetInnerHTML.

Context that reduces false positives:

- This codebase has retired its legacy role vocabulary: the domain terms are "instructor" and
  "student". Naming is not a vulnerability, and inconsistent legacy naming is not reportable.
- Authentication is Clerk. Clerk configuration, ClerkProvider props, dashboard domains, and
  proxy wiring are out of scope for suggested fixes; nobody may change them without explicit
  owner approval. If an issue genuinely requires a Clerk configuration change, describe it
  and stop there — do not propose an edit.
- convex/_generated/**, migrations under packages/db/drizzle/**, and .env.local are not
  review targets. .env.local is a redacted template of placeholders, not leaked secrets.
- Dependency versions and upgrade advice are handled by Renovate; do not file findings for
  outdated packages.
- Endpoints that authenticate with a bearer token or a verified signature, rather than a
  cookie session, do not need CSRF tokens. Do not report missing CSRF protection on them.
- Internal admin routes require an authenticated admin role; reachability from the internet
  alone is not a finding if the role gate holds.

Suggested fixes must be the smallest change that closes the issue, must not add a dependency,
must not relax an existing check, and must not include a schema change (schema changes follow
a separate widen-migrate-narrow process).
```

---

## Project policy addenda

Add one block per project where the project has context the team policy cannot infer. Keep them
short and factual — an addendum that guesses is worse than none.

### `mentorships-infra-platform`

```
apps/platform is the primary production app (dev.mentorships.huckleberry.art). It holds the
richest data: instructor profiles, student records, workspaces, chat, video calls, orders.

Highest-value targets, in order: instructor/student data isolation in Convex queries (a
student must never read another student's workspace, booking, or recording); admin-only
mutations that bypass requireRoleForApi; the Stripe and PayPal webhook handlers under
app/api/webhooks/; the Daily recording webhook; and signed-URL issuance for workspace files
and recordings.

Route handlers under app/api/ that import lib/supabase-admin.ts are service-role surfaces:
verify an authorization check precedes the first query on every one of them.
```

### `mentorships-infra-huckleberry-drive`

```
apps/huckleberry-drive is a Next.js app on drive.huckleberry.art with its own Clerk webhook
(app/api/webhooks/clerk). Treat it as a separate trust domain from apps/platform: flag any
code that lets a drive user reach platform data, or that trusts a platform identifier
without verifying ownership in this app's own data model.
```

### `mentorships-infra-marketing`

```
apps/marketing is the public marketing site on mentorships.huckleberry.art. It has an admin
CSV route (app/api/admin/free-mentorship-csv) and a Kajabi webhook. The CSV route must
require an authenticated admin; the webhook must verify its signature before writing.
Public-site content injection and open redirects matter here; broad Convex authorization
findings usually belong to the platform project instead.
```
