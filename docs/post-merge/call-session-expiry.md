# Call interrupted by a sign-out — Clerk's 7-day maximum session lifetime (2026-11-08)

## Symptom

An instructor reported being "logged out from the site" during calls. She had
no further detail. The student on the same calls did not report it.

## Root cause

Clerk's **maximum session lifetime** on this instance is fixed at **7 days**.
It is set at sign-in and is **not extended by activity** — the ~50 second
session-token refresh keeps the short-lived JWT current but does not move
`Session.expireAt`. When the expiry lands inside a call:

1. Clerk stops issuing session tokens.
2. Convex auth flips to unauthenticated.
3. The next server navigation goes through `proxy.ts` with no valid session
   and redirects to `/sign-in`.
4. The reload tears down the Daily call, so the user has to sign in and
   rejoin — which reads as "logged out during the call".

On the current plan the lifetime cannot be raised, so this is mitigated in the
app by prompting for re-authentication **before** the call starts (see
"Mitigation" below). The durable fix remains raising Clerk's maximum lifetime
on a plan that supports custom session durations.

## Evidence

Clerk session for the instructor (`sess_3Lhl19W5CIa6NqX5dp1jHBLgNQt`):

```
created_at      2026-11-05 21:26:02 UTC
last_sign_in_at 2026-11-05 21:26:02 UTC  (password)
expire_at       2026-11-12 21:26:02 UTC  -> exactly 7 days
```

The Nov 5 call ran `20:55:43 → 22:02:48 UTC`, so the session was created
**30 minutes into the call**.

Convex call-presence system messages (`workspaceMessages` with
`type: "system"`) show the same mid-call drop/rejoin every week:

| Call date | Instructor joined | Rejoined | Left |
|---|---|---|---|
| Nov 5 | 20:57:06 | **21:26:22** | 22:02:48 |
| Oct 29 | 21:00:47 | **21:25:22** | 22:03:14 |
| Oct 22 | 21:00:53 | **21:24:01, 21:24:44** | 22:03:02 |
| Oct 15 | 20:59:35 | **21:23:05** | 22:20:02 |

The rejoin gaps are seven days apart. There is also **no "left the call"
message at the dropout point** — by then the Convex token was gone, so the
leave mutation could not be written. That is the signature of an expired
session rather than a network blip.

The student had the same thing happen on Nov 5 (joined `20:55:51`, new Clerk
session at `20:59:26`, rejoined `20:59:42`) but did not report it. His session
expires `Nov 12 20:59 UTC`, so the next call would have hit him too.

## Mitigation shipped

- `apps/platform/lib/video/session-expiry.ts` — pure decision function:
  the session is "at risk" when `expireAt` falls within the maximum call
  length (4h, matching Daily's eject) plus a 15-minute buffer.
- `apps/platform/lib/hooks/use-session-expiry.ts` — reads Clerk's
  `useSession().session.expireAt`.
- `apps/platform/components/video/session-expiry-dialog.tsx` — dialog with
  "Sign in again" (signs out and routes through
  `/api/auth/bounce-redirect?redirect_url=/workspace/...`, so the workspace
  and any `?join=` deep link survive re-auth) and "Join anyway" (advisory
  override).
- `apps/platform/components/video/video-call-provider.tsx` — guards the
  gated auto-join choke point (Join button, `requestJoin` from Start Call /
  ad-hoc, and `?join=` deep links all converge there). The override is
  ref-backed so a saved ad-hoc retry cannot re-prompt after the session has
  been created, and a `?join=` deep link is consumed once acted on so the
  5s session poll cannot resurrect a dismissed join. The deep-link effect
  itself no longer guards, which prevents the time-based threshold from
  opening the dialog over an already-joined call.
- `apps/platform/components/video/start-adhoc-button.tsx` — checks the guard
  **before** creating the ad-hoc session, so a user who re-authenticates first
  does not leave behind an active session nobody joined.
- `apps/platform/app/auth-redirect/page.tsx` — honors a validated
  `/workspace/...` destination for **all** roles before the role-based
  default, so instructors return to the workspace (and any `?join=` deep
  link) after re-auth instead of being sent to `/instructor/dashboard`.
  This also fixes staff notification-email deep links that previously lost
  their destination at sign-in.

## Operational notes

- The guard triggers only in the final ~4h15m of a session's lifetime, so it
  is not a per-call prompt.
- After this ships, affected users will be asked to sign in **before** the
  call instead of being dropped mid-call, and they will still be prompted
  roughly weekly until the Clerk lifetime can be raised.
- If the plan changes, raise Clerk Dashboard → Sessions → Maximum lifetime
  (e.g. 30 days). Only new sessions pick up the new lifetime; existing
  sessions keep the one they were created with, so affected users need to
  sign out/in once (or have their sessions revoked) to inherit it.

## Verification

- Unit tests: `apps/platform/lib/video/session-expiry.test.ts`,
  `apps/platform/components/video/session-expiry-dialog.test.tsx`,
  `apps/platform/components/video/start-adhoc-button.test.tsx`.
- Manual: set the system clock (or stub `useSession().session.expireAt`) so
  the session expires in ~30 minutes, then press Join Call. The dialog should
  appear; "Sign in again" should return to the same workspace after sign-in.
