"use client";

import { useCurrentInstructor } from "@/lib/queries/convex/use-instructors";
import { useInstructorAllSessions } from "@/lib/queries/convex/use-sessions";
import { ProtectedLayout } from "@/components/navigation/protected-layout";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { SessionsListClient } from "./sessions-list-client";

const SESSIONS_PAGE_SIZE = 20;

export default function InstructorSessionsPage() {
  const { data: instructor, isLoading: instructorLoading } = useCurrentInstructor();
  const {
    results: sessions,
    status: sessionsStatus,
    loadMore,
  } = useInstructorAllSessions(instructor?._id);

  const isLoading = instructorLoading || sessionsStatus === "LoadingFirstPage";
  const canLoadMore =
    sessionsStatus === "CanLoadMore" || sessionsStatus === "LoadingMore";

  if (instructorLoading) {
    return (
      <ProtectedLayout currentPath="/instructor/sessions">
        <div className="container mx-auto p-4 md:p-8 flex justify-center">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      </ProtectedLayout>
    );
  }

  if (!instructor) {
    return (
      <ProtectedLayout currentPath="/instructor/sessions">
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
    <ProtectedLayout currentPath="/instructor/sessions">
      <div className="container mx-auto p-4 md:p-8 space-y-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">All Sessions</h2>
          <p className="text-muted-foreground">
            View and manage all your mentorship sessions
          </p>
        </div>

        <SessionsListClient
          sessions={sessions ?? []}
          isLoading={isLoading}
          loadMore={loadMore}
          isDone={!canLoadMore}
          pageSize={SESSIONS_PAGE_SIZE}
        />
      </div>
    </ProtectedLayout>
  );
}
