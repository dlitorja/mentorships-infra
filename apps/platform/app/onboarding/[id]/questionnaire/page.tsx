import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getConvexAuthToken } from "@/lib/auth-helpers";
import { ProtectedLayout } from "@/components/navigation/protected-layout";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import OnboardingQuestionnaireForm from "@/components/onboarding/onboarding-questionnaire-form";

/**
 * PR 12 PR 4b — student onboarding questionnaire page.
 *
 * Server component: fetches the draft submission + active work
 * examples for the signed-in student, then hands off to the
 * `OnboardingQuestionnaireForm` client component. Renders a 404
 * (not a 403) when the row is missing or the caller is not the
 * assigned student — same existence-leak guard as the PR 3 status
 * page (Plan §5.3 acceptance).
 *
 * Read shape: the form expects a serialized `{ submission, workExamples }`
 * object so the client never needs to know about the underlying
 * Convex doc types.
 */
export default async function OnboardingQuestionnairePage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id: rawId } = await params;
  const id = (typeof rawId === "string" ? rawId : null) as
    | Id<"adminOnboardings">
    | null;
  if (!id) notFound();

  const { userId } = await auth();
  if (!userId) notFound();
  const token = await getConvexAuthToken();

  // Greptile P2: gate on `getOnboardingView` first. That query
  // returns the caller's role (`student` for the assigned student,
  // `instructor` for one of the assigned instructors, `admin`/`support`
  // for staff). Anything else is a 404 — same existence-leak guard
  // as the PR 3 status page. We can't rely on
  // `getQuestionnaireForCurrentUser` returning `null` to mean "no
  // access", because it also returns `null` on a student's first
  // visit (no draft yet) — the form needs an initial value in that
  // case but a 404 in the no-access case.
  const view = await fetchQuery(
    (api as any).adminOnboarding.getOnboardingView,
    { onboardingId: id },
    { token: token ?? undefined }
  ).catch(() => null);

  if (!view || view.viewerRole !== "student") notFound();

  // Greptile round-27 P2 #4: refuse the editable form on
  // a cancelled onboarding. `getOnboardingView` still
  // returns the assigned student's role after cancellation
  // (so they can see the timeline), but `ensureAssignedStudent`
  // throws on any save/submit and the student would fill out
  // a form that always fails. Show a cancelled notice instead.
  if (view.onboarding.status === "cancelled") {
    return (
      <ProtectedLayout>
        <div className="mx-auto max-w-3xl space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Onboarding cancelled</CardTitle>
              <CardDescription>
                This mentorship onboarding was cancelled. If you were
                expecting to fill out a questionnaire, please contact
                support.
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      </ProtectedLayout>
    );
  }
  // PR 13 — parity with the redirect target. The
  // `/onboarding/[id]` route bounces `failed` rows back to
  // this Card (no redirect to /questionnaire), but if a stale
  // tab / shared link still lands here directly, refuse the
  // form rather than letting the student fill it out and hit
  // an unavoidable save error. Admins retry via
  // `retryAdminOnboarding`; the student waits on the admin.
  if (view.onboarding.status === "failed") {
    return (
      <ProtectedLayout>
        <div className="mx-auto max-w-3xl space-y-6">
          <Card className="border-destructive/40 bg-destructive/5">
            <CardHeader>
              <CardTitle className="text-destructive text-lg">
                We couldn&apos;t finish setting this up
              </CardTitle>
              <CardDescription>
                {view.onboarding.failureReason ??
                  "Please reach out to support@mentorships.com if this has been stuck for more than a business day."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Your administrator has been notified and will retry this. If
                this has been stuck for more than a business day, email{" "}
                <a
                  className="font-medium underline"
                  href="mailto:support@mentorships.com"
                >
                  support@mentorships.com
                </a>
                .
              </p>
            </CardContent>
          </Card>
        </div>
      </ProtectedLayout>
    );
  }

  const initial = await fetchQuery(
    (api as any).onboardingQuestionnaire.getQuestionnaireForCurrentUser,
    { onboardingId: id },
    { token: token ?? undefined }
  )
    .then(async (submission) => {
      const workExamples = await fetchQuery(
        (api as any).onboardingWorkExamples.listWorkExamples,
        { onboardingId: id },
        { token: token ?? undefined }
      ).catch(() => []);
      return { submission: submission ?? null, workExamples: workExamples ?? [] };
    })
    .catch(() => null);

  if (!initial) notFound();

  return (
    <ProtectedLayout>
      <div className="mx-auto max-w-3xl space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Tell your instructor about you</CardTitle>
            <CardDescription>
              This takes about 5 minutes. Your answers auto-save as you type,
              so you can come back any time before submitting.
            </CardDescription>
          </CardHeader>
        </Card>

        <OnboardingQuestionnaireForm
          onboardingId={id}
          initial={initial}
        />
      </div>
    </ProtectedLayout>
  );
}
