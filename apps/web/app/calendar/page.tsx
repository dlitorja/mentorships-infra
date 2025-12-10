import { requireDbUser } from "@/lib/auth";
import { db, sessions, sessionPacks, eq, and, gte } from "@mentorships/db";
import { ProtectedLayout } from "@/components/navigation/protected-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default async function CalendarPage() {
  const user = await requireDbUser();

  // Fetch upcoming sessions
  const now = new Date();
  const upcomingSessions = await db
    .select({
      id: sessions.id,
      scheduledAt: sessions.scheduledAt,
      status: sessions.status,
      packId: sessions.sessionPackId,
      remainingSessions: sessionPacks.remainingSessions,
    })
    .from(sessions)
    .innerJoin(sessionPacks, eq(sessions.sessionPackId, sessionPacks.id))
    .where(
      and(
        eq(sessions.studentId, user.id),
        eq(sessions.status, "scheduled"),
        gte(sessions.scheduledAt, now)
      )
    )
    .orderBy(sessions.scheduledAt)
    .limit(10);

  // Fetch active session packs with remaining sessions
  const activePacks = await db
    .select({
      id: sessionPacks.id,
      remainingSessions: sessionPacks.remainingSessions,
      expiresAt: sessionPacks.expiresAt,
      status: sessionPacks.status,
    })
    .from(sessionPacks)
    .where(
      and(
        eq(sessionPacks.userId, user.id),
        eq(sessionPacks.status, "active")
      )
    );

  return (
    <ProtectedLayout currentPath="/calendar">
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Calendar</h2>
          <p className="text-muted-foreground">
            View upcoming sessions and book new ones
          </p>
        </div>

        {/* Active Session Packs */}
        {activePacks.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Active Session Packs</CardTitle>
              <CardDescription>Your available session packs</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {activePacks.map((pack) => (
                  <div
                    key={pack.id}
                    className="flex items-center justify-between p-4 border rounded-lg"
                  >
                    <div>
                      <p className="font-medium">
                        {pack.remainingSessions} session{pack.remainingSessions !== 1 ? "s" : ""} remaining
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Expires: {new Date(pack.expiresAt).toLocaleDateString()}
                      </p>
                    </div>
                    <Button disabled={pack.remainingSessions === 0}>
                      Book Session
                    </Button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Upcoming Sessions */}
        <Card>
          <CardHeader>
            <CardTitle>Upcoming Sessions</CardTitle>
            <CardDescription>Your scheduled mentorship sessions</CardDescription>
          </CardHeader>
          <CardContent>
            {upcomingSessions.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                No upcoming sessions scheduled. Book your first session!
              </p>
            ) : (
              <div className="space-y-4">
                {upcomingSessions.map((session) => (
                  <div
                    key={session.id}
                    className="flex items-center justify-between p-4 border rounded-lg"
                  >
                    <div>
                      <p className="font-medium">
                        {new Date(session.scheduledAt).toLocaleString("en-US", {
                          weekday: "long",
                          month: "long",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Status: {session.status}
                      </p>
                    </div>
                    <Button variant="outline">View Details</Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Booking Interface Placeholder */}
        {activePacks.length === 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Get Started</CardTitle>
              <CardDescription>Purchase a session pack to book sessions</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild>
                <a href="/pricing">View Pricing</a>
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </ProtectedLayout>
  );
}

