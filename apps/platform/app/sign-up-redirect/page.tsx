"use client";

export const dynamic = "force-dynamic";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { Loader2 } from "lucide-react";

import {
  useIncompleteOnboardingForCurrentUser,
} from "@/lib/queries/convex/use-onboarding-views";

/**
 * PR 12 PR 3 — Signup landing page.
 *
 * Clerk hands off here immediately after a student accepts their
 * invitation and completes the sign-up flow. We need to decide whether
 * to send them to `/onboarding/[id]` (active onboarding exists) or fall
 * through to the role-default `/dashboard`.
 *
 * Decision tree:
 *   1. Wait for Clerk `useUser` to settle.
 *   2. Read `publicMetadata.role` — admins/instructors go to their
 *      dashboards unchanged. Students go to step 3.
 *   3. Query `getIncompleteOnboardingForCurrentUser` via
 *      `useIncompleteOnboardingForCurrentUser`. If it returns a row id,
 *      redirect there. Otherwise default to `/dashboard`.
 *
 * The query runs on mount even for non-students (cheap; the
 * `assignedStudentClerkId` index lookup is bounded) so we don't have to
 * gate it behind role resolution — but we still bail out early for
 * admin/instructor to keep the redirect fast.
 */
export default function SignUpRedirectPage(): React.JSX.Element {
  const { user, isLoaded } = useUser();
  const router = useRouter();
  const incompleteOnboarding = useIncompleteOnboardingForCurrentUser();

  useEffect(() => {
    if (!isLoaded) return;

    if (!user) {
      router.push("/sign-in");
      return;
    }

    const roleValue = user.publicMetadata?.role;
    const role = typeof roleValue === "string" ? roleValue.toLowerCase() : "";
    if (role === "admin") {
      router.push("/admin");
      return;
    }
    if (role === "instructor") {
      router.push("/instructor/dashboard");
      return;
    }

    if (incompleteOnboarding.isLoading) return;
    if (incompleteOnboarding.isError) {
      // Greptile P1 finding: an unhandled Convex query error kept the
      // page on its spinner indefinitely. Fall through to /dashboard so
      // the student at least lands somewhere useful; the recovery
      // dashboard (admin tooling, PR 4) can re-route via the
      // /onboarding/[id] deep link if the row is still active.
      router.push("/dashboard");
      return;
    }
    const onboardingId = incompleteOnboarding.data;
    if (onboardingId) {
      router.push(`/onboarding/${onboardingId}`);
      return;
    }
    router.push("/dashboard");
  }, [
    isLoaded,
    user,
    router,
    incompleteOnboarding.data,
    incompleteOnboarding.isLoading,
    incompleteOnboarding.isError,
  ]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin" />
    </div>
  );
}
