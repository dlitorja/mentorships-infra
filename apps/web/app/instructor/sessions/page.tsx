import { requireRole } from "@/lib/auth-helpers";
import {
  getMentorByUserId,
  getMentorSessions,
} from "@mentorships/db";
import { ProtectedLayout } from "@/components/navigation/protected-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

function formatDateTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function getStatusBadgeVariant(status: string) {
  switch (status) {
    case "completed":
      return "default";
    case "scheduled":
      return "secondary";
    case "canceled":
      return "destructive";
    case "no_show":
      return "outline";
    default:
      return "outline";
  }
}

export default async function InstructorSessionsPage() {
  const user = await requireRole("mentor");
  const mentor = await getMentorByUserId(user.id);

  if (!mentor) {
    return (
      <ProtectedLayout currentPath="/instructor/sessions">
        <div className="container mx-auto p-4 md:p-8">
          <Card>
            <CardContent className="pt-6">
              <p className="text-center text-muted-foreground">
                Mentor profile not found. Please contact support.
              </p>
            </CardContent>
          </Card>
        </div>
      </ProtectedLayout>
    );
  }

  const allSessions = await getMentorSessions(mentor.id, 100);

  // Separate sessions by status
  const upcomingSessions = allSessions.filter(
    (s) => s.status === "scheduled" && new Date(s.scheduledAt) >= new Date()
  );
  const pastSessions = allSessions.filter(
    (s) => s.status !== "scheduled" || new Date(s.scheduledAt) < new Date()
  );

  return (
    <ProtectedLayout currentPath="/instructor/sessions">
      <div className="container mx-auto p-4 md:p-8 space-y-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">All Sessions</h2>
          <p className="text-muted-foreground">
            View and manage all your mentorship sessions
          </p>
        </div>

        {/* Upcoming Sessions */}
        {upcomingSessions.length > 0 && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Upcoming Sessions</h3>
            <div className="grid gap-4">
              {upcomingSessions.map((session) => (
                <Card key={session.id}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-xl">
                          {session.student.email}
                        </CardTitle>
                        <CardDescription>
                          {formatDateTime(session.scheduledAt)}
                        </CardDescription>
                      </div>
                      <Badge variant={getStatusBadgeVariant(session.status)}>
                        {session.status}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      <p className="text-sm text-muted-foreground">
                        Remaining sessions in pack: {session.sessionPack.remainingSessions}
                      </p>
                      {session.notes && (
                        <div className="mt-2">
                          <p className="text-sm font-medium">Notes:</p>
                          <p className="text-sm text-muted-foreground">
                            {session.notes}
                          </p>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* Past Sessions */}
        {pastSessions.length > 0 && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Past Sessions</h3>
            <div className="grid gap-4">
              {pastSessions.map((session) => (
                <Card key={session.id}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-xl">
                          {session.student.email}
                        </CardTitle>
                        <CardDescription>
                          {formatDateTime(session.scheduledAt)}
                        </CardDescription>
                      </div>
                      <Badge variant={getStatusBadgeVariant(session.status)}>
                        {session.status}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {session.completedAt && (
                        <p className="text-sm text-muted-foreground">
                          Completed: {formatDateTime(session.completedAt)}
                        </p>
                      )}
                      {session.canceledAt && (
                        <p className="text-sm text-muted-foreground">
                          Canceled: {formatDateTime(session.canceledAt)}
                        </p>
                      )}
                      {session.recordingUrl && (
                        <a
                          href={session.recordingUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-primary hover:underline"
                        >
                          View Recording
                        </a>
                      )}
                      {session.notes && (
                        <div className="mt-2">
                          <p className="text-sm font-medium">Notes:</p>
                          <p className="text-sm text-muted-foreground">
                            {session.notes}
                          </p>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {allSessions.length === 0 && (
          <Card>
            <CardContent className="pt-6">
              <p className="text-center text-muted-foreground">
                You don't have any sessions yet.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </ProtectedLayout>
  );
}

