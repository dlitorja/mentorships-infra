import { requireRole, getConvexAuthToken } from "@/lib/auth-helpers";
import { ProtectedLayout } from "@/components/navigation/protected-layout";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import Image from "next/image";
import { EnsureInstructorRole } from "@/components/instructor/ensure-instructor-role";
import { api } from "@/convex/_generated/api";
import { fetchQuery } from "convex/nextjs";
import {
  createSupabaseAdminClient,
  ONBOARDING_BUCKET,
} from "@/lib/supabase-admin";
import type { Id } from "@/convex/_generated/dataModel";

export const dynamic = "force-dynamic";

/** Legacy image object stored in Supabase. */
type LegacyImageObject = { path: string };

/** Raw image value as stored in older imageObjects arrays. */
type LegacyImageValue = LegacyImageObject | string;

/** Shape of imageObjects stored on legacy onboarding submissions. */
type SubmissionImageObjects = LegacyImageValue[] | undefined;

type ReviewTab = "unreviewed" | "reviewed";

type LegacySubmission = {
  _id: Id<"studentOnboardingSubmissions">;
  legacyId: string | undefined;
  goals: string;
  imageObjects: SubmissionImageObjects;
  imageStorageIds: (Id<"_storage"> | string)[] | undefined;
  createdAt: number | undefined;
  reviewedAt: number | undefined;
  userId: string;
  studentEmail: string;
};

type SubmittedQuestionnaire = {
  onboardingId: Id<"adminOnboardings">;
  studentEmail: string;
  submittedAt: number;
  instructorCount: number;
  reviewedAt: number | null;
  reviewedByUserId: string | null;
  studentTimezone: string | null;
};

/**
 * One row in the instructor review inbox. Both onboarding sources
 * (the legacy `studentOnboardingSubmissions` table and the newer
 * questionnaire flow) normalize into this shape so the page can sort
 * and bucket them into Reviewed / Unreviewed without special cases.
 */
type InboxRow = {
  key: string;
  kind: "questionnaire" | "legacy";
  studentLabel: string;
  submittedAt: number;
  reviewedAt: number | null;
  /** Where "Open" navigates. */
  href: string;
  instructorCount?: number;
  legacyId?: string;
  onboardingId?: Id<"adminOnboardings">;
  studentTimezone?: string | null;
};

type PageProps = {
  searchParams: Promise<{ submissionId?: string; tab?: string }>;
};

function formatDateTime(epochMs: number | null | undefined): string {
  if (!epochMs) return "—";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(epochMs));
}

function parseTab(raw: string | undefined): ReviewTab {
  return raw === "reviewed" ? "reviewed" : "unreviewed";
}

/**
 * Instructor submissions page for reviewing student onboarding
 * submissions.
 *
 * The page is the instructor-side inbox for BOTH onboarding sources:
 *
 *   1. Legacy `studentOnboardingSubmissions` rows (goals + uploaded
 *      artwork), reviewed through `/api/instructor/onboarding/review`.
 *   2. Newer questionnaire submissions, reviewed through
 *      `/api/instructor/onboarding/review-questionnaire`.
 *
 * Rows are categorized into "Unreviewed" and "Reviewed" tabs so an
 * instructor can see everything submitted by their students in one
 * place — previously the only entry point was the legacy upload list
 * and the questionnaire card was buried below it (and reachable only
 * if you knew the URL).
 *
 * Profile, scheduling, and calendar integration remain under
 * /instructor/profile and /instructor/availability.
 */
