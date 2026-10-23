"use client";

import React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Linkify } from "@/components/ui/linkify";
import {
  Loader2,
  AlertTriangle,
  ArrowLeft,
  ListChecks,
  Search,
  FileText,
  Clock,
} from "lucide-react";
import {
  useAdminOnboarding,
  useSubmittedQuestionnaire,
  useOnboardingWorkExamples,
} from "@/lib/queries/convex/use-admin-onboardings";
import { statusLabel, timelineEventLabel, type OnboardingStatus } from "@/lib/admin-onboarding";
import { getOnboardingQuestionLabel } from "@/lib/onboarding-questions";
import type { Id } from "@/convex/_generated/dataModel";
import { RetryOnboardingButton } from "@/components/admin/retry-onboarding-button";
import { ResendInvitationButton } from "@/components/admin/resend-invitation-button";
import { WorkExampleThumb } from "@/components/onboarding/work-example-thumb";

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

function formatDateTime(ms: number | null | undefined): string {
  if (!ms) return "-";
  return new Date(ms).toLocaleString();
}

function parseOnboardingId(raw: string | string[] | undefined): Id<"adminOnboardings"> | null {
  if (typeof raw !== "string" || !raw) return null;
  return raw as Id<"adminOnboardings">;
}

export default function AdminOnboardingDetailPage(): React.JSX.Element {
  const params = useParams<{ id: string }>();
  const id = parseOnboardingId(params?.id);

  const { data, isLoading, error } = useAdminOnboarding(id);
  // PR — admin questionnaire review: pull both the answer payload
  // (via `getSubmittedQuestionnaireForViewer`, gated on
  // assigned-student / matching-instructor / admin-support) AND the
  // active-only work example rows (via `listWorkExamples`, the
  // same query the staff branch in `/onboarding/[id]` uses). Both
  // are no-ops for unauthorized callers, so this admin detail page
  // can't accidentally leak answers + images to a non-staff viewer
  // even if role gating is misconfigured upstream.
  const questionnaire = useSubmittedQuestionnaire(id);
  // `listWorkExamples` returns pending + active rows for forms that
  // need them; here we filter to active so a pending in-flight upload
  // doesn't render as a broken "(image)" placeholder on the review
  // card (Greptile round-24 P2 #1 lesson).
  const workExamplesQuery = useOnboardingWorkExamples(id);

  const activeWorkExamples = React.useMemo(
    () =>
      (workExamplesQuery.data ?? []).filter((w) => w.status === "active"),
    [workExamplesQuery.data]
  );

  if (!id) {
    return (
      <div className="container mx-auto py-8">
        <div className="mb-6">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/admin/onboardings">
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back to list
            </Link>
          </Button>
        </div>
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          <AlertTriangle className="inline h-4 w-4 mr-2" />
          Missing onboarding id in the URL.
        </div>
      </div>
    );
  }

  // Split out the "loaded but record not found" case so the UI does not
  // spin forever on stale detail links (Greptile finding).
  const isLoaded = !isLoading && !error;
  const isMissing = isLoaded && data === null;

  return (
    <div className="container mx-auto py-8">
      <div className="mb-6 flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/admin/onboardings">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back to list
          </Link>
        </Button>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ListChecks className="h-6 w-6" />
          Onboarding detail
        </h1>
      </div>

      {data ? (
        <div className="mb-6 flex items-center justify-between rounded-md border bg-card p-4">
          <div className="text-sm text-muted-foreground">
            Status: <Badge variant={STATUS_VARIANTS[data.status]}>{statusLabel(data.status)}</Badge>
            <span className="ml-3">Attempt: {data.attemptCount}</span>
          </div>
          <div className="flex items-center gap-2">
            <ResendInvitationButton
              onboardingId={id}
              currentStatus={data.status}
              hasInvitationId={data.perInstructor.some(
                (p) => typeof p.clerkInvitationId === "string" && p.clerkInvitationId.length > 0
              )}
              variant="outline"
              size="sm"
            />
            <RetryOnboardingButton
              onboardingId={id}
              currentStatus={data.status}
              variant="default"
              size="sm"
              label="Retry this onboarding"
            />
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          <AlertTriangle className="inline h-4 w-4 mr-2" />
          Failed to load: {String((error as Error).message ?? error)}
        </div>
      ) : isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      ) : isMissing ? (
        <div className="rounded-md border bg-muted/30 p-6 text-center">
          <Search className="inline h-5 w-5 mr-2 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No onboarding found for id <span className="font-mono">{id}</span>. It may have been removed or the link is stale.
          </p>
          <div className="mt-4">
            <Button variant="outline" asChild>
              <Link href="/admin/onboardings">Back to list</Link>
            </Button>
          </div>
        </div>
      ) : data ? (
        <div className="space-y-6">
          {/* Top row: Summary + Per-instructor side-by-side. These
              are the read-only audit metadata an admin reaches for
              first ("who's this for, who's teaching them, what's
              the status") — pair them so they share visual weight. */}
          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Summary</CardTitle>
                <CardDescription>
                  Submitted {formatDateTime(data.createdAt)}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Email</span>
                  <span className="font-mono">{data.email}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Status</span>
                  <Badge variant={STATUS_VARIANTS[data.status]}>
                    {statusLabel(data.status)}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Source</span>
                  <Badge variant="outline">{data.source}</Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Flow version</span>
                  <span>{data.flowVersion}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Attempts</span>
                  <span>{data.attemptCount}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Submitted by</span>
                  <span className="font-mono text-xs">{data.submittedByUserId}</span>
                </div>
                {data.completedAt ? (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Completed</span>
                    <span>{formatDateTime(data.completedAt)}</span>
                  </div>
                ) : null}
                {data.cancelledAt ? (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Cancelled</span>
                    <span>{formatDateTime(data.cancelledAt)}</span>
                  </div>
                ) : null}
                {data.failureReason ? (
                  <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-destructive">
                    <strong>Failure:</strong> {data.failureReason}
                  </div>
                ) : null}
                {data.capacityOverrideReason ? (
                  <div className="rounded-md border border-amber-500/40 bg-amber-50 p-3 text-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
                    <strong>Capacity override:</strong> {data.capacityOverrideReason}
                  </div>
                ) : null}
                {data.notes ? (
                  <div className="rounded-md border bg-muted/30 p-3">
                    <strong>Notes:</strong> {data.notes}
                  </div>
                ) : null}
                {/* PR 14 — student-set timezone. The picker
                    (`<TimezonePicker>`) writes `studentTimezone` and
                    `studentTimezoneSetAt` on this row when the
                    student arrives on the questionnaire page.
                    Showing it alongside the rest of the summary
                    state lets an admin spot-check the timezone
                    looks plausible (right region, plausible UTC
                    offset) before they help coordinate the first
                    session. */}
                {data.studentTimezone ? (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground inline-flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      Student timezone
                    </span>
                    <span className="font-mono text-xs">
                      {data.studentTimezone}
                      {data.studentTimezoneSetAt ? (
                        <span className="text-muted-foreground">
                          {" · set "}
                          {formatDateTime(data.studentTimezoneSetAt)}
                        </span>
                      ) : null}
                    </span>
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Per-instructor assignments</CardTitle>
                <CardDescription>
                  {data.perInstructor.length} instructor
                  {data.perInstructor.length === 1 ? "" : "s"} assigned
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3">
                  {data.perInstructor.map((p, idx) => (
                    <li
                      key={`${p.instructorId}-${idx}`}
                      className="rounded-md border p-3 text-sm space-y-1"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs">{p.instructorId}</span>
                        <Badge variant={p.isRenewal ? "secondary" : "outline"}>
                          {p.isRenewal ? "Renewal" : "New workspace"}
                        </Badge>
                      </div>
                      <div className="text-muted-foreground">
                        Sessions: {p.sessionsPerInstructor}
                      </div>
                      {p.workspaceId ? (
                        <div className="text-muted-foreground">
                          Workspace: <span className="font-mono text-xs">{p.workspaceId}</span>
                        </div>
                      ) : null}
                      {p.capacityOverride ? (
                        <Badge variant="outline" className="text-amber-700 border-amber-500">
                          Capacity override
                        </Badge>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>

          {/* "Student questionnaire" full-width card. The user's ask
              ("admins should be able to see this so we can
              facilitate things") lives here — answers, inspirations,
              and work examples all rendered with the same affordances
              an instructor sees on `/onboarding/[id]` (Linkify on
              free text, signed-URL thumbnails, no pending in-flight
              uploads). Full width means long goal paragraphs wrap
              cleanly without fighting a narrow side column. */}
          <Card data-testid="admin-onboarding-questionnaire-card">
            <CardHeader>
              <CardTitle className="inline-flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Student questionnaire
              </CardTitle>
              <CardDescription>
                {/* Three states: still loading, no submission yet
                    (null), or a real submission with a `submittedAt`
                    timestamp. The user's request ("admins should
                    be able to see this so we can facilitate things")
                    needs every state to render gracefully — a
                    spinner is honest while fetching, a "Not yet
                    submitted" panel makes it obvious the student
                    hasn't reached submit, and the populated card
                    is the actual payload. */}
                {questionnaire.isLoading ? (
                  <span className="inline-flex items-center gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Loading student responses…
                  </span>
                ) : questionnaire.data ? (
                  <>
                    Submitted{" "}
                    {formatDateTime(questionnaire.data.submission.submittedAt)}
                    {" · "}
                    v{questionnaire.data.submission.questionnaireVersion}
                  </>
                ) : (
                  <>Not yet submitted by the student.</>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {questionnaire.isLoading ? (
                <div className="flex justify-center py-4">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : !questionnaire.data ? (
                <p className="text-sm text-muted-foreground">
                  The student has signed up but hasn&apos;t completed their
                  questionnaire yet. The assigned instructor will receive
                  a notification when it&apos;s in.
                </p>
              ) : (
                <div className="space-y-6">
                  <div className="space-y-4">
                    {questionnaire.data.submission.answers.map((a) => (
                      <div key={a.questionId} className="space-y-1">
                        <p className="text-sm font-medium">
                          {/* `questionText` is stored alongside each
                              answer so historical wording still
                              reads correctly if the question text
                              changes later; fall back to the canonical
                              lib-onboarding-questions label for any
                              row where the stored text is empty. */}
                          {a.questionText ||
                            getOnboardingQuestionLabel(a.questionId)}
                        </p>
                        {/* Reuse the shared <Linkify> helper (also
                            used by the staff branch in
                            `/onboarding/[id]`). Students routinely
                            paste URLs into the goals and
                            inspirations free-text slots, and a
                            reviewer who can click straight through
                            to a portfolio / social link is doing
                            the kind of prep that makes the first
                            call useful. */}
                        {a.answerText ? (
                          <Linkify
                            text={a.answerText}
                            className="text-sm text-muted-foreground whitespace-pre-wrap"
                          />
                        ) : (
                          <p className="text-sm text-muted-foreground italic">
                            No answer
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                  <div>
                    <p className="mb-2 text-sm font-medium">Inspirations</p>
                    {questionnaire.data.submission.inspirations.length > 0 ? (
                      <ul className="list-disc pl-5 text-sm text-muted-foreground">
                        {questionnaire.data.submission.inspirations.map(
                          (i, idx) => (
                            <li key={idx}>
                              <Linkify text={i.name} />
                            </li>
                          )
                        )}
                      </ul>
                    ) : (
                      <p className="text-sm text-muted-foreground italic">
                        No inspirations listed.
                      </p>
                    )}
                  </div>
                  {/* Work examples: render via the shared
                      client-side <WorkExampleThumb> component (also
                      used by the student questionnaire form's
                      upload grid). Each tile mints its own
                      short-lived signed GET URL through the auth-
                      gated
                      `/api/onboarding/[id]/work-examples/[exampleId]/download-url`
                      route, so the auth gate re-checks on every
                      render. Pending in-flight uploads are
                      intentionally hidden — they don't have a
                      usable B2 object yet and would render as
                      "(image)" placeholders. */}
                  <div className="space-y-2">
                    <p className="text-sm font-medium">
                      Work examples
                      {activeWorkExamples.length > 0 ? (
                        <span className="text-muted-foreground font-normal">
                          {" "}
                          ({activeWorkExamples.length})
                        </span>
                      ) : null}
                    </p>
                    {activeWorkExamples.length > 0 ? (
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                        {activeWorkExamples.map((w) => (
                          <div
                            key={w._id}
                            className="relative aspect-square overflow-hidden rounded-md border bg-muted"
                          >
                            <WorkExampleThumb
                              onboardingId={data._id}
                              workExampleId={w._id}
                              fileName={w.fileName}
                            />
                            <div className="absolute inset-x-0 bottom-0 bg-background/80 px-2 py-1 text-xs">
                              <span className="line-clamp-1">{w.fileName}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground italic">
                        No work examples attached.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Timeline full-width at the bottom. Long, audit-style
              list, so it earns the full row by itself rather than
              sitting next to a short card. */}
          <Card data-testid="admin-onboarding-timeline-card">
            <CardHeader>
              <CardTitle>Timeline</CardTitle>
              <CardDescription>
                {data.timeline.length} event
                {data.timeline.length === 1 ? "" : "s"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ol className="space-y-2">
                {[...data.timeline].reverse().map((entry, idx) => (
                  <li
                    key={`${entry.at}-${idx}`}
                    className="flex items-start gap-3 border-b pb-2 last:border-b-0"
                  >
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {formatDateTime(entry.at)}
                    </span>
                    <span className="text-sm">
                      {timelineEventLabel(entry.event)}
                      {entry.details ? (
                        <span className="text-muted-foreground"> — {entry.details}</span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
