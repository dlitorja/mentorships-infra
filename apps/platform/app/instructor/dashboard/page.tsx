import { Suspense } from "react";
import { requireRole, getConvexAuthToken } from "@/lib/auth-helpers";
import { api } from "@/convex/_generated/api";
import { fetchQuery } from "convex/nextjs";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { ProtectedLayout } from "@/components/navigation/protected-layout";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { InstructorDashboardContent } from "./InstructorDashboardContent";
import { ArchivedMentorshipsCard } from "./ArchivedMentorshipsCard";
import { RetryButton } from "./retry-button";

function InstructorDashboardSkeleton() {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * PR archive-gating: thin suspense fallback for the
 * ArchivedMentorshipsCard. Mirrors `InstructorDashboardSkeleton`
 * (Loader2 spinner inside a Card) so the two cards load in
 * parallel without one rendering empty while the other waits for
 * its query.
 */
function ArchivedMentorshipsSkeleton() {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * PR archive-gating: separate ErrorBoundary for the archived card so a
 * transient query failure on `getInstructorArchivedMentorships` does
 * not collapse the active list — they suspend / error independently.
 */
function ArchivedMentorshipsFallback() {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-center space-y-4">
          <p className="text-muted-foreground">
            Unable to load archived mentorships right now.
          </p>
          <RetryButton />
        </div>
      </CardContent>
    </Card>
  );
}

/** Instructor dashboard focused on active students and remaining session counts. */
export default async function InstructorDashboardPage() {
  const user = await requireRole("instructor");
  const token = await getConvexAuthToken();
  const instructorRecord = await fetchQuery(
    api.instructors.getInstructorByUserId,
    { userId: user.id },
    { token: token ?? undefined }
  );

  if (!instructorRecord) {
    return (
      <ProtectedLayout currentPath="/instructor/dashboard">
        <div className="container mx-auto p-4 md:p-8">
          <Card>
            <CardContent className="pt-6">
              <p className="text-center text-muted-foreground">
                Instructor profile not found. Please contact support.
              </p>
            </CardContent>
          </Card>
        </div>
      </ProtectedLayout>
    );
  }

  return (
    <ProtectedLayout currentPath="/instructor/dashboard">
      <div className="container mx-auto p-4 md:p-8 space-y-6">
        <div className="mb-8">
          <h1 className="text-3xl font-bold">Instructor Dashboard</h1>
          <p className="text-muted-foreground mt-1">
            Welcome back, {instructorRecord.name || "Instructor"}
          </p>
        </div>

        {/*
         * PR archive-gating: two cards in a responsive grid. On
         * mobile (default grid-cols-1) the cards stack so the
         * active list — the primary affordance — gets the full
         * viewport width; on md+ they sit side-by-side for
         * comparison. Both cards suspend + error independently
         * so a transient hickup on one doesn't blank the other.
         */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <ErrorBoundary fallback={
            <Card>
              <CardContent className="pt-6">
                <div className="text-center space-y-4">
                  <p className="text-muted-foreground">Unable to load students right now.</p>
                  <RetryButton />
                </div>
              </CardContent>
            </Card>
          }>
            <Suspense fallback={<InstructorDashboardSkeleton />}>
              <InstructorDashboardContent instructorId={instructorRecord._id} />
            </Suspense>
          </ErrorBoundary>

          <ErrorBoundary fallback={<ArchivedMentorshipsFallback />}>
            <Suspense fallback={<ArchivedMentorshipsSkeleton />}>
              <ArchivedMentorshipsCard instructorId={instructorRecord._id} />
            </Suspense>
          </ErrorBoundary>
        </div>
      </div>
    </ProtectedLayout>
  );
}
