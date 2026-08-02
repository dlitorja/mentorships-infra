"use client";

import { useUser } from "@clerk/nextjs";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar, Clock, User, BookOpen, CheckCircle2, Loader2, MessageCircle, Info, XCircle } from "lucide-react";
import { useActiveSessionPacksByUser, useUserTotalRemainingSessions } from "@/lib/queries/convex/use-session-packs";
import { useUpcomingStudentSessions } from "@/lib/queries/convex/use-sessions";
import { useInstructor, useInstructorByUserId } from "@/lib/queries/convex/use-instructors";
import { useEffect, useRef } from "react";
import { syncDiscordRole } from "@/lib/queries/api-client";
import {
  useGoogleBookings,
  useGoogleCalendarStatus,
  useInvalidateGoogleCalendarQueries,
} from "@/lib/queries/use-google-calendar";
import { Id } from "@/convex/_generated/dataModel";

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

function isOAuthCallback(): boolean {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  return params.get("google_calendar") === "connected";
}

interface SessionPackData {
  _id: Id<"sessionPacks">;
  instructorId: string;
  totalSessions: number;
  remainingSessions: number;
  expiresAt?: number;
  purchasedAt: number;
  mentorshipType?: string;
  workspaceId: string | null;
}

interface SessionData {
  _id: Id<"sessions">;
  instructorId: string;
  sessionPackId: string;
  scheduledAt: number;
  status: string;
  workspaceId: string | null;
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

function SessionPackCard({ pack }: { pack: SessionPackData }) {
  return (
    <div className="border rounded-lg p-4 space-y-2">
      <div className="flex items-start justify-between">
        <div>
          <InstructorBadge instructorId={pack.instructorId} />
        </div>
        <Badge variant="secondary">
          <BookOpen className="h-3 w-3 mr-1" aria-hidden="true" />
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
      {pack.mentorshipType && pack.workspaceId && (
        <div className="pt-2">
          <Link
            href={`/workspace/${pack.workspaceId}`}
            className="text-sm text-primary hover:underline"
          >
            Open workspace →
          </Link>
        </div>
      )}
    </div>
  );
}

function UpcomingSessionCard({ session }: { session: SessionData }) {
  return (
    <div className="border rounded-lg p-4 space-y-2">
      <div className="flex items-start justify-between">
        <div>
          <InstructorBadge instructorId={session.instructorId} />
          <p className="text-sm text-muted-foreground">
            {formatDateTime(session.scheduledAt)}
          </p>
        </div>
        <Badge variant="outline">
          <Clock className="h-3 w-3 mr-1" aria-hidden="true" />
          Scheduled
        </Badge>
      </div>
      {session.workspaceId && (
        <div className="pt-2">
          <Link
            href={`/workspace/${session.workspaceId}`}
            className="text-sm text-primary hover:underline"
          >
            Open workspace →
          </Link>
        </div>
      )}
    </div>
  );
}

export function DashboardContent() {
  const { user, isLoaded } = useUser();
  const userId = user?.id;

  const { data: instructorRecord } = useInstructorByUserId(userId || "");
  const isInstructorOrAdmin = Boolean(instructorRecord);

  const invalidateGoogleCalendar = useInvalidateGoogleCalendarQueries();

  const {
    data: googleCalendarStatus,
    isLoading: loadingGoogleCalendar,
  } = useGoogleCalendarStatus(isInstructorOrAdmin);

  const {
    data: googleBookings = [],
    isLoading: loadingGoogleBookings,
  } = useGoogleBookings(isInstructorOrAdmin);

  const googleCalendarConnected = googleCalendarStatus?.connected ?? false;

  const discordConnected = Boolean(
    user?.externalAccounts?.some((a) => a.provider?.toLowerCase?.().includes("discord"))
  );

  const { data: sessionPacks, isLoading: packsLoading } = useActiveSessionPacksByUser(userId || "");
  const { data: totalSessions } = useUserTotalRemainingSessions(userId || "");
  const { data: upcomingSessions, isLoading: sessionsLoading } = useUpcomingStudentSessions(userId || "");

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!isOAuthCallback()) return;
    const url = new URL(window.location.href);
    url.search = "";
    window.history.replaceState({}, "", url.toString());
    invalidateGoogleCalendar();
  }, [invalidateGoogleCalendar]);

  const discordSyncRef = useRef(false);

  useEffect(() => {
    if (!isLoaded || !userId) return;
    if (isInstructorOrAdmin) return;
    if (!discordConnected) return;
    if (discordSyncRef.current) return;
    discordSyncRef.current = true;
    syncDiscordRole().catch(() => {
    });
  }, [isLoaded, userId, isInstructorOrAdmin, discordConnected]);

  const sortedPacks = sessionPacks
    ? [...sessionPacks].sort((a, b) => b.purchasedAt - a.purchasedAt)
    : [];

  const uniqueInstructorCount = new Set(
    sessionPacks?.map((p) => p.instructorId) ?? []
  ).size;

  if (!isLoaded) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground mt-1">
            Welcome back, {user.primaryEmailAddress?.emailAddress}
          </p>
        </div>
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
          <CardTitle>Get started with your mentorships</CardTitle>
          <CardDescription>
            Complete these steps to make the most of your sessions.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {!discordConnected && (
            <div className="flex items-start gap-3 p-3 rounded-lg border bg-muted/50">
              <div className="flex-1">
                <div className="font-medium flex items-center gap-2">
                  <MessageCircle className="h-5 w-5" aria-hidden="true" />
                  Connect Discord
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  Join the community and access your mentorship channels.
                </p>
              </div>
              <Link
                href="/settings"
                className="inline-flex items-center justify-center rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 shrink-0"
              >
                Connect
              </Link>
            </div>
          )}

          {!googleCalendarConnected && !loadingGoogleCalendar && isInstructorOrAdmin && (
            <div className="flex items-start gap-3 p-3 rounded-lg border bg-muted/50">
              <div className="flex-1">
                <div className="font-medium flex items-center gap-2">
                  <Calendar className="h-5 w-5" aria-hidden="true" />
                  Connect Google Calendar
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  Enable calendar sync to schedule and manage sessions automatically.
                </p>
              </div>
              <Link
                href="/instructor/availability"
                className="inline-flex items-center justify-center rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 shrink-0"
              >
                Connect
              </Link>
            </div>
          )}

          {(totalSessions ?? 0) > 0 && (
            <div className="flex items-start gap-3 p-3 rounded-lg border bg-muted/50">
              <div className="flex-1">
                <div className="font-medium flex items-center gap-2">
                  <Calendar className="h-5 w-5" />
                  Book a session
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  You have {(totalSessions ?? 0) === 1 ? "1 session" : `${totalSessions} sessions`} available. Schedule your first session with your instructor.
                </p>
              </div>
              <Link
                href="/calendar"
                className="inline-flex items-center justify-center rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 shrink-0"
              >
                Book now
              </Link>
            </div>
          )}

          {discordConnected && (!isInstructorOrAdmin || googleCalendarConnected) && (totalSessions ?? 0) === 0 && sortedPacks.length === 0 && (
            <div className="text-center py-4 text-muted-foreground">
              <p>You&apos;re all set! Browse instructors to get started.</p>
              <Link className="text-primary hover:underline mt-2 inline-block" href="/instructors">
                Browse instructors →
              </Link>
            </div>
          )}

          {sortedPacks.length > 0 && (
            <div className="pt-2 border-t">
              <Link
                href="/instructors"
                className="text-sm text-primary hover:underline"
              >
                Browse more instructors →
              </Link>
            </div>
          )}
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
                  <SessionPackCard key={pack._id} pack={pack as SessionPackData} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Upcoming Sessions</CardTitle>
            <CardDescription>
              <div className="space-y-2">
                <p>Your scheduled mentorship sessions</p>
                <div className="text-xs flex items-start gap-2 rounded-md border p-2 bg-muted/50">
                  <Info className="h-4 w-4 mt-0.5 text-muted-foreground" aria-hidden="true" />
                  <p>
                    To cancel or reschedule, contact your instructor in your workspace. Please try to inform them at least 24 hours in advance; instructors handle changes requested with less than 24 hours&apos; notice at their discretion.
                  </p>
                </div>
              </div>
            </CardDescription>
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
                {upcomingSessions.map((session) => (
                  <UpcomingSessionCard key={session._id} session={session as SessionData} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {isInstructorOrAdmin && (
          <Card>
            <CardHeader>
              <CardTitle>Calendar Bookings</CardTitle>
              <CardDescription>
                <div className="space-y-2">
                  <p>Bookings created via Google Calendar</p>
                  <div className="text-xs flex items-start gap-2 rounded-md border p-2 bg-muted/50">
                    <Info className="h-4 w-4 mt-0.5 text-muted-foreground" aria-hidden="true" />
                    <p>
                      Need to cancel or reschedule? Contact your instructor in your workspace. Please try to inform them at least 24 hours in advance; instructors handle changes requested with less than 24 hours&apos; notice at their discretion.
                    </p>
                  </div>
                </div>
              </CardDescription>
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
                          {b.status === "completed" && <CheckCircle2 className="h-3 w-3 mr-1" aria-hidden="true" />}
                          {b.status === "canceled" && <XCircle className="h-3 w-3 mr-1" aria-hidden="true" />}
                          {b.status !== "completed" && b.status !== "canceled" && <Clock className="h-3 w-3 mr-1" aria-hidden="true" />}
                          {b.status}
                        </Badge>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}