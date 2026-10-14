/**
 * PR-E (Issue 5) — `/auth-redirect?redirect_url=…` wrapping helper
 * for email deep links.
 *
 * Email deep links that go directly to `${baseUrl}/workspace/<id>?…`
 * are dropped during the signed-out → signed-in bounce because Clerk's
 * sign-in page is mounted between the link click and the workspace
 * page. Without wrapping, `/api/auth/sync` and the auth-bounce layer
 * don't preserve the destination, and the user lands on the role-driven
 * default (`/dashboard` for students, `/instructor/dashboard` for
 * instructors) instead of the workspace named in the email.
 *
 * The fix patterns the route handler
 * `apps/platform/app/auth-redirect/page.tsx` after the Greptile-approved
 * onboarding case (round-23 P2 #1): the redirect destination is wrapped
 * with `/auth-redirect?redirect_url=…`, which Clerk preserves across
 * sign-in, then the route resolves it back to the original path on a
 * best-effort basis (subject to the path whitelist on that route).
 *
 * Use this for any email deep link whose target is an authenticated
 * platform page — bare `${baseUrl}/workspace/…` will silently break
 * destination preservation for signed-out recipients.
 *
 * @param baseUrl - The deploy base URL (use `getBaseUrl()` from `./send`)
 * @param target - The internal path the email recipient should land on,
 *   relative (must start with `/`). May include a query string.
 * @returns Absolute URL suitable for use as an `<a href>` in HTML or as
 *   the click target in plain text.
 */
export function buildAuthRedirectUrl(
  baseUrl: string,
  target: string,
): string {
  // Defence-in-depth: callers pass `target` from server-controlled
  // paths (e.g. `/workspace/<id>?videos=<sessionId>`), but
  // `encodeURIComponent` keeps the `redirect_url` query string
  // unambiguously parseable even if the upstream path contains a
  // literal `?` or `&` (e.g. a malformed deep link).
  return `${baseUrl}/auth-redirect?redirect_url=${encodeURIComponent(target)}`;
}
