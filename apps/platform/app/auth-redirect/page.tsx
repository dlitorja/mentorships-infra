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
  const requested = await resolveRequestedRedirect(searchParams);

  if (!userId) {
    // Preserve the requested destination through sign-in so
    // the post-auth redirect lands the user on the page they
    // asked for (used by reminder emails linking back to a
    // specific draft).
    redirect(
      requested
        ? `/sign-in?redirect_url=${encodeURIComponent(requested)}`
        : "/sign-in"
    );
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
  if (typeof value !== "string" || !value.startsWith("/")) return null;
  // Whitelist internal onboarding paths so a forged query
  // can't redirect off-site.
  if (
    value.startsWith("/onboarding/") &&
    !value.startsWith("/onboarding/../")
  ) {
    return value;
  }
  return null;
}
