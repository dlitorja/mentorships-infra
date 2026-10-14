import { NextRequest, NextResponse } from "next/server";

// PR-E (Issue 5) — destination preservation across Clerk sign-in.
//
// Greptile P1 (PR #933 round 1, comment icon at
// https://github.com/dlitorja/mentorships-infra/pull/933#discussion_r4275736653)
// traced the auth-redirect flow:
//
//   email link -> /auth-redirect?redirect_url=...
//   -> if signed out, redirect to /sign-in?redirect_url=...
//   -> Clerk's <SignIn> sets `forceRedirectUrl="/auth-redirect"`
//   -> after sign-in, Clerk ALWAYS sends to that bare path
//   -> /auth-redirect reads `searchParams` with no redirect_url
//   -> falls through to role-driven default.
//
// Verified against @clerk/shared@4.33.0
// dist/internal/clerk-js/redirectUrls.mjs `getRedirectUrl`:
//
//   let result;
//   result = this.fromSearchParams[forceKey]
//        || this.fromProps[forceKey]
//        || this.fromOptions[forceKey];
//   result ||= this.fromSearchParams.redirectUrl;  // only fires if result is falsy
//   result ||= this.fromSearchParams[fallbackKey] ...;
//
// Because the apps/platform <SignIn> component passes
// `forceRedirectUrl="/auth-redirect"` as a prop, the prop wins
// BEFORE `searchParams.redirectUrl` is consulted. The Clerk Changes
// Policy in apps/platform/AGENTS.md restricts ClerkProvider and
// component UI props, so we cannot remove the prop here.
//
// Fix: persist the requested destination in an HttpOnly, scoped
// cookie before bouncing to /sign-in. The post-signin return at
// the bare /auth-redirect (no `redirect_url` query) reads the
// cookie and uses it for role-aware dispatch (HUC-103 T1/T2).

const COOKIE_NAME = "auth-redirect-target";
const COOKIE_MAX_AGE = 5 * 60; // 5 minutes — outlasts a Clerk sign-in.

/**
 * Mirrors the existing
 * `apps/platform/app/auth-redirect/page.tsx`
 * `resolveRequestedRedirect` whitelist. Single source-of-truth
 * lives in the page; this list is the runtime guard. The two stay
 * in sync via tests — see HUC-103 T4.
 */
const ALLOW_PREFIXES = ["/onboarding/", "/workspace/"] as const;
// Protocol-relative URL guard (`//evil.example.com` starts with `/`
// but is off-site). The prefix-`/` guard is in `isValidTarget`.
const DENY_SUBSTRINGS = ["/../", "/onboarding/../", "/workspace/../"] as const;

function isValidTarget(value: unknown): value is string {
  if (typeof value !== "string" || !value.startsWith("/")) return false;
  // Reject protocol-relative before the prefix match — `//foo.bar`
  // also starts with `/`, but is off-site.
  if (value.startsWith("//")) return false;
  for (const deny of DENY_SUBSTRINGS) {
    if (value.startsWith(deny)) return false;
  }
  for (const prefix of ALLOW_PREFIXES) {
    if (value.startsWith(prefix)) return true;
  }
  return false;
}

/**
 * GET /api/auth/bounce-redirect?redirect_url=...
 *
 * Reads `redirect_url`, validates against the whitelist, and sets
 * the destination cookie before redirecting to bare `/sign-in`. If
 * the value is missing or fails the whitelist, the cookie is NOT
 * set and we still redirect to `/sign-in` so a stale cookie from
 * a prior in-flight sign-in cannot accidentally fire.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const raw = request.nextUrl.searchParams.get("redirect_url");
  const target = isValidTarget(raw) ? raw : null;

  const redirectTo = new URL("/sign-in", request.nextUrl.origin);
  const res = NextResponse.redirect(redirectTo);

  if (target) {
    res.cookies.set(COOKIE_NAME, target, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/auth-redirect",
      maxAge: COOKIE_MAX_AGE,
    });
    // Belt-and-braces: also forward `redirect_url` on the query so
    // that IF Clerk honors it (or a future Clerk version starts to),
    // the destination still propagates. The cookie is the primary
    // path under the current Clerk `forceRedirectUrl` behavior.
    redirectTo.searchParams.set("redirect_url", target);
  }

  return res;
}
