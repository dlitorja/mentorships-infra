import { Suspense } from "react";
import { requireRole, getConvexAuthToken } from "@/lib/auth-helpers";
import { api } from "@/convex/_generated/api";
import { fetchQuery } from "convex/nextjs";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { ProtectedLayout } from "@/components/navigation/protected-layout";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { InstructorDashboardContent } from "./InstructorDashboardContent";

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

        <ErrorBoundary fallback={
          <Card>
            <CardContent className="pt-6">
              <div className="text-center space-y-4">
                <p className="text-muted-foreground">Unable to load students right now.</p>
                <Button variant="outline" onClick={() => window.location.reload()}>
                  Retry
                </Button>
              </div>
            </CardContent>
          </Card>
        }>
          <Suspense fallback={<InstructorDashboardSkeleton />}>
            <InstructorDashboardContent instructorId={instructorRecord._id} />
          </Suspense>
        </ErrorBoundary>
      </div>
    </ProtectedLayout>
  );
}
