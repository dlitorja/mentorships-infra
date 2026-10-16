import { Suspense } from "react";
import { auth } from "@clerk/nextjs/server";
import { fetchMutation, fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { getConvexAuthToken } from "@/lib/auth-helpers";
import {
  OnboardingGateBanner,
  type StudentOnboardingGateEnvelope,
} from "@/components/onboarding/onboarding-gate-banner";

/**
 * PR 12 PR E (Follow-up) — In-app onboarding gate surface for the
 * `<ProtectedLayout>`-less public-ish pages. Specifically mounted
 * on `/instructors` so a freshly-claimed-but-unfinished student
 * browsing the roster still sees the soft-gate banner + an
 * explicit "Finish onboarding" link back to their questionnaire.
 *
 * Greptile round-9 P2: the protected layout exposes this banner
 * via the `gate` prop to its child tree, but `/instructors` is its
 * own server-component page (no `ProtectedLayout` wrapper —
 * marketing-style page that should render even for signed-out
 * visitors without an unauthenticated redesign). Mounting the
 * banner directly on the page is the simplest way to keep the
 * soft surface available there.
 *
 * Server-side: server components can read clerk auth + a Convex
 * token via `getConvexAuthToken()`. We re-run the same fetch +
 * claim pair that `ProtectedLayout` uses, but with the
 * `TEST_WEBHOOK_BYPASS` short-circuit applied first so Playwright
 * E2E traffic doesn't render the banner mid-test.
 */

const SAFE_DEFAULT: StudentOnboardingGateEnvelope = {
  requiresOnboardingCompletion: false,
  onboardingId: null,
  rowStatus: null,
  questionnaireSubmitted: true,
  reason: null,
};

const TIMEOUT_MS = 800;

/**
 * Server component that fetches the gate envelope (with the
 * CLAIM + QUERY pair and the 800ms timeout race that
 * `ProtectedLayout` already uses) and conditionally renders the
 * shared `<OnboardingGateBanner />` on top of its children.
 *
 * Always returns null/falls through to SAFE_DEFAULT when:
 *  - `TEST_WEBHOOK_BYPASS=true` (Playwright E2E — bypass)
 *  - `auth()` returns no user (signed-out)
 *  - `getConvexAuthToken()` returns null (Convex env not set)
 *  - the race times out or any step throws (defensive)
 */
export async function InstructorPageGateBanner() {
  // Greptile round-9 P2: mirror proxy.ts + ProtectedLayout —
  // if the platform is running under bypass, the banner should
  // never render.
  if (process.env.TEST_WEBHOOK_BYPASS === "true") return null;

  const session = await auth();
  const userId = session.userId;
  if (!userId) return null;

  const token = await getConvexAuthToken();
  if (!token) return null;

  let gate: StudentOnboardingGateEnvelope = SAFE_DEFAULT;
  try {
    const fallbackPromise = new Promise<StudentOnboardingGateEnvelope>(
      (resolve) => setTimeout(() => resolve(SAFE_DEFAULT), TIMEOUT_MS),
    );
    const gatePromise = (async (): Promise<StudentOnboardingGateEnvelope> => {
      try {
        await fetchMutation(
          api.adminOnboarding.claimOnboardingByEmailForCurrentUser,
          {},
          { token },
        );
      } catch {
        // best-effort claim; fall through to query anyway
      }
      return (await fetchQuery(
        api.adminOnboarding.getStudentOnboardingGateForCurrentUser,
        {},
        { token },
      )) as StudentOnboardingGateEnvelope;
    })();
    gate = await Promise.race<StudentOnboardingGateEnvelope>([
      gatePromise,
      fallbackPromise,
    ]);
  } catch {
    // Defensive: never block the page on a gate-side fault.
    gate = SAFE_DEFAULT;
  }

  return <OnboardingGateBanner gate={gate} />;
}

/**
 * Suspense-friendly wrapper used by `/instructors/page.tsx`. The
 * inner async component is what actually reaches Convex; we wrap
 * it so the page stream is still served promptly while the
 * banner resolves in the background.
 */
export function InstructorPageGateBannerWithSuspense() {
  return (
    <Suspense fallback={null}>
      <InstructorPageGateBanner />
    </Suspense>
  );
}
