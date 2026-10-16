"use client";

import Link from "next/link";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Sparkles, ArrowRight } from "lucide-react";

/**
 * PR 12 PR E (Follow-up) — In-app onboarding gate surface.
 *
 * Two components here, both consume the same
 * `StudentOnboardingGate` envelope from
 * `useStudentOnboardingGateForCurrentUser`:
 *
 *   - `<OnboardingGateBanner />` — sticky top-of-page banner
 *     rendered by `ProtectedLayout` whenever the gate is active
 *     for the current student. Visible on every protected route
 *     including the dashboard, so the student always sees their
 *     unfinished work next to instructor/billing content.
 *
 *   - `<OnboardingWelcomeCard />` — interstitial card that swaps
 *     the `<DashboardContent>` empty state while the gate is
 *     active. Centered, holds the student's attention on the
 *     questionnaire until they finish.
 *
 * Both are pure presentational: the gate decision lives in Convex
 * (`getStudentOnboardingGateForCurrentUser`); both components just
 * render the result. The proxy.ts middleware also performs the
 * same check, so the welcome card is largely belt-and-suspenders
 * for the dashboard path that proxy.ts allows through.
 */
export type StudentOnboardingGateEnvelope = {
  requiresOnboardingCompletion: boolean;
  onboardingId: Id<"adminOnboardings"> | null;
  rowStatus: "queued" | "processing" | "completed" | "failed" | "cancelled" | null;
  questionnaireSubmitted: boolean;
  reason: string | null;
};

interface OnboardingGateBannerProps {
  gate: StudentOnboardingGateEnvelope;
}

/**
 * Sticky banner rendered above `<main>` in `ProtectedLayout` so
 * the student sees the unfinished-onboarding note on every
 * protected page (workspace, sessions, calendar, settings).
 */
export function OnboardingGateBanner({ gate }: OnboardingGateBannerProps) {
  if (!gate.requiresOnboardingCompletion || !gate.onboardingId) {
    return null;
  }
  const href = `/onboarding/${gate.onboardingId}`;
  return (
    <div
      role="status"
      aria-live="polite"
      className="mb-4 rounded-lg border-2 border-amber-300 bg-amber-50 p-4 shadow-sm dark:bg-amber-950/40 dark:border-amber-700"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <Sparkles className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-700 dark:text-amber-400" aria-hidden="true" />
          <div>
            <p className="font-semibold text-amber-900 dark:text-amber-200">
              One last step before we can set up your session
            </p>
            <p className="mt-1 text-sm text-amber-800 dark:text-amber-300">
              {gate.reason ?? "Finish your onboarding questionnaire before continuing."}
            </p>
          </div>
        </div>
        <Link href={href} className="flex-shrink-0">
          <Button variant="default" size="sm" className="gap-2">
            Finish onboarding
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </Link>
      </div>
    </div>
  );
}

interface OnboardingWelcomeCardProps {
  gate: StudentOnboardingGateEnvelope;
}

/**
 * Interstitial card replacing the empty-state of `<DashboardContent>`
 * for gated students. Larger than the banner because the student
 * lands on `/dashboard` after Clerk's `AFTER_SIGN_UP_URL` and we
 * want to give them a clear "do this next" affordance.
 */
export function OnboardingWelcomeCard({ gate }: OnboardingWelcomeCardProps) {
  if (!gate.requiresOnboardingCompletion || !gate.onboardingId) {
    return null;
  }
  const href = `/onboarding/${gate.onboardingId}`;
  const isFailed = gate.rowStatus === "failed";
  return (
    <Card className="border-2 border-amber-300 bg-gradient-to-br from-amber-50 via-background to-background dark:border-amber-700 dark:from-amber-950/40">
      <CardHeader>
        <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
          <Sparkles className="h-5 w-5" aria-hidden="true" />
          <span className="text-xs font-semibold uppercase tracking-wider">
            {isFailed ? "Onboarding needs attention" : "Almost there"}
          </span>
        </div>
        <CardTitle className="mt-2 text-2xl">
          {isFailed
            ? "Your onboarding has been paused"
            : "Welcome — let's introduce you to your instructor"}
        </CardTitle>
        <CardDescription className="text-base">
          {gate.reason ?? "Tell your instructor a little about your goals so your first call can be useful."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Link href={href}>
          <Button size="lg" className="gap-2">
            {isFailed ? "View onboarding status" : "Finish onboarding"}
            <ArrowRight className="h-5 w-5" aria-hidden="true" />
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}
