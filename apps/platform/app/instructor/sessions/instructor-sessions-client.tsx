"use client";

import { useInstructorAllSessions } from "@/lib/queries/convex/use-sessions";
import { SessionsListClient } from "./sessions-list-client";

const SESSIONS_PAGE_SIZE = 20;

export function InstructorSessionsClient({
  instructorId,
}: {
  instructorId: string;
}) {
  const {
    results: sessions,
    status: sessionsStatus,
    loadMore,
  } = useInstructorAllSessions(instructorId);

  const isLoading = sessionsStatus === "LoadingFirstPage";
  const canLoadMore =
    sessionsStatus === "CanLoadMore" || sessionsStatus === "LoadingMore";

  return (
    <div className="space-y-6">
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
  );
}
