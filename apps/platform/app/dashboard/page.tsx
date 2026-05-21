"use client";

import { useUser, UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar, Clock, User, BookOpen, CheckCircle2, Loader2 } from "lucide-react";
import { useActiveSessionPacksByUser, useUserTotalRemainingSessions } from "@/lib/queries/convex/use-session-packs";
import { useUpcomingStudentSessions } from "@/lib/queries/convex/use-sessions";
import { useInstructor } from "@/lib/queries/convex/use-instructors";
import { Id } from "@/convex/_generated/dataModel";
import { useMemo, Suspense, useEffect, useState } from "react";

function formatDate(date: number): string {
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateTime(date: number): string {
  return new Date(date).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function InstructorBadge({ instructorId }: { instructorId: string }) {
  const { data: instructor, isLoading } = useInstructor(instructorId);
  if (isLoading || !instructor) return null;
  return (
    <div>
      <span className="font-medium">{instructor.name}</span>
      {instructor.bio && (
        <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
          {instructor.bio}
        </p>
      )}
    </div>
  );
}

function SessionPackCard({ pack }: { pack: any }) {
  return (
    <div className="border rounded-lg p-4 space-y-2">
      <div className="flex items-start justify-between">
        <div>
          <InstructorBadge instructorId={pack.instructorId} />
        </div>
        <Badge variant="secondary">
          {pack.remainingSessions} left
        </Badge>
      </div>
      <div className="flex items-center gap-4 text-sm text-muted-foreground">
        <div className="flex items-center gap-1">
          <Calendar className="h-4 w-4" />
          <span>
            {pack.expiresAt
              ? `Expires ${formatDate(pack.expiresAt)}`
              : "No expiration"}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Clock className="h-4 w-4" />
          <span>
            {pack.totalSessions - pack.remainingSessions}/
            {pack.totalSessions} used
          </span>
        </div>
      </div>
      {pack.mentorshipType && (
        <div className="pt-2">
          <Link
            href={`/workspace/${pack._id}`}
            className="text-sm text-primary hover:underline"
          >
            Open workspace →
          </Link>
        </div>
      )}
    </div>
  );
}

function UpcomingSessionCard({ session }: { session: any }) {
  return (
    <div className="border rounded-lg p-4 space-y-2">
      <div className="flex items-start justify-between">
        <div>
          <InstructorBadge instructorId={session.instructorId} />
          <p className="text-sm text-muted-foreground">
            {formatDateTime(session.scheduledAt)}
          </p>
        </div>
        <Badge variant="outline">Scheduled</Badge>
      </div>
      <div className="pt-2">
        <Link
          href={`/workspace/${session.sessionPackId}`}
          className="text-sm text-primary hover:underline"
        >
          Open workspace →
        </Link>
      </div>
    </div>
  );
}

function DashboardContent() {
  const { user, isLoaded } = useUser();
  const userId = user?.id;

  const { data: sessionPacks, isLoading: packsLoading } = useActiveSessionPacksByUser(userId || "");
  const { data: totalSessions } = useUserTotalRemainingSessions(userId || "");
  const { data: upcomingSessions, isLoading: sessionsLoading } = useUpcomingStudentSessions(userId || "");

  const sortedPacks = useMemo(() => {
    if (!sessionPacks) return [];
    return [...sessionPacks].sort((a, b) => b.purchasedAt - a.purchasedAt);
  }, [sessionPacks]);

  const uniqueInstructorCount = useMemo(() => {
    if (!sessionPacks) return 0;
    const uniqueIds = new Set((sessionPacks as Array<{instructorId: string}>).map(p => p.instructorId));
    return uniqueIds.size;
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
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  const [googleBookings, setGoogleBookings] = useState<Array<{ id: string; startUtc: number; endUtc: number; status: string; instructorId: string }>>([]);
  const [loadingGoogleBookings, setLoadingGoogleBookings] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoadingGoogleBookings(true);
      try {
        const res = await fetch("/api/bookings/me");
        const json = await res.json().catch(() => ({}));
        if (!cancelled && res.ok && json?.success) {
          setGoogleBookings(json.bookings || []);
        }
      } catch {}
      if (!cancelled) setLoadingGoogleBookings(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="container mx-auto p-4 md:p-8 space-y-6">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground mt-1">
            Welcome back, {user.emailAddresses[0]?.emailAddress}
          </p>
        </div>
        <UserButton />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Remaining Sessions
            </CardTitle>
            <BookOpen className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalSessions ?? 0}</div>
            <p className="text-xs text-muted-foreground">
              {(totalSessions ?? 0) === 1 ? "session" : "sessions"} available
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Packs</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{sortedPacks.length}</div>
            <p className="text-xs text-muted-foreground">
              {sortedPacks.length === 1 ? "pack" : "packs"} active
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Instructors</CardTitle>
            <User className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{uniqueInstructorCount}</div>
            <p className="text-xs text-muted-foreground">
              {uniqueInstructorCount === 1 ? "instructor" : "instructors"} assigned
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Next steps</CardTitle>
          <CardDescription>
            Browse instructors and start your mentorship journey.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Link className="text-primary hover:underline" href="/instructors">
            Browse instructors →
          </Link>
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Active Session Packs</CardTitle>
            <CardDescription>
              Your current mentorship packs and remaining sessions
            </CardDescription>
          </CardHeader>
          <CardContent>
            {packsLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin" />
              </div>
            ) : sortedPacks.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <BookOpen className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p className="mb-2">No active session packs</p>
                <Link
                  href="/instructors"
                  className="text-primary hover:underline"
                >
                  Browse instructors →
                </Link>
              </div>
            ) : (
              <div className="space-y-4">
                {sortedPacks.map((pack) => (
                  <SessionPackCard key={pack._id} pack={pack} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

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
              <div className="text-center py-8 text-muted-foreground">
                <Calendar className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p className="mb-2">No upcoming sessions</p>
                <Link
                  href="/instructors"
                  className="text-primary hover:underline"
                >
                  Schedule a session →
                </Link>
              </div>
            ) : (
              <div className="space-y-4">
                {(upcomingSessions as any[]).map((session: any) => (
                  <UpcomingSessionCard key={session._id} session={session} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Google Booked Sessions</CardTitle>
            <CardDescription>Bookings created via Google Calendar</CardDescription>
          </CardHeader>
          <CardContent>
            {loadingGoogleBookings ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin" />
              </div>
            ) : googleBookings.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Calendar className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No bookings yet</p>
              </div>
            ) : (
              <div className="space-y-4">
                {googleBookings.map((b) => {
                  const awaiting = b.status === "confirmed" && b.startUtc < Date.now();
                  return (
                    <div key={b.id} className="border rounded-lg p-4 flex items-center justify-between">
                      <div>
                        <p className="font-medium">{new Date(b.startUtc).toLocaleString()}</p>
                        {awaiting ? (
                          <p className="text-xs text-muted-foreground mt-1">Awaiting instructor confirmation</p>
                        ) : null}
                      </div>
                      <Badge variant={b.status === "completed" ? "default" : b.status === "canceled" ? "destructive" : "outline"}>
                        {b.status}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4">
            <Link
              href="/instructors"
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Browse Instructors
            </Link>
            {(totalSessions ?? 0) > 0 && (
              <Link
                href="/instructors"
                className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
              >
                Schedule Session
              </Link>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense
      fallback={
        <div className="container mx-auto p-4 md:p-8 flex justify-center">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      }
    >
      <DashboardContent />
    </Suspense>
  );
}