export default async function InstructorOnboardingPage({ searchParams }: PageProps) {
  const user = await requireRole("instructor");
  const token = await getConvexAuthToken();
  if (!token) {
    return (
      <ProtectedLayout currentPath="/instructor/onboarding">
        {/* Silent role sync for Convex */}
        <EnsureInstructorRole />
        <Card>
          <CardContent className="pt-6">
            <p className="text-center text-muted-foreground">
              Authentication required.
            </p>
          </CardContent>
        </Card>
      </ProtectedLayout>
    );
  }

  const convexInstructor = await fetchQuery(
    api.instructors.getInstructorByUserId,
    { userId: user.id },
    { token }
  );

  if (!convexInstructor) {
    return (
      <ProtectedLayout currentPath="/instructor/onboarding">
        {/* Silent role sync for Convex */}
        <EnsureInstructorRole />
        <Card>
          <CardContent className="pt-6">
            <p className="text-center text-muted-foreground">
              Instructor profile not found. Please contact support.
            </p>
          </CardContent>
        </Card>
      </ProtectedLayout>
    );
  }

  const { submissionId, tab: rawTab } = await searchParams;
  const tab = parseTab(rawTab);

  const submissions: LegacySubmission[] = await fetchQuery(
    api.studentOnboarding.listByInstructor,
    {
      instructorId: convexInstructor._id,
    },
    { token }
  );

  // Server-side list of submitted questionnaires for this instructor.
  // The Convex query paginates one page per call, so loop with the
  // returned cursor until done or the row cap is reached. Newest
  // submissions sort first, so the cap only affects very old history.
  const submittedQuestionnaires: SubmittedQuestionnaire[] = [];
  try {
    let cursor: string | null = null;
    const ROW_CAP = 200;
    const PAGE_CAP = 10;
    for (
      let i = 0;
      i < PAGE_CAP && submittedQuestionnaires.length < ROW_CAP;
      i += 1
    ) {
      const page = (await fetchQuery(
        api.onboardingQuestionnaire.listSubmittedQuestionnairesForInstructor,
        { cursor },
        { token }
      )) as {
        rows: SubmittedQuestionnaire[];
        nextCursor: string | null;
        isDone: boolean;
      };
      submittedQuestionnaires.push(...page.rows);
      if (page.isDone) break;
      cursor = page.nextCursor;
    }
    if (submittedQuestionnaires.length > ROW_CAP) {
      submittedQuestionnaires.length = ROW_CAP;
    }
  } catch {
    // Degrade gracefully — an older Convex deployment without the
    // review fields still renders the legacy submissions list.
  }

  const selected =
    (submissionId
      ? submissions.find(
          (s) => s.legacyId === submissionId || s._id === submissionId
        )
      : null) ?? null;

  const signedUrls: Array<{
    storageId?: string;
    path?: string;
    signedUrl: string;
  }> = await (async () => {
    if (!selected) return [];

    // Prefer Convex Storage; only fall back to Supabase for legacy submissions
    // that have not been migrated yet.
    if (selected.imageStorageIds && selected.imageStorageIds.length > 0) {
      const urls = await fetchQuery(
        api.studentOnboarding.getSignedUrls,
        { submissionId: selected._id },
        { token }
      );
      return urls.map((u) => ({
        storageId: u.storageId,
        signedUrl: u.signedUrl,
      }));
    }

    const imageObjects = selected.imageObjects;
    if (!Array.isArray(imageObjects) || imageObjects.length === 0) return [];

    const supabase = createSupabaseAdminClient();
    const out: Array<{ storageId?: string; path: string; signedUrl: string }> =
      [];

    for (const img of imageObjects) {
      const path =
        typeof img === "object" && img !== null && "path" in img
          ? (img as { path: string }).path
          : String(img);
      const { data, error } = await supabase.storage
        .from(ONBOARDING_BUCKET)
        .createSignedUrl(path, 60 * 60);
      if (error || !data?.signedUrl) continue;
      out.push({ path, signedUrl: data.signedUrl });
    }

    return out;
  })();

  const legacyRows: InboxRow[] = submissions.map((s) => {
    const id = s.legacyId ?? s._id;
    return {
      key: `legacy:${s._id}`,
      kind: "legacy",
      studentLabel: s.studentEmail,
      submittedAt: s.createdAt ?? 0,
      reviewedAt: s.reviewedAt ?? null,
      href: `/instructor/onboarding?tab=${tab}&submissionId=${encodeURIComponent(id)}`,
      legacyId: s.legacyId,
    };
  });

  const questionnaireRows: InboxRow[] = submittedQuestionnaires.map((q) => ({
    key: `questionnaire:${q.onboardingId}`,
    kind: "questionnaire",
    studentLabel: q.studentEmail,
    submittedAt: q.submittedAt,
    reviewedAt: q.reviewedAt,
    href: `/onboarding/${q.onboardingId}`,
    instructorCount: q.instructorCount,
    onboardingId: q.onboardingId,
    studentTimezone: q.studentTimezone,
  }));

  const allRows = [...legacyRows, ...questionnaireRows].sort(
    (a, b) => b.submittedAt - a.submittedAt
  );
  const unreviewedRows = allRows.filter((row) => row.reviewedAt === null);
  const reviewedRows = allRows.filter((row) => row.reviewedAt !== null);
  const visibleRows = tab === "reviewed" ? reviewedRows : unreviewedRows;

  return (
    <ProtectedLayout currentPath="/instructor/onboarding">
      {/* Silent role sync for Convex */}
      <EnsureInstructorRole />
      <div className="container mx-auto p-4 md:p-8 space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Student Onboardings</h1>
          <p className="text-muted-foreground mt-1">
            Review questionnaire answers and artwork students submitted
            before their sessions. Rows are grouped by review state.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Instructor Setup</CardTitle>
            <CardDescription>
              Update your profile, availability, and calendar connection in one place.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <Button variant="outline" asChild>
              <Link href="/instructor/profile">Edit Profile</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/instructor/availability">Set Availability</Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="gap-3">
            <div>
              <CardTitle>Review inbox</CardTitle>
              <CardDescription>
                Unreviewed first, then previously reviewed submissions.
              </CardDescription>
            </div>
            <div
              className="flex flex-wrap gap-2"
              role="tablist"
              aria-label="Filter onboardings by review state"
            >
              <Button
                asChild
                size="sm"
                variant={tab === "unreviewed" ? "default" : "outline"}
              >
                <Link href="/instructor/onboarding?tab=unreviewed" role="tab" aria-selected={tab === "unreviewed"}>
                  Unreviewed
                  <Badge variant="secondary" className="ml-2">
                    {unreviewedRows.length}
                  </Badge>
                </Link>
              </Button>
              <Button
                asChild
                size="sm"
                variant={tab === "reviewed" ? "default" : "outline"}
              >
                <Link href="/instructor/onboarding?tab=reviewed" role="tab" aria-selected={tab === "reviewed"}>
                  Reviewed
                  <Badge variant="secondary" className="ml-2">
                    {reviewedRows.length}
                  </Badge>
                </Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {visibleRows.length === 0 ? (
              <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
                {tab === "reviewed"
                  ? "No reviewed onboardings yet."
                  : "No unreviewed onboardings — you're all caught up."}
              </div>
            ) : (
              <ul className="divide-y rounded-lg border">
                {visibleRows.map((row) => (
                  <li
                    key={row.key}
                    className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium break-all">
                          {row.studentLabel}
                        </span>
                        <Badge variant="outline">
                          {row.kind === "questionnaire"
                            ? "Questionnaire"
                            : "Artwork upload"}
                        </Badge>
                        {row.kind === "questionnaire" &&
                          row.instructorCount !== undefined && (
                            <span className="text-xs text-muted-foreground">
                              {row.instructorCount} instructor
                              {row.instructorCount === 1 ? "" : "s"}
                            </span>
                          )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Submitted {formatDateTime(row.submittedAt)}
                        {row.reviewedAt !== null && (
                          <> · Reviewed {formatDateTime(row.reviewedAt)}</>
                        )}
                      </p>
                      {row.kind === "questionnaire" && (
                        <p className="text-xs text-muted-foreground">
                          Timezone:{" "}
                          <span className="font-medium text-foreground">
                            {row.studentTimezone ?? "Not set"}
                          </span>
                        </p>
                      )}
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      {row.kind === "questionnaire" &&
                        row.onboardingId !== undefined &&
                        (row.reviewedAt === null ? (
                          <form
                            action="/api/instructor/onboarding/review-questionnaire"
                            method="post"
                          >
                            <input
                              type="hidden"
                              name="onboardingId"
                              value={row.onboardingId}
                            />
                            <input
                              type="hidden"
                              name="reviewed"
                              value="true"
                            />
                            <input type="hidden" name="returnTab" value={tab} />
                            <Button type="submit" size="sm">
                              Mark reviewed
                            </Button>
                          </form>
                        ) : (
                          <form
                            action="/api/instructor/onboarding/review-questionnaire"
                            method="post"
                          >
                            <input
                              type="hidden"
                              name="onboardingId"
                              value={row.onboardingId}
                            />
                            <input
                              type="hidden"
                              name="reviewed"
                              value="false"
                            />
                            <input type="hidden" name="returnTab" value={tab} />
                            <Button type="submit" size="sm" variant="outline">
                              Mark unreviewed
                            </Button>
                          </form>
                        ))}
                      <Button asChild size="sm" variant="outline">
                        <Link href={row.href}>Open</Link>
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {selected && (
          <Card>
            <CardHeader>
              <CardTitle>Artwork details</CardTitle>
              <CardDescription>
                From {selected.studentEmail} · submitted{" "}
                {formatDateTime(selected.createdAt)}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="text-sm font-medium">Goals</div>
                <div className="whitespace-pre-wrap text-sm text-muted-foreground">
                  {selected.goals}
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-sm font-medium">Images</div>
                {signedUrls.length === 0 ? (
                  <div className="text-sm text-muted-foreground">
                    No images (or signing not configured).
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    {signedUrls.map((u) => (
                      <div
                        key={u.storageId ?? u.path}
                        className="relative w-full aspect-square rounded-md border overflow-hidden"
                      >
                        <Image
                          src={u.signedUrl}
                          alt="Onboarding work"
                          fill
                          unoptimized
                          sizes="(max-width: 768px) 50vw, 25vw"
                          className="object-cover"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {selected.legacyId ? (
                <form action="/api/instructor/onboarding/review" method="post">
                  <input
                    type="hidden"
                    name="submissionId"
                    value={selected.legacyId}
                  />
                  <Button type="submit" disabled={Boolean(selected.reviewedAt)}>
                    {selected.reviewedAt ? "Reviewed" : "Mark reviewed"}
                  </Button>
                  {selected.reviewedAt && (
                    <p className="text-sm text-muted-foreground mt-2">
                      Reviewed on{" "}
                      {new Date(selected.reviewedAt).toLocaleDateString()}
                    </p>
                  )}
                </form>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Legacy ID not available for this submission.
                </p>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </ProtectedLayout>
  );
}
