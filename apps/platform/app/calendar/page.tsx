"use client";

import { Suspense } from "react";
import { useUser } from "@clerk/nextjs";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BookSessionForm } from "@/components/calendar/book-session-form";
import { BookWithGoogle } from "@/components/calendar/book-with-google";
import { useActiveSessionPacksByUser } from "@/lib/queries/convex/use-session-packs";
import { useUpcomingStudentSessions } from "@/lib/queries/convex/use-sessions";
import { Loader2 } from "lucide-react";
import { useMemo } from "react";

function formatDateTime(date: number): string {
  return new Date(date).toLocaleString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function CalendarContent() {
  const { user, isLoaded } = useUser();
  const userId = user?.id;
  const userTimeZone = user?.publicMetadata?.timeZone as string | undefined;

  const { data: sessionPacks, isLoading: packsLoading } = useActiveSessionPacksByUser(userId || "");
  const { data: upcomingSessions, isLoading: sessionsLoading } = useUpcomingStudentSessions(userId || "");

  const activePacks = useMemo(() => {
    if (!sessionPacks) return [];
    return sessionPacks.map((p) => ({
      id: p._id,
      instructorId: p.instructorId,
      remainingSessions: p.remainingSessions,
      expiresAt: p.expiresAt ? new Date(p.expiresAt) : null,
      status: p.status,
    }));
  }, [sessionPacks]);

  if (!isLoaded) {
    return (
      <div className="container mx-auto p-4 md:p-8 flex justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="container mx-auto p-4 md:p-8 flex justify-center">
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle>Sign In Required</CardTitle>
            <CardDescription>
              Please sign in to view your calendar and book sessions.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/sign-in">Sign In</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!userTimeZone) {
    return (
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
    );
  }

  return (
    <div className="container mx-auto p-4 md:p-8 space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Calendar</h2>
        <p className="text-muted-foreground">View upcoming sessions and book new ones</p>
        <div className="mt-2 text-xs flex items-start gap-2 rounded-md border p-2 bg-muted/50">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mt-0.5 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M12 16v-4"></path><path d="M12 8h.01"></path></svg>
          <p>
            Need to cancel or reschedule? Contact your instructor in your workspace. Please try to inform them at least 24 hours in advance; instructors handle changes requested with less than 24 hours' notice at their discretion. <a href="/workspace" className="underline">Open workspace</a>
          </p>
        </div>
      </div>

      {packsLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      ) : (
        <>
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
                      <Button disabled={pack.remainingSessions === 0} variant="outline">
                        Select below
                      </Button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Booking (Legacy Packs) */}
          {activePacks.length > 0 && <BookSessionForm packs={activePacks} userId={user.id} />}

          {/* Booking (Google Calendar MVP) - uses the first active pack's instructor */}
          {activePacks.length > 0 && (
            <BookWithGoogle packs={activePacks.map((p) => ({ id: p.id, instructorId: p.instructorId }))} />
          )}
        </>
      )}

      {/* Upcoming Sessions */}
      <Card>
        <CardHeader>
          <CardTitle>Upcoming Sessions</CardTitle>
          <CardDescription>Your scheduled mentorship sessions</CardDescription>
        </CardHeader>
        <CardContent>
          {sessionsLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          ) : !upcomingSessions || upcomingSessions.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              No upcoming sessions scheduled. Book your first session!
            </p>
          ) : (
            <div className="space-y-4">
              {upcomingSessions.map((session) => (
                <div
                  key={session._id}
                  className="flex items-center justify-between p-4 border rounded-lg"
                >
                  <div>
                    <p className="font-medium">
                      {formatDateTime(session.scheduledAt)}
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
      {!packsLoading && activePacks.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Get Started</CardTitle>
            <CardDescription>Purchase a session pack to book sessions</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/pricing">View Pricing</Link>
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function CalendarPage() {
  return (
    <Suspense
      fallback={
        <div className="container mx-auto p-4 md:p-8 flex justify-center">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      }
    >
      <CalendarContent />
    </Suspense>
  );
}