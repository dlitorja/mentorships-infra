import { cookies } from "next/headers";
import { Suspense } from "react";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { Loader2 } from "lucide-react";
import { fetchQuery } from "convex/nextjs";

import { api } from "@/convex/_generated/api";
import { getConvexAuthToken } from "@/lib/auth-helpers";

export const dynamic = "force-dynamic";

/**
 * PR 12 PR 3 — Post-signin landing page.
 *
 * Returns the right page for the signed-in user:
 *   - admin → /admin
 *   - instructor → /instructor/dashboard
 *   - student with active onboarding → /onboarding/[id]
 *   - student without active onboarding → /dashboard (existing
 *     fallback for fully-onboarded students)
 *
 * Runs as a server component so we can use `fetchQuery` directly with
 * the Convex auth token. Mirrors the routing logic of
 * `app/sign-up-redirect/page.tsx` but on the server side, which keeps
 * the redirect fast (no client-side Convex mount required).
 */
async function resolveRedirect({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}): Promise<never> {
  const { userId, sessionClaims } = await auth();
  // PR-E: cookie store acts as a fallback for the
  // post-signin return — Clerk strips `redirect_url` from the
  // bounce (see `forceRedirectUrl` discussion below). Read
  // cookies() BEFORE auth() ordering to keep the await chain
  // explicit.
  const cookieRequested = await resolveCookieRequested();
  const requested =
    (await resolveRequestedRedirect(searchParams)) ?? cookieRequested;

  if (!userId) {
    // PR-E (Issue 5): preserve the requested destination across
    // the Clerk sign-in bounce. Clerk's <SignIn> component sets
    // `forceRedirectUrl="/auth-redirect"`, which strips the
    // `redirect_url` query on /sign-in during the round-trip and
    // ALWAYS sends users back to the bare /auth-redirect. We
    // therefore persist the destination in an HttpOnly cookie
    // via `/api/auth/bounce-redirect` and read it back from the
    // cookie store on the post-signin return. See
    // `apps/platform/app/api/auth/bounce-redirect/route.ts` and
    // `HUC-103` description for the full flow + T1–T4 tampering
    // tests.
    if (requested) {
      redirect(
        `/api/auth/bounce-redirect?redirect_url=${encodeURIComponent(requested)}`,
      );
    }
    redirect("/sign-in");
  }

  // Fast path: prefer role from session claims to avoid Clerk API latency
  const claimsRole = (sessionClaims?.publicMetadata as Record<string, unknown> | undefined)?.role;
  let role: string | undefined =
    typeof claimsRole === "string" && ["admin", "instructor", "student"].includes(claimsRole)
      ? claimsRole
      : undefined;

  // Fallback: query Clerk only when the claim isn't present
  if (!role) {
    try {
      const client = await clerkClient();
      const user = await client.users.getUser(userId);
      const metadataRole = user.publicMetadata?.role;
      if (typeof metadataRole === "string" && ["admin", "instructor", "student"].includes(metadataRole)) {
        role = metadataRole;
      }
    } catch {
      // Default below
    }
  }
  if (!role) role = "student";

  if (role === "admin") {
    redirect("/admin");
  }
  if (role === "instructor") {
    redirect("/instructor/dashboard");
  }

  // Student path: respect the requested redirect (set by
  // reminder emails) if it's an internal onboarding URL,
  // otherwise check for an active onboarding before falling
  // through to /dashboard. The query is auth-gated server-
  // side and uses the `by_assignedStudentClerkId_createdAt`
  // index — bounded lookup so this stays cheap.
  if (requested) {
    redirect(requested);
  }
  const token = await getConvexAuthToken();
  const onboardingId = await fetchQuery(
    api.adminOnboarding.getIncompleteOnboardingForCurrentUser,
    {},
    { token: token ?? undefined }
  )
    .catch(() => null);

  if (onboardingId) {
    redirect(`/onboarding/${onboardingId}`);
  }

  redirect("/dashboard");
}

async function ResolveAndRedirect({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.JSX.Element> {
  await resolveRedirect({ searchParams });
  return <></>;
}

export default function AuthRedirectPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}): React.JSX.Element {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      }
    >
      <ResolveAndRedirect searchParams={searchParams} />
    </Suspense>
  );
}

/**
 * Greptile round-23 P2 #1: reminder emails link to
 * `/sign-in?redirect_url=/onboarding/<id>/questionnaire`.
 * After sign-in Clerk redirects to `/auth-redirect`, which
 * used to ignore the requested URL and pick the newest
 * incomplete onboarding. The student landed on a different
 * draft (or a status page) than the one named in the email.
 *
 * Fix: read `redirect_url` from the search params and, if
 * it's an internal onboarding path, use it instead of the
 * role-driven default. Whitelist the prefix so a forged
 * query can't redirect off-site.
 *
 * PR-E (Issue 5): the same wrapper is now applied to
 * notification emails (recording-ready, ad-hoc-call invite)
 * that deep-link to `/workspace/<id>?…`. Extend the whitelist
 * to `/workspace/` so the destination survives the auth
 * bounce. Same prefix-`/` guard as the onboarding case (no
 * off-site redirect, no path-traversal escape via `../`).
 */
async function resolveRequestedRedirect(
  searchParams?: Promise<Record<string, string | string[] | undefined>>
): Promise<string | null> {
  if (!searchParams) return null;
  const params = await searchParams.catch(
    () => ({}) as Record<string, string | string[] | undefined>
  );
  const raw = params.redirect_url;
  const value = Array.isArray(raw) ? raw[0] : raw;
  return whitelistedRedirectValue(value);
}

/**
 * PR-E cookie-store fallback. The bounce-redirect route handler
 * sets a short-TTL HttpOnly cookie with the requested destination
 * before redirecting to /sign-in. After Clerk sends the user back
 * to the bare /auth-redirect (no `redirect_url` query), this
 * helper is the source of the destination.
 *
 * Returns null if the cookie is missing OR fails the same
 * whitelist as `resolveRequestedRedirect` — defense in depth so a
 * stale cookie set by a deleted PR cannot accidentally redirect
 * off-site.
 */
const AUTH_REDIRECT_COOKIE = "auth-redirect-target";

async function resolveCookieRequested(): Promise<string | null> {
  const store = await cookies();
  const raw = store.get(AUTH_REDIRECT_COOKIE)?.value;
  return whitelistedRedirectValue(raw);
}

/**
 * Single source of truth for the auth-redirect path whitelist.
 * Used by both `resolveRequestedRedirect` (search-param-driven)
 * and `resolveCookieRequested` (cookie-driven). HUC-103 T4
 * establishes the tampering-resistance assertions.
 */
function whitelistedRedirectValue(
  value: string | string[] | undefined,
): string | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (typeof candidate !== "string" || !candidate.startsWith("/")) return null;
  // Protocol-relative URL guard (`//evil.example.com` starts
  // with `/` but is off-site).
  if (candidate.startsWith("//")) return null;
  if (
    candidate.startsWith("/onboarding/") &&
    !candidate.startsWith("/onboarding/../")
  ) {
    return candidate;
  }
  if (
    candidate.startsWith("/workspace/") &&
    !candidate.startsWith("/workspace/../")
  ) {
    return candidate;
  }
  return null;
}
