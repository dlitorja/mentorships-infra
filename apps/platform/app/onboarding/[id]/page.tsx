import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { fetchQuery } from "convex/nextjs";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getConvexAuthToken } from "@/lib/auth-helpers";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { OnboardingStepper } from "@/components/onboarding/onboarding-stepper";
import { ProtectedLayout } from "@/components/navigation/protected-layout";
import { statusLabel, type OnboardingStatus } from "@/lib/admin-onboarding";
// ApiRoutes is intentionally not used in this server component
// (the WorkExampleThumb now goes through `convex.action()`); keep
// the import path here as a placeholder for future client-side
// fallbacks.
import * as _ApiRoutesUnused from "@/lib/routes";
void _ApiRoutesUnused;

const STATUS_VARIANTS: Record<
  OnboardingStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  queued: "outline",
  processing: "default",
  completed: "secondary",
  failed: "destructive",
  cancelled: "outline",
};

function parseOnboardingId(raw: string | string[] | undefined): Id<"adminOnboardings"> | null {
  if (typeof raw !== "string" || !raw) return null;
  return raw as Id<"adminOnboardings">;
}

function formatDateTime(ms: number | null | undefined): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString();
}

export default async function OnboardingStatusPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  // Next.js 16: `params` is a Promise — must be awaited before reading
  // the onboarding id. Greptile P1 finding on the original sync read.
  const { id: rawId } = await params;
  const id = parseOnboardingId(rawId);

  // No `requireRole` here: `getOnboardingView` does its own auth gate
  // (assigned student / matching instructor / admin / support) and
  // returns `null` for any other identity. Routing `null` through
  // `notFound()` avoids leaking the existence of the row (Plan §5.3
  // acceptance: 404, not 403).
  const { userId } = await auth();
  const token = await getConvexAuthToken();

  const view = id
    ? await fetchQuery(
        api.adminOnboarding.getOnboardingView,
        { onboardingId: id },
        { token: token ?? undefined }
      ).catch(() => null)
    : null;

  if (!userId || !view) {
    notFound();
  }

  const { onboarding, viewerRole, instructors, timeline, timelineOlderCount } = view;

  const isStudent = viewerRole === "student";
  const showHelpFooter = timelineOlderCount > 0;

  // PR 12 PR 4b — questionnaire state. For students, fetch their
  // draft so we can show a "Continue" CTA. For instructor/admin,
  // fetch the submitted row (if any) so we can render the answers.
  const myDraft = isStudent
    ? await fetchQuery(
        (api as any).onboardingQuestionnaire.getQuestionnaireForCurrentUser,
        { onboardingId: id },
        { token: token ?? undefined }
      ).catch(() => null)
    : null;
  const submittedForViewer = !isStudent
    ? await fetchQuery(
        (api as any).onboardingQuestionnaire.getSubmittedQuestionnaireForViewer,
        { onboardingId: id },
        { token: token ?? undefined }
      ).catch(() => null)
    : null;
  const submittedWorkExamplesRaw = !isStudent
    ? await fetchQuery(
        (api as any).onboardingWorkExamples.listWorkExamples,
        { onboardingId: id },
        { token: token ?? undefined }
      ).catch(() => [])
    : [];
