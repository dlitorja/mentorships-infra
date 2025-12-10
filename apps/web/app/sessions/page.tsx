import { requireDbUser } from "@/lib/auth";
import { db } from "@mentorships/db";
import { sessions, sessionPacks, mentors, users } from "@mentorships/db";
import { eq, desc } from "drizzle-orm";
import { ProtectedLayout } from "@/components/navigation/protected-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default async function SessionsPage() {
  const user = await requireDbUser();

  // Fetch user's sessions with related data
  const userSessions = await db
    .select({
      id: sessions.id,
      scheduledAt: sessions.scheduledAt,
      completedAt: sessions.completedAt,
      canceledAt: sessions.canceledAt,
      status: sessions.status,
      recordingUrl: sessions.recordingUrl,
      notes: sessions.notes,
      mentorEmail: users.email,
      packId: sessions.sessionPackId,
      remainingSessions: sessionPacks.remainingSessions,
    })
    .from(sessions)
    .innerJoin(sessionPacks, eq(sessions.sessionPackId, sessionPacks.id))
    .innerJoin(mentors, eq(sessions.mentorId, mentors.id))
    .innerJoin(users, eq(mentors.userId, users.id))
    .where(eq(sessions.studentId, user.id))
    .orderBy(desc(sessions.scheduledAt))
    .limit(50);

  const getStatusBadgeVariant = (status: string) => {
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
  };

  return (
    <ProtectedLayout currentPath="/sessions">
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">My Sessions</h2>
          <p className="text-muted-foreground">
            View and manage your mentorship sessions
          </p>
        </div>

        {userSessions.length === 0 ? (
          <Card>
            <CardContent className="pt-6">
              <p className="text-center text-muted-foreground">
                You don't have any sessions yet. Book your first session through the calendar!
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {userSessions.map((session) => (
              <Card key={session.id}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-xl">{session.mentorEmail}</CardTitle>
                      <CardDescription>
                        {new Date(session.scheduledAt).toLocaleString("en-US", {
                          weekday: "long",
                          year: "numeric",
                          month: "long",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </CardDescription>
                    </div>
                    <Badge variant={getStatusBadgeVariant(session.status)}>
                      {session.status}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {session.remainingSessions !== null && (
                      <p className="text-sm text-muted-foreground">
                        Remaining sessions in pack: {session.remainingSessions}
                      </p>
                    )}
                    {session.completedAt && (
                      <p className="text-sm text-muted-foreground">
                        Completed: {new Date(session.completedAt).toLocaleString()}
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
                        <p className="text-sm text-muted-foreground">{session.notes}</p>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </ProtectedLayout>
  );
}

