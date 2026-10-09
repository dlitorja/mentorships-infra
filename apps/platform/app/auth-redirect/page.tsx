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
async function resolveRedirect(): Promise<never> {
  const { userId, sessionClaims } = await auth();

  if (!userId) {
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

  // Student path: check for an active onboarding before falling through
  // to /dashboard. The query is auth-gated server-side and uses the
  // `by_assignedStudentClerkId_createdAt` index — bounded lookup so
  // this stays cheap.
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

export default function AuthRedirectPage(): React.JSX.Element {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      }
    >
      <ResolveAndRedirect />
    </Suspense>
  );
}

async function ResolveAndRedirect(): Promise<React.JSX.Element> {
  await resolveRedirect();
  return <></>;
}