// Greptile round-24 P2 #1: listWorkExamples returns pending
// uploads too (so the student sees their in-flight uploads),
// but the instructor gallery should only show finished
// (active) work. Pending rows don't have a valid B2 object
// yet and would render as broken "(image)" placeholders.
const submittedWorkExamples = (
  submittedWorkExamplesRaw as Array<{
    _id: string;
    fileName: string;
    status: string;
  }>
).filter((w) => w.status === "active");

  return (
    <ProtectedLayout currentPath="/onboarding">
      <div className="container mx-auto py-8 space-y-8">
        <header className="space-y-2">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight">Welcome</h1>
            <Badge variant={STATUS_VARIANTS[onboarding.status]}>
              {statusLabel(onboarding.status)}
            </Badge>
          </div>
          <p className="text-muted-foreground">
            We&apos;re setting up your mentorship access for{" "}
            <span className="font-medium text-foreground">{onboarding.email}</span>.
          </p>
          <p className="text-xs text-muted-foreground">
            Created {formatDateTime(onboarding.createdAt)} · Last update{" "}
            {formatDateTime(timeline.at(-1)?.at ?? onboarding.createdAt)} · Attempt{" "}
            {onboarding.attemptCount}
            {viewerRole !== "student" && (
              <> · Viewing as {viewerRole}</>
            )}
          </p>
        </header>

        <OnboardingStepper
          status={onboarding.status}
          questionnaireSubmitted={
            isStudent
              ? myDraft?.status === "submitted"
              : submittedForViewer != null
          }
        />

        {onboarding.status === "failed" && onboarding.failureReason && (
          <Card className="border-destructive/40 bg-destructive/5">
            <CardHeader>
              <CardTitle className="text-destructive text-lg">
                We couldn&apos;t finish setting this up
              </CardTitle>
              <CardDescription>{onboarding.failureReason}</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Your administrator has been notified and will retry this. If this has
                been stuck for more than a business day, reach out to{" "}
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
        )}

        <Card>
          <CardHeader>
            <CardTitle>
              {instructors.length === 1 ? "Your instructor" : "Your instructors"}
            </CardTitle>
            <CardDescription>
              We&apos;ll create a private workspace with each one for your sessions.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {instructors.map((inst) => (
                <li
                  key={inst._id}
                  className="flex items-center justify-between py-3 first:pt-0 last:pb-0"
                >
                  <div className="space-y-0.5">
                    <p className="font-medium">
                      {inst.name ?? `Instructor ${inst._id.slice(-6)}`}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {inst.isRenewal ? "Renewing existing access" : "New workspace"}
                    </p>
                  </div>
                  {/* Greptile P2 finding: a renewal pair is "ready" the
                     moment the row exists; a new-workspace pair only
                     flips to ready once the row is `completed`. */}
                  {inst.isRenewal && (
                    <Badge variant="secondary">Ready</Badge>
                  )}
                  {!inst.isRenewal && onboarding.status === "completed" && (
                    <Badge variant="secondary">Ready</Badge>
                  )}
                  {!inst.isRenewal && onboarding.status !== "completed" && (
                    <Badge variant="outline">Preparing</Badge>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>What happens next</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {onboarding.status === "completed" && (
              <div className="space-y-3">
                <p>
                  Your workspaces are ready. Pick an instructor above to book your
                  first session.
                </p>
                <Button asChild>
                  <Link href="/dashboard">Go to your dashboard</Link>
                </Button>
              </div>
            )}
            {onboarding.status === "processing" && (
              <p className="text-muted-foreground">
                We&apos;re finishing the last steps on our side. This usually takes
                a few minutes — refresh this page to check for updates.
              </p>
            )}
            {onboarding.status === "queued" && (
              <p className="text-muted-foreground">
                Your invitation has been queued. Once you complete sign-up, we&apos;ll
                finish setting up your workspaces.
              </p>
            )}
            {onboarding.status === "cancelled" && (
              <p className="text-muted-foreground">
                This onboarding was cancelled. If this is unexpected, please reach out
                to your administrator.
              </p>
            )}
          </CardContent>
        </Card>

        {showHelpFooter && (
          <p className="text-center text-xs text-muted-foreground">
            <span className="font-medium">{timelineOlderCount}</span> earlier update
            {timelineOlderCount === 1 ? "" : "s"} not shown. Need help? Email{" "}
            <a className="underline" href="mailto:support@mentorships.com">
              support@mentorships.com
            </a>
            .
          </p>
        )}

        {isStudent && (
          <Card>
            <CardHeader>
              <CardTitle>
                {myDraft && myDraft.status === "draft"
                  ? "Almost there — finish your questionnaire"
                  : "Tell your instructor about you"}
              </CardTitle>
              <CardDescription>
                Your instructor reads these answers before your first call so
                they can prepare a session that&apos;s useful for you.
                {myDraft && myDraft.status === "draft" &&
                  " Auto-save keeps your draft; come back any time."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild>
                <Link href={`/onboarding/${onboarding._id}/questionnaire`}>
                  {myDraft?.status === "submitted"
                    ? "View questionnaire"
                    : myDraft?.status === "draft"
                      ? "Continue questionnaire"
                      : "Start questionnaire"}
                </Link>
              </Button>
            </CardContent>
          </Card>
        )}

        {!isStudent && submittedForViewer && (
          <Card>
            <CardHeader>
              <CardTitle>Student questionnaire</CardTitle>
              <CardDescription>
                {/* Greptile P1 #6: answers + inspirations live under
                   `submittedForViewer.submission`, not on the outer
                   object. */}
                Submitted {formatDateTime(submittedForViewer.submission?.submittedAt)}.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                {(submittedForViewer.submission?.answers ?? []).map(
                  (a: {
                    questionId: string;
                    questionText?: string;
                    answerText: string;
                  }) => (
                    <div key={a.questionId} className="space-y-1">
                      <p className="text-sm font-medium">
                        {a.questionText ?? questionLabel(a.questionId)}
                      </p>
                      <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                        {a.answerText || <em>No answer</em>}
                      </p>
                    </div>
                  )
                )}
              </div>
              <div>
                <p className="mb-2 text-sm font-medium">Inspirations</p>
                <ul className="list-disc pl-5 text-sm text-muted-foreground">
                  {(submittedForViewer.submission?.inspirations ?? []).map(
                    (i: { name: string }, idx: number) => (
                      <li key={idx}>{i.name}</li>
                    )
                  )}
                </ul>
              </div>
              {/* Greptile P1 #7: render the uploaded images here so
                 instructors can actually review the work before the
                 first call. Each <img> fetches a fresh signed GET
                 URL (1h TTL) from the work-examples download-url
                 API route, which re-checks the viewer's auth gate. */}
              {Array.isArray(submittedWorkExamples) && submittedWorkExamples.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">
                    Work examples ({submittedWorkExamples.length})
                  </p>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {submittedWorkExamples.map((w: { _id: string; fileName: string }) => (
                      <WorkExampleThumb
                        key={w._id}
                        onboardingId={onboarding._id}
                        exampleId={w._id}
                        fileName={w.fileName}
                      />
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {isStudent && (
          <p className="text-center text-xs text-muted-foreground">
            Signed in as a student.{" "}
            <Link href="/dashboard" className="underline">
              Go to dashboard
            </Link>
          </p>
        )}
      </div>
    </ProtectedLayout>
  );
}

function questionLabel(id: string): string {
  switch (id) {
    case "how_did_you_hear":
      return "How did you learn about this mentorship?";
    case "goals":
      return "Goals";
    case "inspirations":
      return "Inspirations";
    default:
      return id;
  }
}

/**
 * Greptile P1 #7 helper: each thumbnail mints its own short-lived
 * signed GET URL on render (server component). The URL TTL is 1h and
 * the download-url API route re-checks the viewer is authorized
 * (student / matching instructor / admin / support).
 */
async function WorkExampleThumb({
  onboardingId,
  exampleId,
  fileName,
}: {
  onboardingId: string;
  exampleId: string;
  fileName: string;
}): Promise<React.JSX.Element> {
  // Greptile round-19 P1 #1: this server component was
  // calling `fetchQuery` on an action (wrong API) and then
  // falling back to a fetch() call that forwarded a Convex
  // JWT as a bearer token to a Clerk-protected route. The
  // route's `auth()` reads Clerk cookies, so the bearer was
  // ignored and the call 401'd, showing "(image)" instead of
  // the artwork.
  //
  // Fix: use the Convex HTTP client directly. It carries the
  // Convex JWT (which the action's auth layer recognises) and
  // supports actions via `client.action()`. The
  // `getWorkExampleDownloadUrl` action is the same one the
  // `/api/.../download-url` route uses, so the auth gate and
  // presigned-URL mint logic are unchanged.
  let url: string | null = null;
  try {
    const { getAuthenticatedConvexClient } = await import(
      "@/lib/convex"
    );
    const convex = await getAuthenticatedConvexClient();
    const workExample = await convex.query(
      (api as any).onboardingWorkExamples.getWorkExampleByIdForViewer,
      {
        onboardingId: onboardingId as Id<"adminOnboardings">,
        workExampleId: exampleId as Id<"onboardingWorkExamples">,
      }
    );
    if (!workExample) {
      throw new Error("Work example not found");
    }
    const { url: signedUrl } = await convex.action(
      (api as any).onboardingWorkExamplesActions.getWorkExampleDownloadUrl,
      {
        onboardingId: onboardingId as Id<"adminOnboardings">,
        b2Key: (workExample as { b2Key: string }).b2Key,
      }
    );
    url = signedUrl;
  } catch {
    url = null;
  }
  return (
    <div className="relative aspect-square overflow-hidden rounded-md border bg-muted">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={fileName}
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
          (image)
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 bg-background/80 px-2 py-1 text-xs">
        <span className="line-clamp-1">{fileName}</span>
      </div>
    </div>
  );
}
