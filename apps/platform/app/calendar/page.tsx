export const dynamic = "force-dynamic";

import { requireAuth } from "@/lib/auth";
import { getConvexAuthToken } from "@/lib/auth-helpers";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { ProtectedLayout } from "@/components/navigation/protected-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BookSessionForm } from "@/components/calendar/book-session-form";
import Link from "next/link";
import { BookWithGoogle } from "@/components/calendar/book-with-google";

export default async function CalendarPage() {
  const userId = await requireAuth();
  const token = await getConvexAuthToken();
  const tokenOption = { token: token ?? undefined };
  const convexUser = await fetchQuery(api.users.getCurrentUser, {}, tokenOption);
  const userTimeZone = convexUser?.timeZone;

  if (!userTimeZone) {
    return (
      <ProtectedLayout currentPath="/calendar">
        <div className="container mx-auto p-4 md:p-8">
          <Card>
            <CardHeader>
              <CardTitle>Set Your Timezone</CardTitle>
              <CardDescription>
                Please set your timezone in settings before booking sessions.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild>
                <Link href="/settings">Go to Settings</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </ProtectedLayout>
    );
  }

  // Fetch upcoming sessions from Convex
  const upcomingSessionsRaw = await fetchQuery(
    api.sessions.getUpcomingSessions,
    { studentId: userId },
    tokenOption
  );
  const upcomingSessions = upcomingSessionsRaw.map((session) => ({
    id: session._id,
    scheduledAt: new Date(session.scheduledAt),
    status: session.status,
    packId: session.sessionPackId,
    workspaceId: session.workspaceId,
  }));

  // Fetch active session packs with remaining sessions from Convex
  const activePacksRaw = await fetchQuery(
    api.sessionPacks.getUserActiveSessionPacks,
    { userId },
    tokenOption
  );
  const activePacks = activePacksRaw.map((p) => ({
    id: p._id as Id<"sessionPacks">,
    instructorId: p.instructorId as Id<"instructors">,
    remainingSessions: p.remainingSessions,
    expiresAt: p.expiresAt ? new Date(p.expiresAt) : null,
    status: p.status,
  }));

  return (
    <ProtectedLayout currentPath="/calendar">
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Calendar</h2>
          <p className="text-muted-foreground">View upcoming sessions and book new ones</p>
          <div className="mt-2 text-xs flex items-start gap-2 rounded-md border p-2 bg-muted/50">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mt-0.5 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M12 16v-4"></path><path d="M12 8h.01"></path></svg>
            <p>
              Need to cancel or reschedule? Contact your instructor in your workspace. Please try to inform them at least 24 hours in advance; instructors handle changes requested with less than 24 hours&apos; notice at their discretion. <Link href="/workspace" className="underline">Open workspace</Link>
            </p>
          </div>
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
                        {pack.expiresAt
                          ? `Expires: ${pack.expiresAt.toLocaleDateString()}`
                          : "No expiration"}
                      </p>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Choose a time slot below.
                    </p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Booking (Legacy Packs) */}
        {activePacks.length > 0 && <BookSessionForm packs={activePacks} userId={userId} />}

        {/* Booking (Google Calendar MVP) - uses the first active pack&apos;s instructor */}
        {activePacks.length > 0 && (
          <BookWithGoogle packs={activePacks.map((p) => ({ id: p.id, instructorId: p.instructorId }))} />
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
                    <Button variant="outline" asChild>
                      <Link href={session.workspaceId ? `/workspace/${session.workspaceId}` : "/sessions"}>
                        View Details
                      </Link>
                    </Button>
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
                <Link href="/instructors">Browse Instructors</Link>
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </ProtectedLayout>
  );
}
